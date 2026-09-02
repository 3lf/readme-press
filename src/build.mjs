import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
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
  PDFHexString,
  PDFName,
  PDFNumber,
  StandardFonts,
  beginMarkedContent,
  endMarkedContent,
  rgb,
} from 'pdf-lib';
import QRCode from 'qrcode';
import sharp from 'sharp';
import {
  createStagingDirectory,
  publishStagedBuild,
  readGeneratedOwnership,
  reapAbandonedStagingDirectories,
  removeStagingDirectory,
  writeStagedManifest,
} from './artifacts.mjs';
import { loadConfig } from './config.mjs';
import { renderCover } from './cover.mjs';
import { assertNoDiagnosticErrors, normalizeDiagnostics } from './diagnostics.mjs';
import { preflightBuild } from './preflight.mjs';
import { renderPagedHtml } from './render.mjs';
import { assertContainedOutputSink } from './paths.mjs';
import { normalizeReleaseVersion } from './release.mjs';
import { buildDocument } from './template.mjs';
import { transformReadme } from './transform.mjs';

const require = createRequire(import.meta.url);
const TWEMOJI_ROOT = dirname(require.resolve('@twemoji/svg/package.json'));

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

function encodeDestinationFragment(value) {
  return [...value].map((character) => (
    /^[A-Za-z0-9_-]$/.test(character)
      ? character
      : `:${character.codePointAt(0).toString(16).padStart(4, '0')}`
  )).join('');
}

function destinationForSlug(dests, slug) {
  const suffix = `:0023${encodeDestinationFragment(slug)}`;
  return dests.keys().find((key) => key.asString().endsWith(suffix));
}

function localNumber(value, config) {
  const plain = String(value);
  if (config.metadata.numerals !== 'persian') return plain;
  return plain.replace(/\d/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);
}

function outlineTree(result, config) {
  const chapterNode = (chapter) => ({
    title: chapter.isIntroduction
      ? `${config.labels.introduction}: ${chapter.title}`
      : `${localNumber(chapter.displayNumber, config)}. ${chapter.title}`,
    slug: chapter.slug,
    children: chapter.tocHeadings.map((heading) => ({
      title: heading.text,
      slug: heading.slug,
      children: [],
    })),
  });
  const nodes = result.chapters.filter((chapter) => chapter.isIntroduction).map(chapterNode);
  const partNumbers = new Set();
  for (const part of result.parts) {
    partNumbers.add(part.number);
    nodes.push({
      title: `${config.labels.part} ${localNumber(part.number, config)}: ${part.title}`,
      slug: `part-${part.number}`,
      children: result.chapters
        .filter((chapter) => chapter.partNumber === part.number)
        .map(chapterNode),
    });
  }
  nodes.push(...result.chapters
    .filter((chapter) => !chapter.isIntroduction && !partNumbers.has(chapter.partNumber))
    .map(chapterNode));
  return nodes;
}

function addOutlines(doc, result, config) {
  const dests = doc.catalog.lookup(PDFName.of('Dests'), PDFDict);
  if (!dests) return { items: 0 };
  const outlines = PDFDict.withContext(doc.context);
  const outlinesRef = doc.context.register(outlines);
  outlines.set(PDFName.of('Type'), PDFName.of('Outlines'));

  const buildLevel = (nodes, parentRef) => {
    const items = nodes
      .map((node) => ({ ...node, destination: destinationForSlug(dests, node.slug) }))
      .filter((node) => node.destination)
      .map((node) => {
        const dictionary = PDFDict.withContext(doc.context);
        return { ...node, dictionary, ref: doc.context.register(dictionary) };
      });

    for (const [index, item] of items.entries()) {
      item.dictionary.set(PDFName.of('Title'), PDFHexString.fromText(item.title));
      item.dictionary.set(PDFName.of('Parent'), parentRef);
      item.dictionary.set(PDFName.of('Dest'), item.destination);
      if (index > 0) item.dictionary.set(PDFName.of('Prev'), items[index - 1].ref);
      if (index + 1 < items.length) item.dictionary.set(PDFName.of('Next'), items[index + 1].ref);
      const children = buildLevel(item.children, item.ref);
      if (children.count) {
        item.dictionary.set(PDFName.of('First'), children.first);
        item.dictionary.set(PDFName.of('Last'), children.last);
        item.dictionary.set(PDFName.of('Count'), PDFNumber.of(children.count));
      }
      item.descendants = children.count;
    }

    return {
      count: items.reduce((total, item) => total + 1 + item.descendants, 0),
      first: items[0]?.ref,
      last: items.at(-1)?.ref,
    };
  };

  const built = buildLevel(outlineTree(result, config), outlinesRef);
  if (!built.count) return { items: 0 };
  outlines.set(PDFName.of('First'), built.first);
  outlines.set(PDFName.of('Last'), built.last);
  outlines.set(PDFName.of('Count'), PDFNumber.of(built.count));
  doc.catalog.set(PDFName.of('Outlines'), outlinesRef);
  return { items: built.count };
}

