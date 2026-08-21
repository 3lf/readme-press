import { createHash, randomUUID } from 'crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'fs';
import { dirname, resolve } from 'path';

const VERSION_RE = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function normalizeReleaseVersion(value) {
  const version = String(value ?? '').trim();
  const match = version.match(VERSION_RE);
  if (!match) {
    throw new Error(`Invalid release version: ${version || '(empty)'}. Use vMAJOR.MINOR.PATCH, for example v1.0.0.`);
  }
  const prerelease = match[4]?.split('.') ?? [];
  if (prerelease.some((part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith('0'))) {
    throw new Error(`Invalid release version: ${version}. Numeric prerelease identifiers cannot have leading zeroes.`);
  }
  return version;
}

function fileSha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function formatMegabytes(bytes) {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function markdownText(value) {
  return String(value ?? '')
    .replace(/\r?\n/gu, ' ')
    .replace(/([\\`*_\[\]<>#!])/gu, '\\$1');
}

function markdownTableCell(value) {
  return markdownText(value).replaceAll('|', '\\|');
}

function markdownInlineCode(value) {
  const text = String(value ?? '');
  const longest = Math.max(0, ...[...text.matchAll(/`+/gu)].map((match) => match[0].length));
  const fence = '`'.repeat(longest + 1);
  const padding = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${fence}${padding}${text}${padding}${fence}`;
}

function markdownLinkDestination(value) {
  return `<${String(value).replaceAll('>', '%3E')}>`;
}

function atomicWrite(path, content) {
  const temporary = `${path}.readme-press-${process.pid}-${randomUUID()}`;
  writeFileSync(temporary, content, 'utf8');
  renameSync(temporary, path);
}

function requireOutput(manifest, quality, dist) {
  const output = manifest.outputs?.[quality];
  if (!output) throw new Error(`Manifest has no ${quality} output.`);
  const pdfPath = resolve(dist, output.pdf);
  if (!existsSync(pdfPath)) throw new Error(`Missing release file: ${output.pdf}`);
  const bytes = statSync(pdfPath).size;
  const sha256 = fileSha256(pdfPath);
  if (bytes !== output.bytes || sha256 !== output.sha256) {
    throw new Error(`Release file does not match manifest: ${output.pdf}`);
  }
  return { ...output, path: pdfPath, bytes, sha256 };
}

export function prepareRelease({ version: rawVersion, manifestPath, outputDir, commit, release = {} }) {
  const version = normalizeReleaseVersion(rawVersion);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.releaseVersion !== version) {
    throw new Error(`Manifest release version is ${manifest.releaseVersion ?? '(missing)'}, expected ${version}.`);
  }

  const dist = dirname(resolve(manifestPath));
  const qualities = ['normal', 'print', 'high'].filter((quality) => manifest.outputs?.[quality]);
  if (!qualities.includes('normal') || !qualities.includes('high')) {
    throw new Error('Release manifests must contain normal and high outputs.');
  }
  const outputs = Object.fromEntries(qualities.map((quality) => [
    quality,
    requireOutput(manifest, quality, dist),
  ]));
  const pageCounts = new Set(Object.values(outputs).map((output) => output.pageCount));
  if (pageCounts.size !== 1) {
    throw new Error(`Edition variants have different page counts: ${[...pageCounts].join(', ')}.`);
  }

  const sourceCommit = commit || manifest.sourceCommit;
  if (!/^[0-9a-f]{40}$/i.test(sourceCommit ?? '')) {
    throw new Error('A full 40-character source commit is required for release notes.');
  }
  if (manifest.sourceCommit?.toLowerCase() !== sourceCommit.toLowerCase()) {
    throw new Error(`Manifest source commit ${manifest.sourceCommit ?? '(missing)'} does not match release commit ${sourceCommit}.`);
  }

  mkdirSync(outputDir, { recursive: true });
  const checksums = Object.values(outputs)
    .map((output) => `${output.sha256}  ${output.pdf}`)
    .join('\n');
  atomicWrite(resolve(outputDir, 'SHA256SUMS.txt'), `${checksums}\n`);

  const hasPrint = Boolean(outputs.print);
  const copy = {
    intro: `This release contains ${manifest.metadata?.title ?? 'the book'} in ${hasPrint ? 'three editions' : 'two quality variants'} built from the same source.`,
    filesTitle: 'Files',
    file: 'File',
    purpose: 'Purpose',
    pages: 'Pages',
    size: 'Size',
    normalPurpose: 'Normal edition for reading, downloading, and sharing',
    printPurpose: 'Print edition with lossless color figures and ink-efficient white backgrounds',
    highPurpose: 'High-quality full-color edition with lossless source images for display and archival use',
    parity: hasPrint
      ? 'The content, pagination, links, and document structure are identical. Editions differ only in image encoding and the print palette.'
      : 'The text, pagination, links, and document structure are identical. Only the image encoding differs.',
    validationTitle: 'Validation',
    validation: [
      'Every PDF passed README Press QA and `qpdf --check`.',
      'Lossless image inventories were compared with the source files.',
      '`SHA256SUMS.txt` is included for download verification.',
    ],
    sourceCommit: 'Source commit',
    version: 'Version',
    ...(release.copy ?? {}),
  };
  const commitUrl = `${manifest.repository?.url ?? ''}/commit/${sourceCommit}`;
  const rows = qualities.map((quality) => {
    const output = outputs[quality];
    return `| ${markdownInlineCode(output.pdf)} | ${markdownTableCell(copy[`${quality}Purpose`])} | ${output.pageCount} | ${formatMegabytes(output.bytes)} |`;
  }).join('\n');
  const notes = `${markdownText(copy.intro)}

## ${markdownText(copy.filesTitle)}

| ${markdownTableCell(copy.file)} | ${markdownTableCell(copy.purpose)} | ${markdownTableCell(copy.pages)} | ${markdownTableCell(copy.size)} |
|---|---|---:|---:|
${rows}

${markdownText(copy.parity)}

## ${markdownText(copy.validationTitle)}

${copy.validation.map((item) => `- ${markdownText(item)}`).join('\n')}
- ${markdownText(copy.sourceCommit)}: [${markdownInlineCode(sourceCommit.slice(0, 12))}](${markdownLinkDestination(commitUrl)})
- ${markdownText(copy.version)}: ${markdownInlineCode(version)}
`;
  atomicWrite(resolve(outputDir, 'release-notes.md'), notes);
  if (resolve(outputDir) === dist) {
    manifest.generatedFiles = [...new Set([
      ...(manifest.generatedFiles ?? []),
      'manifest.json',
      'release-notes.md',
      'SHA256SUMS.txt',
    ])].sort();
    atomicWrite(resolve(manifestPath), `${JSON.stringify(manifest, null, 2)}\n`);
  }

  return {
    version,
    outputs,
    normal: outputs.normal,
    print: outputs.print,
    high: outputs.high,
    sourceCommit,
  };
}

export function verifyRenderedPages({ manifestPath, directories }) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const expected = manifest.outputs?.normal?.pageCount;
  if (!Number.isInteger(expected) || expected < 1) throw new Error('Manifest has no valid normal page count.');

  for (const directory of directories) {
    const count = readdirSync(directory).filter((name) => /^page-\d+\.png$/.test(name)).length;
    if (count !== expected) {
      throw new Error(`Poppler rendered ${count} pages in ${directory}; expected ${expected}.`);
    }
  }
  return expected;
}
