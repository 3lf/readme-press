import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import test from 'node:test';
import {
  createStagingDirectory,
  publishStagedBuild,
  readGeneratedOwnership,
  reapAbandonedStagingDirectories,
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

test('canonical ownership aliases cannot delete a newly published artifact', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'readme-press-ownership-alias-'));
  const output = join(temporary, 'dist');
  mkdirSync(output);
  writeFileSync(join(output, 'manifest.json'), JSON.stringify({ generatedFiles: ['./book.pdf'] }));
  const staging = createStagingDirectory(output);
  try {
    writeFileSync(join(staging, 'book.pdf'), 'new book');
    writeStagedManifest(staging, { outputs: { normal: { pdf: 'book.pdf' } } });
    const ownership = readGeneratedOwnership(output);
    assert.deepEqual(ownership.files, ['book.pdf']);
    publishStagedBuild({ stagingDirectory: staging, outputDirectory: output, previousFiles: ownership.files });
    assert.equal(readFileSync(join(output, 'book.pdf'), 'utf8'), 'new book');
  } finally {
    removeStagingDirectory(staging);
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('rejects malformed ownership records without claiming user files', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'readme-press-invalid-ownership-'));
  const output = join(temporary, 'dist');
  mkdirSync(output);
  try {
    writeFileSync(join(output, 'user.txt'), 'user content');
    writeFileSync(join(output, 'manifest.json'), JSON.stringify({
      generatedFiles: [null, 1, '', '.', '../escape', '/absolute', 'user.txt\0suffix'],
    }));
    const ownership = readGeneratedOwnership(output);
    assert.deepEqual(ownership.files, []);
    assert.equal(ownership.diagnostics.length, 7);
    assert.equal(readFileSync(join(output, 'user.txt'), 'utf8'), 'user content');
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('cleanup failures leave the previous manifest authoritative', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'readme-press-manifest-last-'));
  const output = join(temporary, 'dist');
  const outside = join(temporary, 'outside');
  mkdirSync(output);
  mkdirSync(outside);
  const previousManifest = '{"generatedFiles":["linked/stale.pdf"],"build":"previous"}\n';
  writeFileSync(join(output, 'manifest.json'), previousManifest);
  symlinkSync(outside, join(output, 'linked'));
  const staging = createStagingDirectory(output);
  try {
    writeFileSync(join(staging, 'book.pdf'), 'new book');
    writeStagedManifest(staging, { build: 'candidate' });
    assert.throws(() => publishStagedBuild({
      stagingDirectory: staging,
      outputDirectory: output,
      previousFiles: ['linked/stale.pdf'],
    }), /symbolic link/u);
    assert.equal(readFileSync(join(output, 'manifest.json'), 'utf8'), previousManifest);
  } finally {
    removeStagingDirectory(staging);
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('reaps only dead same-output staging directories', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'readme-press-stage-reaper-'));
  const output = join(temporary, 'dist');
  try {
    const abandoned = createStagingDirectory(output, {
      reap: false,
      owner: { host: 'test-host', pid: 111, timestamp: 1 },
    });
    const current = createStagingDirectory(output, {
      reap: false,
      owner: { host: 'test-host', pid: 222, timestamp: 2 },
    });
    writeFileSync(join(abandoned, 'partial.pdf'), 'partial');
    const cleanup = reapAbandonedStagingDirectories(output, {
      now: 10_000,
      host: 'test-host',
      isProcessAlive: (pid) => pid === 222,
      foreignMinAgeMs: 60_000,
    });
    assert.equal(existsSync(abandoned), false);
    assert.equal(existsSync(current), true);
    assert.equal(cleanup.reaped, 1);
    assert.deepEqual(cleanup.paths, [abandoned.split('/').at(-1)]);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('a failed build preserves the previous manifest and user files', async () => {
  const temporary = mkdtempSync(join(tmpdir(), 'readme-press-failed-build-'));
  const originalPath = process.env.PATH;
  try {
    const tools = join(temporary, 'tools');
    mkdirSync(tools);
    const fakeQpdf = join(tools, process.platform === 'win32' ? 'qpdf.cmd' : 'qpdf');
    writeFileSync(fakeQpdf, process.platform === 'win32'
      ? '@exit /b 0\r\n'
      : '#!/bin/sh\nexit 0\n');
    if (process.platform !== 'win32') chmodSync(fakeQpdf, 0o755);
    process.env.PATH = `${tools}${delimiter}${originalPath ?? ''}`;

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
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
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

test('diagnostic normalization deduplicates code and detail with highest severity', () => {
  assert.deepEqual(normalizeDiagnostics([
    { code: 'RAW_HTML_SANITIZED', detail: '<script>' },
    { code: 'RAW_HTML_SANITIZED', detail: '<script>', severity: 'error' },
    { code: 'RAW_HTML_SANITIZED', detail: '<style>' },
  ], 'warn'), [
    { code: 'RAW_HTML_SANITIZED', detail: '<script>', severity: 'error' },
    { code: 'RAW_HTML_SANITIZED', detail: '<style>', severity: 'warning' },
  ]);
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
