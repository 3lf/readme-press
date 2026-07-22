import { createHash } from 'crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
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
  const normal = requireOutput(manifest, 'normal', dist);
  const high = requireOutput(manifest, 'high', dist);
  if (normal.pageCount !== high.pageCount) {
    throw new Error(`Quality variants have different page counts: ${normal.pageCount} and ${high.pageCount}.`);
  }

  const sourceCommit = commit || manifest.sourceCommit;
  if (!/^[0-9a-f]{40}$/i.test(sourceCommit ?? '')) {
    throw new Error('A full 40-character source commit is required for release notes.');
  }
  if (manifest.sourceCommit?.toLowerCase() !== sourceCommit.toLowerCase()) {
    throw new Error(`Manifest source commit ${manifest.sourceCommit ?? '(missing)'} does not match release commit ${sourceCommit}.`);
  }

  mkdirSync(outputDir, { recursive: true });
  const checksums = [normal, high]
    .map((output) => `${output.sha256}  ${output.pdf}`)
    .join('\n');
  writeFileSync(resolve(outputDir, 'SHA256SUMS.txt'), `${checksums}\n`, 'utf8');

  const copy = {
    intro: `This release contains ${manifest.metadata?.title ?? 'the book'} in two quality variants built from the same source.`,
    filesTitle: 'Files',
    file: 'File',
    purpose: 'Purpose',
    pages: 'Pages',
    size: 'Size',
    normalPurpose: 'Normal edition for reading, downloading, and sharing',
    highPurpose: 'High-quality edition with lossless source images for printing and archival use',
    parity: 'The text, pagination, links, and document structure are identical. Only the image encoding differs.',
    validationTitle: 'Validation',
    validation: [
      'Both PDFs passed README Press QA and `qpdf --check`.',
      'The high-quality image inventory was compared with the source files.',
      '`SHA256SUMS.txt` is included for download verification.',
    ],
    sourceCommit: 'Source commit',
    version: 'Version',
    ...(release.copy ?? {}),
  };
  const commitUrl = `${manifest.repository?.url ?? ''}/commit/${sourceCommit}`;
  const notes = `${copy.intro}

## ${copy.filesTitle}

| ${copy.file} | ${copy.purpose} | ${copy.pages} | ${copy.size} |
|---|---|---:|---:|
| \`${normal.pdf}\` | ${copy.normalPurpose} | ${normal.pageCount} | ${formatMegabytes(normal.bytes)} |
| \`${high.pdf}\` | ${copy.highPurpose} | ${high.pageCount} | ${formatMegabytes(high.bytes)} |

${copy.parity}

## ${copy.validationTitle}

${copy.validation.map((item) => `- ${item}`).join('\n')}
- ${copy.sourceCommit}: [\`${sourceCommit.slice(0, 12)}\`](${commitUrl})
- ${copy.version}: \`${version}\`
`;
  writeFileSync(resolve(outputDir, 'release-notes.md'), notes, 'utf8');

  return { version, normal, high, sourceCommit };
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
