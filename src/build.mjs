import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  PDFDict,
  PDFDocument,
  PDFName,
  StandardFonts,
  beginMarkedContent,
  endMarkedContent,
  rgb,
} from 'pdf-lib';
import QRCode from 'qrcode';
import sharp from 'sharp';
import { loadConfig } from './config.mjs';
import { renderCover } from './cover.mjs';
import { normalizeReleaseVersion } from './release.mjs';
import { buildDocument } from './template.mjs';
import { transformReadme } from './transform.mjs';

function normalizeDestinationNames(doc) {
  const dests = doc.catalog.lookup(PDFName.of('Dests'), PDFDict);
  if (!dests) return { names: 0, references: 0 };

  const mapping = new Map();
  for (const key of dests.keys()) {
    const oldName = key.asString();
    if (!oldName.startsWith('/viv-id-')) continue;
    const digest = createHash('sha256').update(oldName).digest('hex').slice(0, 16);
    mapping.set(oldName, PDFName.of(`d-${digest}`));
  }
  for (const [oldName, newName] of mapping) {
    const oldKey = PDFName.of(oldName.slice(1));
    const destination = dests.get(oldKey);
    dests.delete(oldKey);
    dests.set(newName, destination);
  }

  let references = 0;
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict)) continue;
    for (const field of ['Dest', 'D']) {
      const key = PDFName.of(field);
      const value = object.get(key);
      if (!(value instanceof PDFName)) continue;
      const replacement = mapping.get(value.asString());
      if (!replacement) continue;
      object.set(key, replacement);
      references += 1;
    }
  }
  return { names: mapping.size, references };
}

async function writeOptimizedFigure(source, target, quality) {
  await sharp(source)
    .flatten({ background: '#ffffff' })
    .jpeg({ quality, chromaSubsampling: '4:4:4', mozjpeg: true })
    .toFile(target);
}

async function writeRepositoryQr(outputDir, repositoryUrl) {
  const asset = 'assets/repository-qr.svg';
  const svg = await QRCode.toString(repositoryUrl, {
    type: 'svg',
    errorCorrectionLevel: 'Q',
    margin: 2,
    width: 512,
    color: { dark: '#123F73', light: '#FFFDF7' },
  });
  writeFileSync(resolve(outputDir, asset), svg, 'utf8');
  return { asset, url: repositoryUrl, errorCorrectionLevel: 'Q' };
}

function stampFooters(doc, footer, hasCover) {
  if (!footer) return null;
  const font = doc.embedStandardFont(StandardFonts.Courier);
  const textWidth = font.widthOfTextAtSize(footer.text, footer.size);
  const pages = doc.getPages();
  const targetPages = hasCover ? pages.slice(1) : pages;
  const [red, green, blue] = footer.color;
  for (const page of targetPages) {
    const { width } = page.getSize();
    page.pushOperators(beginMarkedContent(PDFName.of('Artifact')));
    page.drawText(footer.text, {
      x: (width - textWidth) / 2,
      y: footer.y,
      size: footer.size,
      font,
      color: rgb(red / 255, green / 255, blue / 255),
      opacity: footer.opacity,
    });
    page.pushOperators(endMarkedContent());
  }
  return {
    ...footer,
    font: StandardFonts.Courier,
    artifact: true,
    stampedPages: targetPages.length,
  };
}

function highQualityFigurePath(path) {
  return path.replace(/\.jpg$/i, '.png');
}

function htmlForQuality(html, images, quality) {
  if (quality === 'normal') return html;
  let output = html;
  for (const [path, image] of images) {
    if (image.optimize) output = output.replaceAll(path, highQualityFigurePath(path));
  }
  return output;
}

async function finalizePdf(bodyPdf, coverPdf, outputPath, config) {
  const bodyDoc = await PDFDocument.load(readFileSync(bodyPdf));
  if (coverPdf) {
    const coverDoc = await PDFDocument.load(readFileSync(coverPdf));
    const [coverPage] = await bodyDoc.copyPages(coverDoc, [0]);
    bodyDoc.insertPage(0, coverPage);
  }

  const releaseLabel = config.releaseVersion ? `؛ ${config.releaseVersion}` : '';
  bodyDoc.setTitle(`${config.metadata.title}؛ ${config.metadata.edition}${releaseLabel}`);
  bodyDoc.setAuthor(config.metadata.author);
  bodyDoc.setSubject(config.releaseVersion
    ? `${config.metadata.subject}; ${config.releaseVersion}`
    : config.metadata.subject);
  bodyDoc.setLanguage(config.metadata.language);
  bodyDoc.setCreator(config.metadata.creator);

  const repositoryFooter = stampFooters(bodyDoc, config.footer, Boolean(coverPdf));
  const normalizedDestinations = normalizeDestinationNames(bodyDoc);
  writeFileSync(outputPath, await bodyDoc.save());

  let linearized = false;
  const linearizedPdf = outputPath.replace(/\.pdf$/i, '.linearized.pdf');
  try {
    execFileSync('qpdf', ['--linearize', outputPath, linearizedPdf], { stdio: ['ignore', 'inherit', 'inherit'] });
    renameSync(linearizedPdf, outputPath);
    linearized = true;
  } catch (error) {
    if (error.code === 'ENOENT') console.warn('qpdf is unavailable; the PDF was not linearized.');
    else throw error;
  }

  const bytes = readFileSync(outputPath);
  return {
    pageCount: bodyDoc.getPageCount(),
    bytes: statSync(outputPath).size,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    repositoryFooter,
    normalizedDestinations,
    linearized,
  };
}

