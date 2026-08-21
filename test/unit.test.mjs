import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { loadConfig } from '../src/config.mjs';
import { captureStableScreenshot } from '../src/cover.mjs';
import { normalizeReleaseVersion, prepareRelease, verifyRenderedPages } from '../src/release.mjs';
import { selectBook, transformReadme } from '../src/transform.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('reports the package version through every supported CLI form', () => {
  const cli = join(root, 'bin/readme-press.mjs');
  const expected = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  for (const argument of ['version', '--version', '-v']) {
    const actual = execFileSync(process.execPath, [cli, argument], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    assert.equal(actual, expected);
  }
});

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
  assert.equal(config.outputs.print, 'fixture-book-print.pdf');
  assert.ok(config.sourcePath.endsWith('/test/fixtures/basic/README.md'));
  assert.ok(config.theme.stylesheet.endsWith('/themes/lapis-rtl/book.css'));
});

test('keeps print output opt-in for existing configurations', async () => {
  const temporary = mkdtempSync(join(tmpdir(), 'readme-press-config-'));
  try {
    writeFileSync(join(temporary, 'README.md'), '# Introduction\n\n# Contents\n\n# Chapter\n');
    writeFileSync(join(temporary, 'readme-press.config.mjs'), `export default {
  source: 'README.md',
  metadata: { title: 'Legacy', author: 'Author', edition: 'First edition' },
  repository: { url: 'https://github.com/example/legacy' },
  cover: { enabled: false },
  structure: {
    introHeading: 'Introduction',
    githubTocHeading: 'Contents',
    parts: [{ title: 'Part', startHeading: 'Chapter' }],
  },
  outputs: { normal: 'legacy.pdf', high: 'legacy-high.pdf' },
};\n`);
    const config = await loadConfig('readme-press.config.mjs', temporary);
    assert.deepEqual(config.outputs, { normal: 'legacy.pdf', high: 'legacy-high.pdf' });
    assert.deepEqual(config.security, {
      rawHtml: 'trusted',
      network: { mode: 'trusted', allowHosts: [] },
      diagnostics: 'warn',
    });
    assert.equal(config.validationDiagnostics[0].code, 'SECURITY_DEFAULTS_DEPRECATED');
    assert.equal(config.validationDiagnostics[0].promoteInStrict, false);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('rejects output aliases, pipeline-owned PDF names, and ASCII controls', async () => {
  const temporary = mkdtempSync(join(tmpdir(), 'readme-press-output-names-'));
  const writeConfig = (name, outputs) => writeFileSync(join(temporary, name), `export default {
  source: 'README.md',
  outputDir: 'dist',
  metadata: { title: 'Book', author: 'Author', edition: 'First' },
  repository: { url: 'https://github.com/example/book' },
  cover: { enabled: false },
  structure: {
    introHeading: 'Introduction',
    githubTocHeading: 'Contents',
    parts: [{ title: 'Part', startHeading: 'Chapter' }],
  },
  outputs: ${JSON.stringify(outputs)},
};\n`);
  try {
    writeFileSync(join(temporary, 'README.md'), '# Introduction\n\n# Contents\n\n# Chapter\n');
    mkdirSync(join(temporary, 'dist'));

    const rejected = [
      ['dot-alias.config.mjs', { normal: 'book.pdf', high: './book.pdf' }],
      ['linearized-alias.config.mjs', { normal: 'book.pdf', high: 'book.linearized.pdf' }],
      ...['body.pdf', 'body-high-quality.pdf', 'body-print.pdf', 'cover.pdf', 'cover-print.pdf']
        .map((output, index) => [`reserved-${index}.config.mjs`, { normal: output, high: 'book-high.pdf' }]),
      ['newline.config.mjs', { normal: 'book\nextra.pdf', high: 'book-high.pdf' }],
      ['tab.config.mjs', { normal: 'book\textra.pdf', high: 'book-high.pdf' }],
      ['nul.config.mjs', { normal: 'book\0extra.pdf', high: 'book-high.pdf' }],
    ];
    if (process.platform === 'darwin' || process.platform === 'win32') {
      rejected.push(['case-alias.config.mjs', { normal: 'Book.pdf', high: 'book.pdf' }]);
    }

    for (const [name, outputs] of rejected) {
      writeConfig(name, outputs);
      await assert.rejects(loadConfig(name, temporary), /output|pipeline|control|unique|reserved/iu, name);
    }

    writeFileSync(join(temporary, 'dist', 'book.pdf'), 'book');
    symlinkSync('book.pdf', join(temporary, 'dist', 'alias.pdf'));
    writeConfig('symlink-alias.config.mjs', { normal: 'book.pdf', high: 'alias.pdf' });
    await assert.rejects(
      loadConfig('symlink-alias.config.mjs', temporary),
      /output|unique|alias/iu,
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('requires projectRoot to resolve to an existing directory', async () => {
  const temporary = mkdtempSync(join(tmpdir(), 'readme-press-project-root-'));
  const writeConfig = (name, projectRoot) => writeFileSync(join(temporary, name), `export default {
  source: 'README.md',
  projectRoot: ${JSON.stringify(projectRoot)},
  metadata: { title: 'Book', author: 'Author', edition: 'First' },
  repository: { url: 'https://github.com/example/book' },
  cover: { enabled: false },
  structure: {
    introHeading: 'Introduction',
    githubTocHeading: 'Contents',
    parts: [{ title: 'Part', startHeading: 'Chapter' }],
  },
};\n`);
  try {
    writeFileSync(join(temporary, 'README.md'), '# Introduction\n\n# Contents\n\n# Chapter\n');
    writeConfig('missing.config.mjs', 'missing');
    await assert.rejects(loadConfig('missing.config.mjs', temporary), /projectRoot.*directory/u);
    writeFileSync(join(temporary, 'not-a-directory'), 'x');
    writeConfig('file.config.mjs', 'not-a-directory');
    await assert.rejects(loadConfig('file.config.mjs', temporary), /projectRoot.*directory/u);
    mkdirSync(join(temporary, 'content'));
    writeConfig('valid.config.mjs', 'content');
    const config = await loadConfig('valid.config.mjs', temporary);
    assert.equal(config.contentRoot, realpathSync(join(temporary, 'content')));
    assert.equal(config.projectRoot, temporary);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('cover capture waits for two byte-identical paints', async () => {
  const screenshots = [Buffer.from('first'), Buffer.from('stable'), Buffer.from('stable')];
  let paints = 0;
  const page = {
    async evaluate(callback) {
      paints += 1;
      void callback;
    },
    async screenshot() {
      return screenshots.shift();
    },
  };
  const result = await captureStableScreenshot(page, {}, 3);
  assert.equal(result.toString(), 'stable');
  assert.equal(paints, 3);

  let unstableCapture = 0;
  const unstable = {
    async evaluate() {},
    async screenshot() {
      unstableCapture += 1;
      return Buffer.from(String(unstableCapture));
    },
  };
  await assert.rejects(
    captureStableScreenshot(unstable, {}, 3),
    /did not stabilize after 3 attempts/u,
  );
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

test('callout class rules support contains, startsWith, combined OR, and non-matches', async () => {
  const result = await transformReadme(`# Introduction

> 💡 Contains the first needle.

> 💡 Starts here and continues.

> 💡 Combined text has a second needle.

> 💡 Ordinary callout.

# Contents

- [Chapter](#chapter)

# Chapter

Body.
`, {
    repository: { url: 'https://github.com/example/book', branch: 'main' },
    images: { classRules: [] },
    contentRules: {
      calloutClassRules: [
        { contains: 'first needle', className: 'matched-contains' },
        { startsWith: 'Starts here', className: 'matched-start' },
        { contains: 'second needle', startsWith: 'Never combined', className: 'matched-combined' },
        { contains: 'absent', startsWith: 'Never', className: 'must-not-match' },
      ],
      paragraphClassRules: [],
    },
    mermaid: {},
    structure: {
      introHeading: 'Introduction',
      githubTocHeading: 'Contents',
      parts: [{ title: 'Part one', startHeading: 'Chapter' }],
    },
    toc: { maxDepth: 2 },
  });
  const html = result.chapters.map((chapter) => chapter.html).join('\n');
  for (const className of ['matched-contains', 'matched-start', 'matched-combined']) {
    assert.equal((html.match(new RegExp(className, 'gu')) ?? []).length, 1, className);
  }
  assert.doesNotMatch(html, /must-not-match/u);
});

test('prepares checksums and neutral release notes from verified outputs', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'readme-press-release-'));
  try {
    const dist = join(temporary, 'dist');
    mkdirSync(dist);
    const outputs = {};
    for (const [quality, name] of [
      ['normal', 'book.pdf'],
      ['print', 'book-print.pdf'],
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
    assert.equal(result.print.pageCount, 8);
    assert.match(readFileSync(join(dist, 'SHA256SUMS.txt'), 'utf8'), /book-high\.pdf/);
    assert.match(readFileSync(join(dist, 'SHA256SUMS.txt'), 'utf8'), /book-print\.pdf/);
    assert.match(readFileSync(join(dist, 'release-notes.md'), 'utf8'), /Example book/);
    assert.match(readFileSync(join(dist, 'release-notes.md'), 'utf8'), /Print edition/);
    assert.match(readFileSync(join(dist, 'release-notes.md'), 'utf8'), /github\.com\/example\/book\/commit/);
    prepareRelease({
      version: 'v1.0.0',
      manifestPath,
      outputDir: dist,
      commit,
      release: {
        copy: {
          intro: '<script>bad()</script>\n## Injected',
          normalPurpose: 'Normal | forged cell',
          validation: ['[click](javascript:bad())'],
        },
      },
    });
    const safeNotes = readFileSync(join(dist, 'release-notes.md'), 'utf8');
    assert.doesNotMatch(safeNotes, /<script>|\n## Injected/u);
    assert.ok(safeNotes.includes('\\<script\\>bad()\\</script\\> \\#\\# Injected'));
    assert.ok(safeNotes.includes('Normal \\| forged cell'));
    assert.ok(safeNotes.includes('\\[click\\](javascript:bad())'));
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

test('release preparation rejects unsafe manifest PDF paths and accepts nested PDFs', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'readme-press-release-paths-'));
  try {
    const dist = join(temporary, 'dist');
    const releaseOutput = join(temporary, 'release');
    mkdirSync(dist);
    const commit = 'a'.repeat(40);
    const outside = join(temporary, 'outside.pdf');
    writeFileSync(outside, 'outside pdf');
    symlinkSync(outside, join(dist, 'linked.pdf'));
    mkdirSync(join(dist, 'nested'));
    writeFileSync(join(dist, 'nested/book.pdf'), 'nested pdf');
    writeFileSync(join(dist, 'book-high.pdf'), 'high pdf');
    writeFileSync(join(dist, 'line\nbreak.pdf'), 'control pdf');
    writeFileSync(join(dist, 'tab\tbreak.pdf'), 'tab control pdf');

    const outputRecord = (pdf, physicalPath) => {
      const bytes = readFileSync(physicalPath);
      return {
        pdf,
        pageCount: 8,
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
    };
    const high = outputRecord('book-high.pdf', join(dist, 'book-high.pdf'));
    const manifestPath = join(dist, 'manifest.json');
    const writeManifest = (normal) => writeFileSync(manifestPath, JSON.stringify({
      releaseVersion: 'v1.0.0',
      sourceCommit: commit,
      repository: { url: 'https://github.com/example/book' },
      outputs: { normal, high },
    }));

    const invalid = [
      ['../outside.pdf', outside],
      ['%2e%2e/outside.pdf', outside],
      [outside, outside],
      ['C:/outside.pdf', outside],
      ['linked.pdf', outside],
      ['line\nbreak.pdf', join(dist, 'line\nbreak.pdf')],
      ['tab\tbreak.pdf', join(dist, 'tab\tbreak.pdf')],
    ];
    for (const [pdf, physicalPath] of invalid) {
      writeManifest(outputRecord(pdf, physicalPath));
      assert.throws(
        () => prepareRelease({
          version: 'v1.0.0', manifestPath, outputDir: releaseOutput, commit,
        }),
        /Manifest normal PDF|ASCII control/u,
        pdf,
      );
    }

    writeManifest({ ...high, pdf: 'book\u0000.pdf' });
    assert.throws(
      () => prepareRelease({ version: 'v1.0.0', manifestPath, outputDir: releaseOutput, commit }),
      /ASCII control/u,
    );

    writeManifest(outputRecord('nested/book.pdf', join(dist, 'nested/book.pdf')));
    const result = prepareRelease({
      version: 'v1.0.0', manifestPath, outputDir: releaseOutput, commit,
    });
    assert.equal(result.normal.path, join(dist, 'nested/book.pdf'));
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
  const bookCss = readFileSync(join(root, 'themes/lapis-rtl/book.css'), 'utf8');
  const coverCss = readFileSync(join(root, 'themes/lapis-rtl/cover.css'), 'utf8');
  assert.match(bookCss, /data-readme-press-variant='print'/);
  assert.match(coverCss, /data-readme-press-variant='print'/);
});

test('release workflow verifies downloaded checksums before creating a release', () => {
  const workflow = readFileSync(join(root, '.github/workflows/release.yml'), 'utf8');
  const checksum = workflow.indexOf('sha256sum --check --strict SHA256SUMS.txt');
  const release = workflow.indexOf('gh release create');
  assert.ok(checksum > 0);
  assert.ok(release > checksum);
});
