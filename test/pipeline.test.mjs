import assert from 'node:assert/strict';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
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
import { preflightQa, requireChrome } from '../src/preflight.mjs';

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

test('stale cleanup unlinks an owned symlink without deleting its user target', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'readme-press-ownership-symlink-'));
  const output = join(temporary, 'dist');
  mkdirSync(output);
  writeFileSync(join(output, 'user.txt'), 'user content');
  symlinkSync('user.txt', join(output, 'old-generated.txt'));
  writeFileSync(join(output, 'manifest.json'), JSON.stringify({
    generatedFiles: ['manifest.json', 'old-generated.txt'],
  }));
  const staging = createStagingDirectory(output);
  try {
    writeFileSync(join(staging, 'book.pdf'), 'new book');
    writeStagedManifest(staging, { outputs: { normal: { pdf: 'book.pdf' } } });
    const ownership = readGeneratedOwnership(output);
    publishStagedBuild({
      stagingDirectory: staging,
      outputDirectory: output,
      previousFiles: ownership.files,
    });

    assert.deepEqual(ownership.files, ['manifest.json', 'old-generated.txt']);
    assert.equal(readFileSync(join(output, 'user.txt'), 'utf8'), 'user content');
    assert.throws(() => lstatSync(join(output, 'old-generated.txt')), { code: 'ENOENT' });
    assert.doesNotMatch(readFileSync(join(output, 'manifest.json'), 'utf8'), /user\.txt/u);
  } finally {
    removeStagingDirectory(staging);
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('stale owned symlink is removed when its target is a current generated file', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'readme-press-current-target-symlink-'));
  const output = join(temporary, 'dist');
  mkdirSync(output);
  writeFileSync(join(output, 'user.txt'), 'previous user content');
  symlinkSync('user.txt', join(output, 'old-generated.txt'));
  writeFileSync(join(output, 'manifest.json'), JSON.stringify({
    generatedFiles: ['manifest.json', 'old-generated.txt'],
  }));
  const staging = createStagingDirectory(output);

  try {
    writeFileSync(join(staging, 'user.txt'), 'new generated artifact');
    writeStagedManifest(staging, { outputs: {} });
    const ownership = readGeneratedOwnership(output);
    const publication = publishStagedBuild({
      stagingDirectory: staging,
      outputDirectory: output,
      previousFiles: ownership.files,
    });

    assert.equal(readFileSync(join(output, 'user.txt'), 'utf8'), 'new generated artifact');
    assert.throws(() => lstatSync(join(output, 'old-generated.txt')), { code: 'ENOENT' });
    assert.deepEqual(publication.cleanup.removedPaths, ['old-generated.txt']);
    assert.deepEqual(publication.manifest.generatedFiles, ['manifest.json', 'user.txt']);
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
      generatedFiles: [
        null,
        1,
        '',
        '.',
        '../escape',
        '%2e%2e/encoded-escape',
        '/absolute',
        'C:/windows-absolute',
        'line\nbreak.pdf',
        'tab\tbreak.pdf',
        'user.txt\0suffix',
      ],
    }));
    const ownership = readGeneratedOwnership(output);
    assert.deepEqual(ownership.files, []);
    assert.equal(ownership.diagnostics.length, 11);
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