function sourceCommit(projectRoot) {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

export async function runBuild({ configFile, quality = 'normal', releaseVersion: rawVersion } = {}) {
  if (!['normal', 'high', 'all'].includes(quality)) {
    throw new Error(`Unknown quality: ${quality}. Use normal, high, or all.`);
  }
  const config = await loadConfig(configFile);
  const releaseVersion = rawVersion ? normalizeReleaseVersion(rawVersion) : null;
  const documentConfig = { ...config, releaseVersion };
  const qualities = quality === 'all' ? ['normal', 'high'] : [quality];
  const variants = {
    normal: {
      html: 'book.html',
      bodyPdf: 'body.pdf',
      pdf: config.outputs.normal,
      imageMode: 'optimized-jpeg',
    },
    high: {
      html: 'book-high-quality.html',
      bodyPdf: 'body-high-quality.pdf',
      pdf: config.outputs.high,
      imageMode: 'source-png-lossless',
    },
  };

  const markdown = readFileSync(config.sourcePath, 'utf8');
  const sourceSha256 = createHash('sha256').update(markdown).digest('hex');
  const outputDir = config.outputDir;
  mkdirSync(resolve(outputDir, 'assets/twemoji'), { recursive: true });
  mkdirSync(resolve(outputDir, 'assets/diagrams'), { recursive: true });

  const result = await transformReadme(markdown, config, { sourceDir: dirname(config.sourcePath) });
  for (const diagnostic of result.diagnostics) {
    console.warn(`${diagnostic.code}: ${diagnostic.detail}`);
  }

  cpSync(config.theme.stylesheet, resolve(outputDir, 'book.css'));
  const themeFonts = resolve(config.themeRoot, 'fonts');
  if (existsSync(themeFonts)) cpSync(themeFonts, resolve(outputDir, 'fonts'), { recursive: true });
  for (const file of result.usedEmoji) {
    const source = resolve(config.packageRoot, 'node_modules/@twemoji/svg', file);
    if (existsSync(source)) cpSync(source, resolve(outputDir, 'assets/twemoji', file));
    else result.diagnostics.push({ code: 'MISSING_TWEMOJI', detail: file });
  }
  for (const [file, path] of result.diagrams) {
    cpSync(path, resolve(outputDir, 'assets/diagrams', file));
  }
  for (const [relativePath, image] of result.images) {
    if (!image.optimize) {
      const target = resolve(outputDir, relativePath);
      mkdirSync(dirname(target), { recursive: true });
      cpSync(image.source, target);
      continue;
    }
    if (qualities.includes('normal')) {
      const target = resolve(outputDir, relativePath);
      mkdirSync(dirname(target), { recursive: true });
      await writeOptimizedFigure(image.source, target, config.images.normalJpegQuality);
    }
    if (qualities.includes('high')) {
      const target = resolve(outputDir, highQualityFigurePath(relativePath));
      mkdirSync(dirname(target), { recursive: true });
      cpSync(image.source, target);
    }
  }

  const repositoryQr = await writeRepositoryQr(outputDir, config.repository.url);
  let coverPdf = null;
  if (config.cover.enabled) {
    coverPdf = resolve(outputDir, 'cover.pdf');
    await renderCover(config.cover.file, coverPdf, documentConfig);
  }

  const baseHtml = buildDocument(result, documentConfig);
  const outputs = {};
  const vivliostyle = resolve(config.packageRoot, 'node_modules/.bin/vivliostyle');
  for (const requested of qualities) {
    const variant = variants[requested];
    const htmlPath = resolve(outputDir, variant.html);
    const bodyPdf = resolve(outputDir, variant.bodyPdf);
    const outputPath = resolve(outputDir, variant.pdf);
    writeFileSync(htmlPath, htmlForQuality(baseHtml, result.images, requested), 'utf8');
    execFileSync(vivliostyle, ['build', htmlPath, '-o', bodyPdf], {
      cwd: config.projectRoot,
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    const finalized = await finalizePdf(bodyPdf, coverPdf, outputPath, documentConfig);
    outputs[requested] = {
      quality: requested,
      imageMode: variant.imageMode,
      pdf: variant.pdf,
      html: variant.html,
      ...finalized,
    };
    console.log(`Built ${variant.pdf}: ${finalized.pageCount} pages, ${finalized.bytes} bytes.`);
  }

  const packageJson = JSON.parse(readFileSync(resolve(config.packageRoot, 'package.json'), 'utf8'));
  const primaryQuality = qualities.includes('normal') ? 'normal' : 'high';
  const manifest = {
    engine: { name: packageJson.name, version: packageJson.version },
    configFile: config.configFile,
    source: config.sourcePath,
    sourceSha256,
    sourceCommit: sourceCommit(dirname(config.sourcePath)),
    releaseVersion,
    requestedQuality: quality,
    primaryQuality,
    outputs,
    pageCount: outputs[primaryQuality].pageCount,
    metadata: config.metadata,
    repository: config.repository,
    parts: result.parts,
    chapters: result.chapters.map(({ html, ...rest }) => rest),
    headings: result.headings.length,
    diagrams: [...result.diagrams.keys()],
    optimizedFigures: [...result.images.keys()],
    highQualityFigures: [...result.images.entries()]
      .filter(([, image]) => image.optimize)
      .map(([path]) => highQualityFigurePath(path)),
    repositoryQr,
    diagnostics: result.diagnostics,
  };
  writeFileSync(resolve(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}
