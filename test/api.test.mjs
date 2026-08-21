import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import test from 'node:test';
import * as api from '../src/index.mjs';
import { parseCliArgs } from '../src/cli.mjs';

const validConfig = {
  metadata: { title: 'Book', author: 'Author', edition: 'First' },
  repository: { url: 'https://github.com/example/book' },
  structure: {
    introHeading: 'Introduction',
    githubTocHeading: 'Contents',
    parts: [{ title: 'Part', startHeading: 'Chapter' }],
  },
};

test('the documented library API is available at runtime', () => {
  assert.deepEqual(Object.keys(api).sort(), [
    'GithubSlugger',
    'ReadmePressError',
    'defineConfig',
    'loadConfig',
    'looseAnchor',
    'normalizeReleaseVersion',
    'prepareRelease',
    'runBuild',
    'runQa',
    'selectBook',
    'transformReadme',
    'validateConfig',
    'verifyRenderedPages',
    'wrapLatinHtml',
  ]);
  const error = new api.ReadmePressError('Failure', {
    code: 'ERR_EXAMPLE',
    details: { field: 'value' },
    cause: new Error('cause'),
  });
  assert.equal(error.code, 'ERR_EXAMPLE');
  assert.deepEqual(error.details, { field: 'value' });
  assert.equal(error.cause.message, 'cause');
});

test('Zod validation warns for unknown core keys and leaves qa/release extensible', () => {
  const result = api.validateConfig({
    ...validConfig,
    typoKey: true,
    qa: { projectSpecificGate: true },
    release: { providerSpecificCopy: 'value' },
  }, { strict: false });
  assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.detail), ['typoKey']);
  assert.throws(
    () => api.validateConfig({ ...validConfig, typoKey: true }),
    (error) => error.code === 'ERR_CONFIG_UNKNOWN_KEYS'
      && error.details.keys.includes('typoKey'),
  );
  assert.throws(
    () => api.validateConfig({ ...validConfig, metadata: { ...validConfig.metadata, title: 42 } }),
    (error) => error.code === 'ERR_CONFIG_VALIDATION'
      && error.details.issues.length > 0,
  );
});

test('configuration contracts accept valid chapter rules and reject inert or mistyped security rules', () => {
  const chapter = api.validateConfig({
    ...validConfig,
    contentRules: { chapterClassRules: [{ titleStartsWith: 'Chapter', className: 'chapter-special' }] },
  });
  assert.deepEqual(chapter.diagnostics, []);
  assert.throws(
    () => api.validateConfig({
      ...validConfig,
      contentRules: { paragraphClassRules: [{ className: 'never-matches' }] },
    }),
    (error) => error.code === 'ERR_CONFIG_VALIDATION'
      && /contentRules\.paragraphClassRules\.0/u.test(error.message)
      && /contains or startsWith/u.test(error.message),
  );
  assert.throws(
    () => api.validateConfig({
      ...validConfig,
      contentRules: { calloutClassRules: [{ className: 'never-matches' }] },
    }),
    (error) => error.code === 'ERR_CONFIG_VALIDATION'
      && /contentRules\.calloutClassRules\.0/u.test(error.message)
      && /contains or startsWith/u.test(error.message),
  );
  assert.throws(
    () => api.validateConfig({ ...validConfig, security: { netwrok: 'deny' } }),
    (error) => error.code === 'ERR_CONFIG_UNKNOWN_SECURITY_KEYS'
      && error.details.keys.includes('security.netwrok'),
  );
  assert.throws(
    () => api.validateConfig({
      ...validConfig,
      security: { network: { mode: 'deny', allowHost: ['example.com'] } },
    }),
    (error) => error.code === 'ERR_CONFIG_UNKNOWN_SECURITY_KEYS'
      && error.details.keys.includes('security.network.allowHost'),
  );
});

test('CLI parsing rejects missing, unknown, and repeated options with usage exit code', () => {
  for (const args of [
    ['build', '--config'],
    ['build', '--unknown'],
    ['build', '--config', 'one.mjs', '--config', 'two.mjs'],
    ['pipeline', '--config', 'book.mjs'],
  ]) {
    assert.throws(
      () => parseCliArgs(args),
      (error) => error.code === 'ERR_CLI_USAGE' && error.exitCode === 2,
    );
  }
  const parsed = parseCliArgs([
    'release',
    'verify-render',
    '--manifest',
    'dist/manifest.json',
    '--directory',
    'normal',
    '--directory',
    'high',
  ]);
  assert.equal(parsed.command, 'release-verify-render');
  assert.equal(parsed.directories.length, 2);
});

test('CLI output is concise by default and includes a stack only in debug mode', () => {
  const cli = resolve('bin/readme-press.mjs');
  const concise = spawnSync(process.execPath, [cli, 'build', '--unknown'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(concise.status, 2);
  assert.match(concise.stderr, /Unknown option '--unknown'/u);
  assert.doesNotMatch(concise.stderr, /\n\s+at /u);

  const debug = spawnSync(process.execPath, [cli, 'build', '--unknown', '--debug'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(debug.status, 2);
  assert.match(debug.stderr, /ReadmePressError/u);
  assert.match(debug.stderr, /\n\s+at /u);
});
