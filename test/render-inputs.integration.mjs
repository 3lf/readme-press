import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import sharp from 'sharp';
import { runBuild } from '../src/build.mjs';
import { runQa } from '../src/qa.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

test('a built PDF is current only while effective render inputs are unchanged', { timeout: 180_000 }, async () => {
  const temporary = mkdtempSync(join(tmpdir(), 'readme-press-freshness-'));
  try {
    const theme = join(temporary, 'theme');
    cpSync(join(root, 'themes/lapis-rtl'), theme, { recursive: true });
    cpSync(join(root, 'test/fixtures/basic/README.md'), join(temporary, 'README.md'));
    await sharp({ create: { width: 20, height: 20, channels: 3, background: '#123456' } })
      .png().toFile(join(temporary, 'figure.png'));
    const fixture = await import('./fixtures/basic/readme-press.config.mjs');
    const config = {
      ...fixture.default,
      theme: { directory: theme },
      cover: { enabled: false },
      outputDir: 'dist',
    };
    const configFile = join(temporary, 'readme-press.config.mjs');
    const writeConfig = () => writeFileSync(configFile, `export default ${JSON.stringify(config, null, 2)};\n`);
    writeConfig();

    await runBuild({ configFile, quality: 'normal' });
    await runQa({ configFile, quality: 'normal' });

    config.qa = { ...config.qa, minPages: 2 };
    writeConfig();
    await runQa({ configFile, quality: 'normal' });

    const css = join(theme, 'book.css');
    const originalCss = readFileSync(css);
    writeFileSync(css, Buffer.concat([originalCss, Buffer.from('\n/* changed */\n')]));
    await assert.rejects(runQa({ configFile, quality: 'normal' }), /stale build: render inputs changed/u);
    writeFileSync(css, originalCss);

    config.labels = { ...config.labels, tocTitle: 'A changed contents label' };
    writeConfig();
    await assert.rejects(runQa({ configFile, quality: 'normal' }), /stale build: render inputs changed/u);
    config.labels = fixture.default.labels;
    writeConfig();

    const font = join(theme, 'fonts/JetBrainsMono-Regular.woff2');
    const originalFont = readFileSync(font);
    writeFileSync(font, Buffer.concat([originalFont, Buffer.from('changed')]));
    await assert.rejects(runQa({ configFile, quality: 'normal' }), /stale build: render inputs changed/u);
    writeFileSync(font, originalFont);

    await sharp({ create: { width: 20, height: 20, channels: 3, background: '#abcdef' } })
      .png().toFile(join(temporary, 'new-figure.png'));
    cpSync(join(temporary, 'new-figure.png'), join(temporary, 'figure.png'));
    await assert.rejects(runQa({ configFile, quality: 'normal' }), /stale build: render inputs changed/u);

    writeFileSync(join(temporary, 'README.md'), `${readFileSync(join(temporary, 'README.md'), 'utf8')}\nA changed paragraph.\n`);
    await assert.rejects(runQa({ configFile, quality: 'normal' }), /stale build: render inputs changed/u);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
