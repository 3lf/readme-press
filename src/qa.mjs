import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PDFArray, PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import sharp from 'sharp';
import { loadConfig } from './config.mjs';
import { normalizeReleaseVersion } from './release.mjs';

function runTool(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      ...options,
    });
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function linkAnnotationData(pdfDoc) {
  const uris = [];
  let count = 0;
  for (const [pageIndex, page] of pdfDoc.getPages().entries()) {
    const annotations = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (!annotations) continue;
    for (const item of annotations.asArray()) {
      const annotation = pdfDoc.context.lookup(item, PDFDict);
      if (annotation?.get(PDFName.of('Subtype'))?.asString?.() !== '/Link') continue;
      count += 1;
      const action = annotation.lookupMaybe(PDFName.of('A'), PDFDict);
      const uri = action?.get(PDFName.of('URI'))?.decodeText?.();
      if (uri) uris.push({ pageIndex, uri });
    }
  }
  return { count, uris };
}

async function pixelFingerprint(path) {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return `${info.width}x${info.height}:${createHash('sha256').update(data).digest('hex')}`;
}

async function verifyLosslessFigures(pdfPath, figurePaths) {
  const temporary = mkdtempSync(join(tmpdir(), 'readme-press-lossless-'));
  try {
    execFileSync('pdfimages', ['-png', pdfPath, join(temporary, 'image')], { stdio: 'ignore' });
    const extracted = readdirSync(temporary)
      .filter((name) => name.endsWith('.png'))
      .map((name) => join(temporary, name));
    const available = new Map();
    for (const path of extracted) {
      const fingerprint = await pixelFingerprint(path);
      available.set(fingerprint, (available.get(fingerprint) ?? 0) + 1);
    }
    let matched = 0;
    for (const path of figurePaths) {
      const fingerprint = await pixelFingerprint(path);
      const count = available.get(fingerprint) ?? 0;
      if (!count) continue;
      matched += 1;
      available.set(fingerprint, count - 1);
    }
    return { extracted: extracted.length, matched };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

async function pagesWithNonWhiteEdges(directory) {
  const files = readdirSync(directory)
    .filter((name) => /^page-\d+\.png$/.test(name))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  const failures = [];
  for (const file of files) {
    const { data, info } = await sharp(join(directory, file))
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const points = [
      [1, 1],
      [info.width - 2, 1],
      [1, info.height - 2],
      [info.width - 2, info.height - 2],
      [Math.floor(info.width / 2), 1],
      [Math.floor(info.width / 2), info.height - 2],
      [1, Math.floor(info.height / 2)],
      [info.width - 2, Math.floor(info.height / 2)],
    ];
    const white = points.every(([x, y]) => {
      const offset = (y * info.width + x) * info.channels;
      return data[offset] >= 248 && data[offset + 1] >= 248 && data[offset + 2] >= 248;
    });
    if (!white) failures.push(file);
  }
  return { checked: files.length, failures };
}

function parsePythonBlocks(markdown) {
  const blocks = [...markdown.matchAll(/^```python[^\n]*\n([\s\S]*?)^```\s*$/gm)]
    .map((match, index) => ({ index: index + 1, code: match[1] }));
  const script = [
    'import ast, json, sys',
    'blocks = json.load(sys.stdin)',
    'errors = []',
    'for block in blocks:',
    '    try:',
    '        ast.parse(block["code"])',
    '    except SyntaxError as error:',
    '        errors.append({"index": block["index"], "line": error.lineno, "message": error.msg})',
    'print(json.dumps({"count": len(blocks), "errors": errors}))',
  ].join('\n');
  const output = runTool('python3', ['-c', script], {
    input: JSON.stringify(blocks),
    maxBuffer: 8 * 1024 * 1024,
  });
  return output ? JSON.parse(output) : null;
}

function normalizeBbox(value) {
  return value
    .replace(/<meta name="CreationDate"[^>]*>\s*/g, '')
    .replace(/<meta name="ModDate"[^>]*>\s*/g, '');
}

export async function runQa({
  configFile,
  quality,
  releaseVersion: rawVersion,
  renderAll = false,
} = {}) {
  const config = await loadConfig(configFile);
  const manifestPath = resolve(config.outputDir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const requestedQuality = quality ?? manifest.requestedQuality ?? 'normal';
  if (!['normal', 'high', 'print', 'all'].includes(requestedQuality)) {
    throw new Error(`Unknown quality: ${requestedQuality}. Use normal, high, print, or all.`);
  }
  const configuredQualities = ['normal', 'print', 'high'].filter((variant) => config.outputs[variant]);
  if (requestedQuality !== 'all' && !configuredQualities.includes(requestedQuality)) {
    throw new Error(`The ${requestedQuality} output is not configured.`);
  }
  const qualities = requestedQuality === 'all' ? configuredQualities : [requestedQuality];
  const expectedVersion = rawVersion ? normalizeReleaseVersion(rawVersion) : null;
  let failures = 0;
  const check = (condition, label, detail = '') => {
    console.log(`${condition ? 'PASS' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`);
    if (!condition) failures += 1;
  };

  check(manifest.source === config.sourcePath, 'manifest source matches configuration');
  check(manifest.repository?.url === config.repository.url, 'manifest repository matches configuration');
  check(manifest.engine?.name === 'readme-press', 'manifest identifies README Press');
  check(Array.isArray(manifest.diagnostics) && manifest.diagnostics.length === 0,
    'transform completed without diagnostics', String(manifest.diagnostics?.length ?? 0));
  if (expectedVersion) check(manifest.releaseVersion === expectedVersion, 'manifest release version', manifest.releaseVersion);
  if (config.qa.requireSourceCommit) {
    check(/^[0-9a-f]{40}$/i.test(manifest.sourceCommit ?? ''), 'manifest records a full source commit');
  }

  const source = readFileSync(config.sourcePath, 'utf8');
  check(manifest.sourceSha256 === createHash('sha256').update(source).digest('hex'), 'source hash matches manifest');
  if (config.qa.pythonBlocks !== false) {
    const python = parsePythonBlocks(source);
    if (python) check(python.errors.length === 0, 'Python teaching blocks parse', `${python.count} blocks`);
  }

  const docs = new Map();
  const data = new Map();
  for (const requested of qualities) {
    const output = manifest.outputs?.[requested];
    if (!output) throw new Error(`Manifest has no ${requested} output. Build it before QA.`);
    const pdfPath = resolve(config.outputDir, output.pdf);
    const bytes = readFileSync(pdfPath);
    const doc = await PDFDocument.load(bytes);
    const pageCount = doc.getPageCount();
    docs.set(requested, doc);
    data.set(requested, { output, pdfPath, bytes, pageCount });

    check(output.pageCount === pageCount, `${requested} page count matches manifest`, String(pageCount));
    check(output.bytes === statSync(pdfPath).size, `${requested} byte size matches manifest`);
    check(output.sha256 === createHash('sha256').update(bytes).digest('hex'), `${requested} SHA-256 matches manifest`);
    check(output.linearized === true, `${requested} manifest records linearization`);
    const minPages = config.qa.minPages ?? 1;
    const maxPages = config.qa.maxPages ?? 10_000;
    check(pageCount >= minPages && pageCount <= maxPages, `${requested} page count is within configured range`, String(pageCount));

    const expectedWidth = config.page.widthCm * 72 / 2.54;
    const expectedHeight = config.page.heightCm * 72 / 2.54;
    const badGeometry = doc.getPages().filter((page) => {
      const size = page.getSize();
      return Math.abs(size.width - expectedWidth) > 0.05 || Math.abs(size.height - expectedHeight) > 0.05;
    });
    check(badGeometry.length === 0, `${requested} page geometry`, `${badGeometry.length} mismatches`);

    execFileSync('qpdf', ['--check', pdfPath], { stdio: 'ignore' });
    check(true, `${requested} qpdf container check`);
    const info = runTool('pdfinfo', [pdfPath]);
    if (info) {
      check(/^Tagged:\s+yes$/m.test(info), `${requested} is tagged`);
      check(/^Optimized:\s+yes$/m.test(info), `${requested} is linearized`);
      check(/^Encrypted:\s+no$/m.test(info), `${requested} is not encrypted`);
      if (expectedVersion) check(info.includes(expectedVersion), `${requested} metadata includes release version`);
    }

    const fonts = runTool('pdffonts', [pdfPath]);
    if (fonts) {
      if (config.qa.forbidType3Fonts) {
        check(!/Type 3/.test(fonts), `${requested} contains no Type 3 fonts`);
      }
      for (const family of config.qa.fontFamilies ?? []) {
        const lines = fonts.split('\n').filter((line) => line.includes(family));
        check(lines.length > 0 && lines.every((line) => / yes /.test(line)), `${requested} embeds ${family}`);
      }
    }

    const destinations = doc.catalog.lookup(PDFName.of('Dests'), PDFDict)?.keys() ?? [];
    const minimumDestinations = config.qa.minimumDestinations ?? 1;
    check(destinations.length >= minimumDestinations, `${requested} destination dictionary`, String(destinations.length));
    check(destinations.every((name) => name.asBytes().length <= 127), `${requested} destination names fit compatibility limit`);
    check(destinations.every((name) => !name.asString().startsWith('/viv-id-')), `${requested} build-server destinations were normalized`);

    const outlineRoot = doc.catalog.lookup(PDFName.of('Outlines'), PDFDict);
    const outlineCount = Math.abs(outlineRoot?.get(PDFName.of('Count'))?.asNumber?.() ?? 0);
    const minimumOutlines = config.qa.minimumOutlines ?? 1;
    check(outlineCount >= minimumOutlines, `${requested} PDF bookmarks`, String(outlineCount));
    check(output.outlines?.items === outlineCount, `${requested} bookmark count matches manifest`);

    const links = linkAnnotationData(doc);
    check(!links.uris.some(({ uri }) => /localhost|127\.0\.0\.1|file:/i.test(uri)), `${requested} has no local build links`);
    if (config.cover.enabled) {
      check(links.uris.some(({ pageIndex, uri }) => pageIndex === 0 && uri === config.repository.url),
        `${requested} cover repository link`);
    }
    for (const expectedLink of config.qa.expectedLinks ?? []) {
      check(links.uris.some(({ uri }) => uri === expectedLink), `${requested} contains expected link`, expectedLink);
    }

    const imageInventory = runTool('pdfimages', ['-list', pdfPath]);
    if (imageInventory) {
      const imageLines = imageInventory.split('\n').filter((line) => /^\s*\d+\s+\d+\s+image\s+/.test(line));
      const jpegCount = imageLines.filter((line) => /\s+jpeg\s+/.test(line)).length;
      if (requested === 'normal') {
        check(jpegCount === manifest.optimizedFigures.length, 'normal PDF uses JPEG for optimized figures', `${jpegCount}`);
      } else {
        check(jpegCount === 0, `${requested} PDF contains no JPEG figures`, `${jpegCount}`);
      }
    }

    const extracted = runTool('pdftotext', ['-layout', pdfPath, '-']);
    if (extracted) {
      const normalized = extracted.replace(/\p{Cf}/gu, '');
      for (const phrase of config.qa.extractablePhrases ?? []) {
        check(normalized.includes(phrase), `${requested} extractable phrase`, phrase);
      }
    }

    if (renderAll) {
      const temporary = mkdtempSync(join(tmpdir(), `readme-press-render-${requested}-`));
      try {
        execFileSync('pdftoppm', ['-r', '72', '-png', pdfPath, join(temporary, 'page')], { stdio: 'ignore' });
        const count = readdirSync(temporary).filter((name) => /^page-\d+\.png$/.test(name)).length;
        check(count === pageCount, `${requested} all-page Poppler render`, `${count} pages`);
        if (requested === 'print') {
          const edges = await pagesWithNonWhiteEdges(temporary);
          check(
            edges.failures.length === 0,
            'print edition uses white page backgrounds',
            edges.failures.length ? edges.failures.slice(0, 5).join(', ') : `${edges.checked} pages`,
          );
        }
      } finally {
        rmSync(temporary, { recursive: true, force: true });
      }
    }
  }

  for (const qualityName of qualities.filter((variant) => variant === 'high' || variant === 'print')) {
    const losslessOutput = data.get(qualityName);
    const lossless = await verifyLosslessFigures(
      losslessOutput.pdfPath,
      manifest.highQualityFigures.map((path) => resolve(config.outputDir, path)),
    );
    check(lossless.matched === manifest.highQualityFigures.length,
      `${qualityName} figures are pixel-identical to source PNG files`,
      `${lossless.matched}/${manifest.highQualityFigures.length}`);
  }

  if (qualities.length > 1) {
    const baselineName = qualities.includes('normal') ? 'normal' : qualities[0];
    const baseline = data.get(baselineName);
    const baselineDoc = docs.get(baselineName);
    const baselineBbox = runTool('pdftotext', ['-bbox-layout', baseline.pdfPath, '-']);
    for (const comparedName of qualities.filter((variant) => variant !== baselineName)) {
      const compared = data.get(comparedName);
      const comparedDoc = docs.get(comparedName);
      check(
        compared.pageCount === baseline.pageCount,
        `${comparedName} and ${baselineName} have identical page counts`,
        String(baseline.pageCount),
      );
      check(compared.output.sha256 !== baseline.output.sha256, `${comparedName} and ${baselineName} have distinct hashes`);
      const sameGeometry = comparedDoc.getPages().every((page, index) => {
        const comparedSize = page.getSize();
        const baselineSize = baselineDoc.getPage(index).getSize();
        return Math.abs(comparedSize.width - baselineSize.width) < 0.01
          && Math.abs(comparedSize.height - baselineSize.height) < 0.01;
      });
      check(sameGeometry, `${comparedName} and ${baselineName} have identical page geometry`);
      check(
        linkAnnotationData(comparedDoc).count === linkAnnotationData(baselineDoc).count,
        `${comparedName} and ${baselineName} have identical link annotation counts`,
      );
      check(
        compared.output.normalizedDestinations?.names === baseline.output.normalizedDestinations?.names
          && compared.output.normalizedDestinations?.references === baseline.output.normalizedDestinations?.references,
        `${comparedName} and ${baselineName} have identical destination counts`,
      );
      const comparedBbox = runTool('pdftotext', ['-bbox-layout', compared.pdfPath, '-']);
      if (baselineBbox && comparedBbox) {
        check(
          normalizeBbox(baselineBbox) === normalizeBbox(comparedBbox),
          `${comparedName} and ${baselineName} have pixel-aligned text boxes on every page`,
        );
      }
    }
  }

  if (config.qa.script) {
    const projectQa = await import(`${pathToFileURL(config.qa.script).href}?t=${Date.now()}`);
    await (projectQa.default ?? projectQa.run)({ config, manifest, check });
  }

  if (failures) throw new Error(`README Press QA failed with ${failures} problem(s).`);
  console.log('README Press QA passed.');
  return { failures: 0, manifest };
}
