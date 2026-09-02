import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveManifestPdfPath } from '../src/manifest.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const manifests = process.argv.slice(2);
if (!manifests.length) {
  manifests.push(
    resolve(here, 'fixtures/basic/dist-test/manifest.json'),
    resolve(here, 'fixtures/persian/dist-test/manifest.json'),
  );
}

for (const manifestFile of manifests) {
  const manifestPath = resolve(manifestFile);
  const outputDirectory = dirname(manifestPath);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const physicalOutputs = new Set();
  const entries = Object.entries(manifest.outputs ?? {});
  assert.ok(entries.length > 0, `Manifest has no outputs: ${manifestPath}`);

  for (const [quality, output] of entries) {
    const pdfPath = resolveManifestPdfPath(outputDirectory, output, { quality });
    const physicalPath = realpathSync(pdfPath);
    assert.equal(
      physicalOutputs.has(physicalPath),
      false,
      `Manifest outputs share one physical PDF: ${physicalPath}`,
    );
    physicalOutputs.add(physicalPath);
    const bytes = readFileSync(pdfPath);
    assert.equal(statSync(pdfPath).size, output.bytes, `${quality} byte count does not match`);
    assert.equal(
      createHash('sha256').update(bytes).digest('hex'),
      output.sha256,
      `${quality} SHA-256 does not match its physical PDF`,
    );
  }

  console.log(`Verified ${entries.length} distinct manifest PDFs: ${manifestPath}`);
}