test('publication failures preserve the previous manifest and recover on the next run', () => {
  const scenarios = [
    {
      name: 'second artifact copy',
      operations: () => {
        let copies = 0;
        return {
          copyFile(source, target) {
            copies += 1;
            if (copies === 2) throw new Error('injected second copy failure');
            copyFileSync(source, target);
          },
        };
      },
      error: /injected second copy failure/u,
    },
    {
      name: 'candidate manifest write',
      operations: () => ({
        writeFile() {
          throw new Error('injected manifest write failure');
        },
      }),
      error: /injected manifest write failure/u,
    },
    {
      name: 'manifest swap',
      operations: () => ({
        rename(source, target) {
          if (target.endsWith('manifest.json')) throw new Error('injected manifest swap failure');
          renameSync(source, target);
        },
      }),
      error: /injected manifest swap failure/u,
    },
  ];

  for (const scenario of scenarios) {
    const temporary = mkdtempSync(join(tmpdir(), 'readme-press-publication-failure-'));
    const output = join(temporary, 'dist');
    mkdirSync(output);
    const previousManifest = '{"generatedFiles":["manifest.json","old.pdf"],"build":"previous"}\n';
    writeFileSync(join(output, 'manifest.json'), previousManifest);
    writeFileSync(join(output, 'old.pdf'), 'old artifact');
    writeFileSync(join(output, 'user.txt'), 'user content');
    const staging = createStagingDirectory(output);
    try {
      writeFileSync(join(staging, 'a.pdf'), 'candidate a');
      writeFileSync(join(staging, 'b.pdf'), 'candidate b');
      writeStagedManifest(staging, { build: 'candidate' });

      assert.throws(() => publishStagedBuild({
        stagingDirectory: staging,
        outputDirectory: output,
        previousFiles: ['manifest.json', 'old.pdf'],
        operations: scenario.operations(),
      }), scenario.error, scenario.name);
      assert.equal(readFileSync(join(output, 'manifest.json'), 'utf8'), previousManifest, scenario.name);
      assert.equal(readFileSync(join(output, 'user.txt'), 'utf8'), 'user content', scenario.name);

      const recovered = publishStagedBuild({
        stagingDirectory: staging,
        outputDirectory: output,
        previousFiles: ['manifest.json', 'old.pdf'],
      });
      assert.equal(recovered.manifest.build, 'candidate', scenario.name);
      assert.equal(readFileSync(join(output, 'a.pdf'), 'utf8'), 'candidate a', scenario.name);
      assert.equal(readFileSync(join(output, 'b.pdf'), 'utf8'), 'candidate b', scenario.name);
      assert.equal(readFileSync(join(output, 'user.txt'), 'utf8'), 'user content', scenario.name);
      assert.equal(existsSync(join(output, 'old.pdf')), false, scenario.name);
      assert.equal(
        readdirSync(output).some((name) => name.includes('.readme-press-')),
        false,
        scenario.name,
      );
    } finally {
      removeStagingDirectory(staging);
      rmSync(temporary, { recursive: true, force: true });
    }
  }
});

test('stage reaper preserves ambiguous stages and bounds cleanup telemetry', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'readme-press-stage-matrix-'));
  const output = join(temporary, 'dist');
  const siblingOutput = join(temporary, 'other-dist');
  try {
    const live = createStagingDirectory(output, {
      reap: false,
      owner: { host: 'local-host', pid: 900, timestamp: 1 },
    });
    const foreign = createStagingDirectory(output, {
      reap: false,
      owner: { host: 'foreign-host', pid: 901, timestamp: 1 },
    });
    const sibling = createStagingDirectory(siblingOutput, {
      reap: false,
      owner: { host: 'local-host', pid: 902, timestamp: 1 },
    });
    const symlinkStage = createStagingDirectory(output, {
      reap: false,
      owner: { host: 'local-host', pid: 903, timestamp: 1 },
    });
    const symlinkName = symlinkStage.split('/').at(-1);
    rmSync(symlinkStage, { recursive: true, force: true });
    const symlinkTarget = join(temporary, 'user-stage-target');
    mkdirSync(symlinkTarget);
    writeFileSync(join(symlinkTarget, 'user.txt'), 'user content');
    symlinkSync(symlinkTarget, symlinkStage);
    const malformed = join(temporary, `${live.split('/').at(-1)}.malformed`);
    mkdirSync(malformed);

    const dead = [];
    for (let index = 0; index < 25; index += 1) {
      dead.push(createStagingDirectory(output, {
        reap: false,
        owner: { host: 'local-host', pid: 1000 + index, timestamp: 10 + index },
      }));
    }
    const cleanup = reapAbandonedStagingDirectories(output, {
      now: 10 ** 9,
      host: 'local-host',
      isProcessAlive: (pid) => pid === 900,
      foreignMinAgeMs: 1,
    });

    assert.equal(cleanup.reaped, 25);
    assert.equal(cleanup.paths.length, 20);
    assert.equal(cleanup.truncated, true);
    assert.equal(dead.every((directory) => !existsSync(directory)), true);
    for (const preserved of [live, foreign, sibling, symlinkStage, malformed]) {
      assert.equal(lstatSync(preserved) !== null, true);
    }
    assert.equal(readFileSync(join(symlinkTarget, 'user.txt'), 'utf8'), 'user content');
    assert.equal(symlinkName.startsWith('.readme-press-stage-v1-'), true);
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
      (error) => error.code === 'ERR_PREFLIGHT_TOOL'
        && error.details.tool === 'qpdf'
        && error.details.cause === 'ENOENT'
        && error.cause?.code === 'ENOENT'
        && /Install qpdf/u.test(error.message),
    );
  } finally {
    process.env.PATH = originalPath;
  }
});

