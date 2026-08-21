import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  createStagingDirectory,
  publishStagedBuild,
  readGeneratedOwnership,
  removeStagingDirectory,
  writeStagedManifest,
} from '../src/artifacts.mjs';
import { runBuild } from '../src/build.mjs';
import { assertNoDiagnosticErrors, normalizeDiagnostics } from '../src/diagnostics.mjs';
import { preflightQa } from '../src/preflight.mjs';

test('publishes a staged manifest last and removes only previously owned stale files', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'readme-press-publish-'));
  const output = join(temporary, 'dist');
  mkdirSync(output);
  writeFileSync(join(output, 'stale.pdf'), 'stale generated file');
  writeFileSync(join(output, 'user-notes.txt'), 'must survive');
  writeFileSync(join(output, 'manifest.json'), JSON.stringify({
    generatedFiles: ['manifest.json', 'stale.pdf'],
  }));

  const staging = createStagingDirectory(output);
  try {
    mkdirSync(join(staging, 'nested'));
    writeFileSync(join(staging, 'book.pdf'), 'new book');
    writeFileSync(join(staging, 'nested/artifact.txt'), 'new artifact');
    const manifest = writeStagedManifest(staging, { outputs: { normal: { pdf: 'book.pdf' } } });
    const ownership = readGeneratedOwnership(output);
    publishStagedBuild({
      stagingDirectory: staging,
      outputDirectory: output,
      previousFiles: ownership.files,
    });

    assert.equal(readFileSync(join(output, 'book.pdf'), 'utf8'), 'new book');
    assert.equal(readFileSync(join(output, 'nested/artifact.txt'), 'utf8'), 'new artifact');
    assert.equal(readFileSync(join(output, 'user-notes.txt'), 'utf8'), 'must survive');
    assert.equal(existsSync(join(output, 'stale.pdf')), false);
    assert.deepEqual(
      JSON.parse(readFileSync(join(output, 'manifest.json'), 'utf8')).generatedFiles,
      manifest.generatedFiles,
    );
  } finally {
    removeStagingDirectory(staging);
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('a failed build preserves the previous manifest and user files', async () => {
  const temporary = mkdtempSync(join(tmpdir(), 'readme-press-failed-build-'));
  try {
    const output = join(temporary, 'dist');
    mkdirSync(output);
    const previousManifest = '{"generatedFiles":["manifest.json","old.pdf"],"build":"previous"}\n';
    writeFileSync(join(output, 'manifest.json'), previousManifest);
    writeFileSync(join(output, 'old.pdf'), 'old artifact');
    writeFileSync(join(output, 'user-notes.txt'), 'user content');
    writeFileSync(join(temporary, 'README.md'), `# Introduction

Welcome.

# Contents

- [Chapter](#chapter)

# Chapter

![Missing](images/missing.png)
`);
    writeFileSync(join(temporary, 'readme-press.config.mjs'), `export default {
  source: 'README.md',
  outputDir: 'dist',
  theme: 'lapis-rtl',
  metadata: { title: 'Failure fixture', author: 'Author', edition: 'Test' },
  repository: { url: 'https://github.com/example/failure-fixture' },
  cover: { enabled: false },
  structure: {
    introHeading: 'Introduction',
    githubTocHeading: 'Contents',
    parts: [{ title: 'Part', startHeading: 'Chapter' }],
  },
  outputs: { normal: 'book.pdf', high: 'book-high.pdf' },
};
`);

    await assert.rejects(
      runBuild({ configFile: join(temporary, 'readme-press.config.mjs'), quality: 'normal' }),
      /MISSING_FIGURE_FILE/u,
    );
    assert.equal(readFileSync(join(output, 'manifest.json'), 'utf8'), previousManifest);
    assert.equal(readFileSync(join(output, 'old.pdf'), 'utf8'), 'old artifact');
    assert.equal(readFileSync(join(output, 'user-notes.txt'), 'utf8'), 'user content');
    assert.equal(readdirSync(temporary).some((name) => name.startsWith('.readme-press-stage-')), false);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('diagnostic policy promotes warnings only in strict mode', () => {
  const warning = [{ code: 'RAW_HTML_SANITIZED', detail: '<script>' }];
  assert.equal(normalizeDiagnostics(warning, 'warn')[0].severity, 'warning');
  const strict = normalizeDiagnostics(warning, 'strict');
  assert.equal(strict[0].severity, 'error');
  assert.throws(() => assertNoDiagnosticErrors(strict), /RAW_HTML_SANITIZED/u);
});

test('preflight failures name the missing tool and installation path', () => {
  const originalPath = process.env.PATH;
  try {
    process.env.PATH = '';
    assert.throws(
      () => preflightQa(),
      /Required tool "qpdf" was not found\. Install qpdf/u,
    );
  } finally {
    process.env.PATH = originalPath;
  }
});
