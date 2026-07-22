import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { loadConfig } from '../src/config.mjs';
import { normalizeReleaseVersion, prepareRelease, verifyRenderedPages } from '../src/release.mjs';
import { selectBook, transformReadme } from '../src/transform.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('accepts stable and prerelease semantic versions', () => {
  assert.equal(normalizeReleaseVersion('v1.0.0'), 'v1.0.0');
  assert.equal(normalizeReleaseVersion('v2.4.1-rc.2'), 'v2.4.1-rc.2');
});

test('rejects malformed semantic versions', () => {
  for (const value of ['1.0.0', 'v1.0', 'v01.0.0', 'v1.0.0-rc.01']) {
    assert.throws(() => normalizeReleaseVersion(value));
  }
});

test('loads and resolves a consumer configuration', async () => {
  const config = await loadConfig('test/fixtures/basic/readme-press.config.mjs', root);
  assert.equal(config.metadata.title, 'Press');
  assert.equal(config.outputs.normal, 'fixture-book.pdf');
  assert.ok(config.sourcePath.endsWith('/test/fixtures/basic/README.md'));
  assert.ok(config.theme.stylesheet.endsWith('/themes/lapis-rtl/book.css'));
});

test('selects an introduction and configured parts without project knowledge', () => {
  const tree = unified().use(remarkParse).parse(`# Intro

Welcome.

# Contents

- A

# Alpha

Body.

# Beta

Body.
`);
  const result = selectBook(tree, {
    introHeading: 'Intro',
    githubTocHeading: 'Contents',
    parts: [{ title: 'Part one', startHeading: 'Alpha' }],
  });
  assert.equal(result.parts.length, 1);
  assert.equal(result.chapters.length, 3);
  assert.equal(result.chapters[0].isIntroduction, true);
  assert.equal(result.chapters[1].isPartStart, true);
});

test('recognizes both leading and RTL-safe trailing callout markers', async () => {
  const result = await transformReadme(`# Introduction

> 💡 Legacy leading marker.

> متن فارسی با شروع درست 💡

> هشدار چندبخشی ⚠️
> ادامه هشدار.

# Contents

- [Chapter](#chapter)

# Chapter

Body.
`, {
    repository: { url: 'https://github.com/example/book', branch: 'main' },
    images: { classRules: [] },
    contentRules: { calloutClassRules: [], paragraphClassRules: [] },
    mermaid: {},
    structure: {
      introHeading: 'Introduction',
      githubTocHeading: 'Contents',
      parts: [{ title: 'Part one', startHeading: 'Chapter' }],
    },
    toc: { maxDepth: 2 },
  });
  const html = result.chapters.map((chapter) => chapter.html).join('\n');
  assert.equal((html.match(/callout-tip/g) ?? []).length, 2);
  assert.equal((html.match(/callout-warn/g) ?? []).length, 1);
  assert.doesNotMatch(html, /Legacy leading marker\.\s*💡|متن فارسی با شروع درست\s*💡/u);
});

test('prepares checksums and neutral release notes from verified outputs', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'readme-press-release-'));
  try {
    const dist = join(temporary, 'dist');
    mkdirSync(dist);
    const outputs = {};
    for (const [quality, name] of [
      ['normal', 'book.pdf'],
      ['high', 'book-high.pdf'],
    ]) {
      const bytes = Buffer.from(`${quality} pdf`);
      writeFileSync(join(dist, name), bytes);
      outputs[quality] = {
        pdf: name,
        pageCount: 8,
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
    }
    const commit = 'a'.repeat(40);
    const manifestPath = join(dist, 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify({
      releaseVersion: 'v1.0.0',
      sourceCommit: commit,
      metadata: { title: 'Example book' },
      repository: { url: 'https://github.com/example/book' },
      outputs,
    }));

    const result = prepareRelease({ version: 'v1.0.0', manifestPath, outputDir: dist, commit });
    assert.equal(result.normal.pageCount, 8);
    assert.match(readFileSync(join(dist, 'SHA256SUMS.txt'), 'utf8'), /book-high\.pdf/);
    assert.match(readFileSync(join(dist, 'release-notes.md'), 'utf8'), /Example book/);
    assert.match(readFileSync(join(dist, 'release-notes.md'), 'utf8'), /github\.com\/example\/book\/commit/);
    assert.throws(() => prepareRelease({
      version: 'v1.0.0',
      manifestPath,
      outputDir: dist,
      commit: 'b'.repeat(40),
    }), /does not match release commit/);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('verifies every requested render directory against the manifest', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'readme-press-render-'));
  try {
    const normal = join(temporary, 'normal');
    const high = join(temporary, 'high');
    mkdirSync(normal);
    mkdirSync(high);
    const manifestPath = join(temporary, 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify({ outputs: { normal: { pageCount: 2 } } }));
    for (const directory of [normal, high]) {
      writeFileSync(join(directory, 'page-1.png'), 'a');
      writeFileSync(join(directory, 'page-2.png'), 'b');
    }
    assert.equal(verifyRenderedPages({ manifestPath, directories: [normal, high] }), 2);
    writeFileSync(join(high, 'page-3.png'), 'c');
    assert.throws(() => verifyRenderedPages({ manifestPath, directories: [normal, high] }));
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('production theme exposes one cover entrypoint', () => {
  const themeFiles = readdirSync(join(root, 'themes/lapis-rtl'));
  assert.deepEqual(themeFiles.filter((name) => name.endsWith('.html')), ['cover.html']);
});
