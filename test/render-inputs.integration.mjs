import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
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

function minimalBook(temporary) {
  const theme = join(temporary, 'theme');
  mkdirSync(theme);
  writeFileSync(join(theme, 'book.css'), '@page { size: 17cm 24cm; margin: 1.2cm; } body { font-family: sans-serif; } .frontmatter, .toc, .chapter { break-before: page; }');
  writeFileSync(join(temporary, 'README.md'), '# Introduction\n\nA short introduction.\n\n# Contents\n\n- Building a reliable book\n\n# Building a reliable book\n\nA small chapter.\n');
  return {
    source: 'README.md',
    outputDir: 'dist',
    theme: { directory: theme },
    metadata: { title: 'Minimal book', author: 'README Press', edition: 'First edition', language: 'en', direction: 'ltr', numerals: 'latin' },
    repository: { url: 'https://github.com/3lf/readme-press' },
    cover: { enabled: false },
    structure: { introHeading: 'Introduction', githubTocHeading: 'Contents', parts: [{ title: 'A small book', startHeading: 'Building a reliable book' }] },
    outputs: { normal: 'book.pdf', high: 'book-high.pdf', print: 'book-print.pdf' },
    qa: { minPages: 1, maxPages: 12, minimumDestinations: 0, fontFamilies: [], extractablePhrases: ['A small chapter.'], expectedLinks: [] },
  };
}

function saveConfig(temporary, config) {
  const configFile = join(temporary, 'readme-press.config.mjs');
  writeFileSync(configFile, `export default ${JSON.stringify(config, null, 2)};\n`);
  return configFile;
}

test('themes without Mermaid assets build and pass QA until a diagram uses them', { timeout: 180_000 }, async () => {
  const temporary = mkdtempSync(join(tmpdir(), 'readme-press-optional-mermaid-'));
  const previousCi = process.env.CI;
  try {
    const configFile = saveConfig(temporary, minimalBook(temporary));
    for (const ci of [undefined, 'true']) {
      if (ci === undefined) delete process.env.CI;
      else process.env.CI = ci;
      await runBuild({ configFile, quality: 'normal' });
      await runQa({ configFile, quality: 'normal' });
      const manifest = JSON.parse(readFileSync(join(temporary, 'dist/manifest.json')));
      assert.equal(manifest.renderInputs.renderer.ciMermaidConfig, false);
      assert.ok(!manifest.renderInputs.files.some(({ path }) => /mermaid.config.json|puppeteer-ci.json|Vazirmatn-Variable.woff2/u.test(path)));
    }
    writeFileSync(join(temporary, 'README.md'), `${readFileSync(join(temporary, 'README.md'), 'utf8')}\n\`\`\`mermaid\ngraph TD; A-->B;\n\`\`\`\n`);
    await assert.rejects(runBuild({ configFile, quality: 'normal' }), /ENOENT|does not exist|no such file/iu);
  } finally {
    if (previousCi === undefined) delete process.env.CI;
    else process.env.CI = previousCi;
    rmSync(temporary, { recursive: true, force: true });
  }
});

async function customCover(temporary) {
  const directory = join(temporary, 'custom cover');
  mkdirSync(directory);
  const image = join(directory, 'logo %#.png');
  await sharp({ create: { width: 20, height: 20, channels: 3, background: '#dd2244' } }).png().toFile(image);
  const printImage = join(directory, 'print.png');
  await sharp({ create: { width: 20, height: 20, channels: 3, background: '#222222' } }).png().toFile(printImage);
  const font = join(directory, 'cover font.woff2');
  cpSync(join(root, 'themes/lapis-rtl/fonts/JetBrainsMono-Regular.woff2'), font);
  const imported = join(directory, 'imported.css');
  writeFileSync(imported, '@font-face { font-family: CoverFont; src: url("cover%20font.woff2?font=1"); } .repo-url { font-family: CoverFont; }');
  const stylesheet = join(directory, 'cover.css');
  writeFileSync(stylesheet, '@import url("imported.css?import=1"); html,body { margin: 0; } .cover { box-sizing: border-box; padding: 1cm; width: 17cm; height: 24cm; background: #fff; } body[data-readme-press-variant="print"] .cover { background-image: url("print.png?variant=print"); background-repeat: no-repeat; background-position: center; }');
  const html = join(directory, 'cover.html');
  writeFileSync(html, '<!doctype html><html><head><link rel="stylesheet" href="cover.css?style=1"></head><body><div class="cover"><img id="logo" src="logo%20%25%23.png?image=1"><p class="repo-url">README Press</p></div></body></html>');
  return { html, image, printImage, stylesheet, imported, font };
}

test('custom cover dependencies outside the theme invalidate old PDFs', { timeout: 240_000 }, async () => {
  const temporary = mkdtempSync(join(tmpdir(), 'readme-press-cover-freshness-'));
  try {
    const config = minimalBook(temporary);
    const cover = await customCover(temporary);
    config.cover = { enabled: true, file: cover.html };
    config.page = { coverDpi: 96 };
    const configFile = saveConfig(temporary, config);
    await runBuild({ configFile, quality: 'all' });
    await runQa({ configFile, quality: 'all', renderAll: true });
    const manifest = JSON.parse(readFileSync(join(temporary, 'dist/manifest.json')));
    assert.deepEqual(manifest.renderInputs.assets.cover, Object.values(cover).sort());
    for (const path of [cover.image, cover.stylesheet, cover.imported, cover.font, cover.printImage]) {
      const original = readFileSync(path);
      writeFileSync(path, Buffer.concat([original, Buffer.from('\nchanged\n')]));
      await assert.rejects(runQa({ configFile, quality: 'all' }), /stale build: render inputs changed/u);
      writeFileSync(path, original);
    }
    writeFileSync(join(temporary, 'custom cover/unrelated.png'), 'not a cover dependency');
    await runQa({ configFile, quality: 'all' });
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('cover mutations during rendering reject the build and preserve last-good outputs', { timeout: 240_000 }, async () => {
  const temporary = mkdtempSync(join(tmpdir(), 'readme-press-cover-mutation-'));
  let mutate = false;
  let mutations = 0;
  let image;
  const server = createServer((_request, response) => {
    if (mutate) {
      writeFileSync(image, Buffer.concat([readFileSync(image), Buffer.from('changed')]));
      mutations += 1;
    }
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.end('ok');
  });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  try {
    const config = minimalBook(temporary);
    const cover = await customCover(temporary);
    image = cover.image;
    const trigger = `http://127.0.0.1:${server.address().port}/after-image`;
    writeFileSync(cover.html, readFileSync(cover.html, 'utf8').replace('</body>', `<script>document.querySelector('#logo').decode().then(() => fetch('${trigger}'));</script></body>`));
    config.cover = { enabled: true, file: cover.html };
    config.page = { coverDpi: 96 };
    config.security = { network: 'trusted' };
    const configFile = saveConfig(temporary, config);
    await runBuild({ configFile, quality: 'normal' });
    const manifestPath = join(temporary, 'dist/manifest.json');
    const pdfPath = join(temporary, 'dist/book.pdf');
    const previousManifest = readFileSync(manifestPath);
    const previousPdf = readFileSync(pdfPath);
    mutate = true;
    await assert.rejects(runBuild({ configFile, quality: 'normal' }), /Render inputs changed during build/u);
    assert.ok(mutations > 0, 'the image mutation was triggered after browser consumption');
    assert.deepEqual(readFileSync(manifestPath), previousManifest);
    assert.deepEqual(readFileSync(pdfPath), previousPdf);
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
    rmSync(temporary, { recursive: true, force: true });
  }
});
