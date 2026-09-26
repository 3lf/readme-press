import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { loadConfig } from '../src/config.mjs';
import { buildDocument } from '../src/template.mjs';
import { transformReadme } from '../src/transform.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/2ioAAAAASUVORK5CYII=',
  'base64',
);

test('the documented minimal English config generates English labels, punctuation, and counters', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'readme-press-english-locale-'));
  try {
    writeFileSync(join(directory, 'README.md'), `# Introduction

An English introduction.

# Contents

- [First chapter](#first-chapter)

# First chapter

English body text.

![](figure.png)
`);
    writeFileSync(join(directory, 'figure.png'), tinyPng);
    writeFileSync(join(directory, 'readme-press.config.mjs'), `export default {
  source: "README.md",
  outputDir: "dist",
  metadata: {
    title: "My Book",
    subtitle: "A practical guide",
    author: "Example Author",
    edition: "First edition · 2026",
    language: "en",
    direction: "ltr"
  },
  repository: { url: "https://github.com/example/my-book" },
  structure: {
    introHeading: "Introduction",
    githubTocHeading: "Contents",
    parts: [{ title: "Foundations", startHeading: "First chapter" }]
  },
  outputs: {
    normal: "my-book.pdf",
    print: "my-book-print.pdf",
    high: "my-book-high-quality.pdf"
  }
};`);

    const config = await loadConfig('readme-press.config.mjs', directory);
    assert.equal(config.metadata.numerals, 'latin');
    assert.equal(config.labels.partOf, 'of');
    assert.equal(config.labels.imageAlt, 'Image');
    assert.equal(config.cover.series, config.labels.coverSeries);
    assert.match(config.cover.repositoryNote, /^Get the latest edition/u);

    const result = await transformReadme(readFileSync(config.sourcePath, 'utf8'), config, {
      sourceDir: dirname(config.sourcePath),
    });
    const html = buildDocument(result, config);
    assert.match(html, /<html lang="en" dir="ltr"/u);
    assert.match(html, /<title>My Book; First edition · 2026<\/title>/u);
    assert.match(html, /Part 1 of 1/u);
    assert.match(html, /alt="Image"/u);
    assert.match(html, /content: target-counter\(attr\(href\), page, decimal\)/u);
    assert.match(html, /@page toc \{ @top-center \{ content: "Contents";/u);
    assert.doesNotMatch(html, /\p{Script=Arabic}/u);

    const regionalConfig = readFileSync(join(directory, 'readme-press.config.mjs'), 'utf8')
      .replace('language: "en",\n    direction: "ltr"', 'language: "fa-IR"');
    writeFileSync(join(directory, 'regional.config.mjs'), regionalConfig);
    const regional = await loadConfig('regional.config.mjs', directory);
    assert.equal(regional.metadata.direction, 'rtl');
    assert.equal(regional.metadata.numerals, 'persian');
    assert.equal(regional.labels.partOf, 'از');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Persian defaults and explicit overrides control generated text without rewriting author content', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'readme-press-locale-override-'));
  try {
    const persian = await loadConfig('test/fixtures/persian/readme-press.config.mjs', root);
    assert.equal(persian.labels.partOf, 'از');
    assert.equal(persian.labels.imageAlt, 'تصویر');
    assert.equal(persian.labels.metadataSeparator, '؛');
    assert.equal(persian.metadata.numerals, 'persian');

    const english = await loadConfig('test/fixtures/basic/readme-press.config.mjs', root);
    const overridden = {
      ...english,
      contentRoot: directory,
      labels: { ...english.labels, partOf: 'from', tocTitle: 'Index', imageAlt: 'Illustration' },
      metadata: { ...english.metadata, numerals: 'persian' },
    };
    writeFileSync(join(directory, 'figure.png'), tinyPng);
    const result = await transformReadme(`# Introduction

Intentional فارسی content.

# Contents

# Building a reliable book

![](figure.png)
`, overridden, { sourceDir: directory });
    const html = buildDocument(result, overridden);
    assert.match(html, /Part ۱ from ۱/u);
    assert.match(html, /alt="Illustration"/u);
    assert.match(html, /content: target-counter\(attr\(href\), page, persian\)/u);
    assert.match(html, /content: "Index"/u);
    assert.match(html, /فارسی/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