function applyPageBoxes(doc, sizes) {
  if (sizes.length + 1 === doc.getPageCount()) doc.removePage(sizes.length);
  if (sizes.length !== doc.getPageCount()) {
    throw new Error(`Rendered ${sizes.length} page boxes for a ${doc.getPageCount()}-page PDF.`);
  }
  for (const [index, size] of sizes.entries()) {
    const page = doc.getPage(index);
    const yOffset = page.getHeight() - size.mediaHeight;
    page.setMediaBox(0, yOffset, size.mediaWidth, size.mediaHeight);
    if (!Number.isFinite(size.bleedOffset) || !Number.isFinite(size.bleedSize)
      || (!size.bleedOffset && !size.bleedSize)) continue;
    page.setBleedBox(
      size.bleedOffset,
      yOffset + size.bleedOffset,
      size.mediaWidth - size.bleedOffset * 2,
      size.mediaHeight - size.bleedOffset * 2,
    );
    const trimOffset = size.bleedOffset + size.bleedSize;
    page.setTrimBox(
      trimOffset,
      yOffset + trimOffset,
      size.mediaWidth - trimOffset * 2,
      size.mediaHeight - trimOffset * 2,
    );
  }
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

async function finalizePdf(bodyPdf, coverPdf, outputPath, config, result, renderData) {
  const bodyDoc = await PDFDocument.load(readFileSync(bodyPdf));
  applyPageBoxes(bodyDoc, renderData.pageSizeData);
  const outlines = addOutlines(bodyDoc, result, config);
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

  const linearizedPdf = outputPath.replace(/\.pdf$/i, '.linearized.pdf');
  execFileSync('qpdf', ['--linearize', outputPath, linearizedPdf], { stdio: ['ignore', 'inherit', 'inherit'] });
  renameSync(linearizedPdf, outputPath);

  const bytes = readFileSync(outputPath);
  return {
    pageCount: bodyDoc.getPageCount(),
    bytes: statSync(outputPath).size,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    repositoryFooter,
    normalizedDestinations,
    outlines,
    linearized: true,
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
  if (!['normal', 'high', 'print', 'all'].includes(quality)) {
    throw new Error(`Unknown quality: ${quality}. Use normal, high, print, or all.`);
  }
  const config = await loadConfig(configFile);
  await preflightBuild(config);
  const configuredQualities = ['normal', 'print', 'high'].filter((variant) => config.outputs[variant]);
  if (quality !== 'all' && !configuredQualities.includes(quality)) {
    throw new Error(`The ${quality} output is not configured.`);
  }
  const releaseVersion = rawVersion ? normalizeReleaseVersion(rawVersion) : null;
  const documentConfig = { ...config, releaseVersion };
  const qualities = quality === 'all' ? configuredQualities : [quality];
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
    print: {
      html: 'book-print.html',
      bodyPdf: 'body-print.pdf',
      pdf: config.outputs.print,
      imageMode: 'source-png-lossless-print-palette',
    },
  };

  const ownership = readGeneratedOwnership(config.outputDir);
  const stagingCleanup = reapAbandonedStagingDirectories(config.outputDir);
  const outputDir = createStagingDirectory(config.outputDir, { reap: false });
  try {
  const markdown = readFileSync(config.sourcePath, 'utf8');
  const sourceSha256 = createHash('sha256').update(markdown).digest('hex');
  mkdirSync(resolve(outputDir, 'assets/twemoji'), { recursive: true });
  mkdirSync(resolve(outputDir, 'assets/diagrams'), { recursive: true });

  const result = await transformReadme(markdown, config, {
    sourceDir: dirname(config.sourcePath),
    projectRoot: config.contentRoot,
  });
  result.diagnostics.push(...config.validationDiagnostics);
  result.diagnostics.push(...ownership.diagnostics);
  result.diagnostics = normalizeDiagnostics(result.diagnostics, config.security.diagnostics);
  for (const diagnostic of result.diagnostics) {
    console.warn(`${diagnostic.severity.toUpperCase()} ${diagnostic.code}: ${diagnostic.detail}`);
  }
  assertNoDiagnosticErrors(result.diagnostics);

  cpSync(config.theme.stylesheet, resolve(outputDir, 'book.css'));
  const themeFonts = resolve(config.themeRoot, 'fonts');
  if (existsSync(themeFonts)) cpSync(themeFonts, resolve(outputDir, 'fonts'), { recursive: true });
  for (const file of result.usedEmoji) {
    const source = resolve(TWEMOJI_ROOT, file);
    if (existsSync(source)) cpSync(source, resolve(outputDir, 'assets/twemoji', file));
    else result.diagnostics.push({ code: 'MISSING_TWEMOJI', severity: 'error', detail: file });
  }
  result.diagnostics = normalizeDiagnostics(result.diagnostics, config.security.diagnostics);
  assertNoDiagnosticErrors(result.diagnostics);
  for (const [file, path] of result.diagrams) {
    cpSync(path, resolve(outputDir, 'assets/diagrams', file));
  }
  for (const image of result.images.values()) {
    if (!image.optimize) {
      const target = resolve(outputDir, image.normalUrl);
      mkdirSync(dirname(target), { recursive: true });
      cpSync(image.source, target);
      continue;
    }
    if (qualities.includes('normal')) {
      const target = resolve(outputDir, image.normalUrl);
      mkdirSync(dirname(target), { recursive: true });
      await writeOptimizedFigure(image.source, target, config.images.normalJpegQuality);
    }
    if (qualities.some((variant) => variant === 'high' || variant === 'print')) {
      const target = resolve(outputDir, image.losslessUrl);
      mkdirSync(dirname(target), { recursive: true });
      cpSync(image.source, target);
    }
  }

  const repositoryQr = await writeRepositoryQr(outputDir, config.repository.url);
  const coverPdfs = new Map();
  if (config.cover.enabled) {
    if (qualities.some((variant) => variant !== 'print')) {
      const coverPdf = resolve(outputDir, 'cover.pdf');
      await renderCover(config.cover.file, coverPdf, { ...documentConfig, outputVariant: 'normal' });
      for (const variant of qualities.filter((value) => value !== 'print')) coverPdfs.set(variant, coverPdf);
    }
    if (qualities.includes('print')) {
      const printCoverPdf = resolve(outputDir, 'cover-print.pdf');
      await renderCover(config.cover.file, printCoverPdf, { ...documentConfig, outputVariant: 'print' });
      coverPdfs.set('print', printCoverPdf);
    }
  }

  const outputs = {};
  for (const requested of qualities) {
    const variant = variants[requested];
    const htmlPath = resolve(outputDir, variant.html);
    const bodyPdf = resolve(outputDir, variant.bodyPdf);
    const outputPath = resolve(outputDir, variant.pdf);
    const html = buildDocument(result, { ...documentConfig, outputVariant: requested });
    writeFileSync(htmlPath, html, 'utf8');
    const renderData = await renderPagedHtml({
      htmlPath,
      pdfPath: bodyPdf,
      network: config.security.network,
    });
    assertContainedOutputSink(outputDir, outputPath, { label: `outputs.${requested}` });
    mkdirSync(dirname(outputPath), { recursive: true });
    assertContainedOutputSink(outputDir, outputPath, { label: `outputs.${requested}` });
    const finalized = await finalizePdf(
      bodyPdf,
      coverPdfs.get(requested) ?? null,
      outputPath,
      documentConfig,
      result,
      renderData,
    );
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
  const primaryQuality = qualities.includes('normal') ? 'normal' : qualities[0];
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
    chapters: result.chapters.map(({ html, htmlByQuality, ...rest }) => rest),
    headings: result.headings.length,
    diagrams: [...result.diagrams.keys()],
    optimizedFigures: [...result.images.values()]
      .filter((image) => image.optimize)
      .map((image) => image.normalUrl),
    highQualityFigures: [...result.images.values()]
      .filter((image) => image.optimize)
      .map((image) => image.losslessUrl),
    repositoryQr,
    diagnostics: result.diagnostics,
    publication: {
      cleanup: {
        reaped: stagingCleanup.reaped,
        reapedPaths: stagingCleanup.paths,
        reapedPathsTruncated: stagingCleanup.truncated,
      },
    },
  };
  writeStagedManifest(outputDir, manifest);
  const publication = publishStagedBuild({
    stagingDirectory: outputDir,
    outputDirectory: config.outputDir,
    previousFiles: ownership.files,
  });
  const cleanup = publication.cleanup;
  if (cleanup.reaped || cleanup.removed) {
    console.log(`Publication cleanup: ${cleanup.reaped ?? 0} staging director${cleanup.reaped === 1 ? 'y' : 'ies'} reaped, ${cleanup.removed ?? 0} stale artifact(s) removed.`);
  }
  return publication.manifest;
  } finally {
    removeStagingDirectory(outputDir);
  }
}