test('preflight reports executable permission failures', { skip: process.platform === 'win32' }, () => {
  const temporary = mkdtempSync(join(tmpdir(), 'readme-press-preflight-eacces-'));
  const originalPath = process.env.PATH;
  try {
    writeFileSync(join(temporary, 'qpdf'), '#!/bin/sh\nexit 0\n');
    process.env.PATH = temporary;
    assert.throws(
      () => preflightQa(),
      (error) => error.code === 'ERR_PREFLIGHT_TOOL'
        && error.details.tool === 'qpdf'
        && error.details.cause === 'EACCES'
        && error.cause?.code === 'EACCES',
    );
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('preflight reports unhealthy tool exit status', { skip: process.platform === 'win32' }, () => {
  const temporary = mkdtempSync(join(tmpdir(), 'readme-press-preflight-exit-'));
  const originalPath = process.env.PATH;
  try {
    const qpdf = join(temporary, 'qpdf');
    writeFileSync(qpdf, '#!/bin/sh\nexit 7\n');
    chmodSync(qpdf, 0o755);
    process.env.PATH = temporary;
    assert.throws(
      () => preflightQa(),
      (error) => error.code === 'ERR_PREFLIGHT_TOOL'
        && error.details.tool === 'qpdf'
        && error.details.status === 7
        && error.details.signal === null,
    );
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('preflight reports tool signal termination', { skip: process.platform === 'win32' }, () => {
  const temporary = mkdtempSync(join(tmpdir(), 'readme-press-preflight-signal-'));
  const originalPath = process.env.PATH;
  try {
    const qpdf = join(temporary, 'qpdf');
    writeFileSync(qpdf, '#!/bin/sh\nkill -TERM $$\n');
    chmodSync(qpdf, 0o755);
    process.env.PATH = temporary;
    assert.throws(
      () => preflightQa(),
      (error) => error.code === 'ERR_PREFLIGHT_TOOL'
        && error.details.tool === 'qpdf'
        && error.details.status === null
        && error.details.signal === 'SIGTERM',
    );
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('Chrome discovery errors retain their cause without an undefined path', async () => {
  const discoveryError = new Error(`discovery failed ${'x'.repeat(300)}`);
  await assert.rejects(
    requireChrome({
      executablePath: async () => { throw discoveryError; },
      assertExecutable: () => {},
    }),
    (error) => error.code === 'ERR_PREFLIGHT_CHROME'
      && error.details.executable === '(unknown)'
      && error.details.cause.startsWith('discovery failed')
      && error.details.cause.length === 200
      && error.cause === discoveryError
      && !error.message.includes('undefined'),
  );
});
