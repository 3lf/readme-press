import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { runBuild } from '../src/build.mjs';
import { loadConfig } from '../src/config.mjs';
import { runQa } from '../src/qa.mjs';

const root = resolve(import.meta.dirname, '..');
const configFile = 'test/fixtures/basic/readme-press.compat.config.mjs';
const outputDir = resolve(root, 'test/fixtures/basic/dist-compat-0.2.1');
const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

try {
  const config = await loadConfig(configFile, root);
  assert.equal(config.security.diagnostics, 'strict');

  const manifest = await runBuild({ configFile, quality: 'all' });
  const compatibilityWarnings = manifest.diagnostics.filter(
    ({ code }) => code === 'SECURITY_DEFAULTS_DEPRECATED',
  );
  const diagnosticErrors = manifest.diagnostics.filter(({ severity }) => severity === 'error');
  assert.equal(diagnosticErrors.length, 0);

  if (version.startsWith('0.2.')) {
    assert.equal(config.security.rawHtml, 'trusted');
    assert.equal(config.security.network.mode, 'trusted');
    assert.equal(config.security.strictConfig, undefined);
    assert.equal(compatibilityWarnings.length, 1);
    assert.equal(compatibilityWarnings[0].severity, 'warning');
    assert.equal(compatibilityWarnings[0].promoteInStrict, false);
  } else {
    assert.equal(compatibilityWarnings.length, 0);
  }

  const qa = await runQa({ configFile, quality: 'all' });
  assert.equal(qa.failures, 0);
  console.log(`Compatibility build passed for README Press ${version}.`);
} finally {
  rmSync(outputDir, { recursive: true, force: true });
}
