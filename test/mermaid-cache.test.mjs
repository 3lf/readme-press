import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { mermaidCacheKey, renderMermaid } from '../src/mermaid.mjs';

test('Mermaid cache and embedded font change with every SVG input', async () => {
  const temporary = mkdtempSync(join(tmpdir(), 'readme-press-mermaid-key-'));
  try {
    const configPath = join(temporary, 'mermaid.json');
    const fontPath = join(temporary, 'font.woff2');
    const mmdcPath = join(temporary, 'mmdc');
    const puppeteerConfig = join(temporary, 'puppeteer.json');
    writeFileSync(configPath, '{}');
    writeFileSync(fontPath, 'font-one');
    writeFileSync(puppeteerConfig, '{}');
    writeFileSync(mmdcPath, `#!/bin/sh
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then shift; output="$1"; fi
  shift
done
printf '<svg viewBox="0 0 100 50" width="100%%"></svg>' > "$output"
`);
    chmodSync(mmdcPath, 0o755);
    const options = {
      cacheDir: join(temporary, 'cache'), configPath, fontPath,
      fontFamily: 'Test Font', mmdcPath, puppeteerConfig,
    };
    const source = 'graph TD\nA-->B';
    const first = await renderMermaid(source, options);
    const firstSvg = readFileSync(first.path, 'utf8');
    assert.match(firstSvg, /font-family:"Test Font"/u);
    assert.ok(firstSvg.includes(Buffer.from('font-one').toString('base64')));
    const repeat = await renderMermaid(source, options);
    assert.equal(repeat.file, first.file);

    writeFileSync(fontPath, 'font-two');
    const second = await renderMermaid(source, options);
    assert.notEqual(second.file, first.file);
    assert.ok(readFileSync(second.path, 'utf8').includes(Buffer.from('font-two').toString('base64')));
    assert.ok(!readFileSync(second.path, 'utf8').includes(Buffer.from('font-one').toString('base64')));

    const family = await renderMermaid(source, { ...options, fontFamily: 'Other Font' });
    assert.notEqual(family.file, second.file);
    assert.match(readFileSync(family.path, 'utf8'), /font-family:"Other Font"/u);
    writeFileSync(configPath, '{"theme":"dark"}');
    assert.notEqual(mermaidCacheKey(source, options), second.file.replace('.svg', ''));
    const changedConfig = await renderMermaid(source, options);
    assert.notEqual(changedConfig.file, second.file);
    writeFileSync(mmdcPath, `${readFileSync(mmdcPath, 'utf8')}\n# changed renderer\n`);
    const changedRenderer = await renderMermaid(source, options);
    assert.notEqual(changedRenderer.file, changedConfig.file);
    assert.notEqual(mermaidCacheKey(`${source}\nB-->C`, options), changedRenderer.file.replace('.svg', ''));

    const previousCi = process.env.CI;
    try {
      process.env.CI = '1';
      const before = mermaidCacheKey(source, options);
      writeFileSync(puppeteerConfig, '{"args":["--no-sandbox"]}');
      assert.notEqual(mermaidCacheKey(source, options), before);
    } finally {
      if (previousCi === undefined) delete process.env.CI;
      else process.env.CI = previousCi;
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
