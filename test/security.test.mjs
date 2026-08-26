import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  assertContainedOutputSink,
  resolveContainedOutput,
  resolveContainedSource,
} from '../src/paths.mjs';
import { createStaticServer, runRendererLifecycle } from '../src/render.mjs';
import { transformReadme } from '../src/transform.mjs';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

function transformConfig(projectRoot) {
  return {
    projectRoot,
    repository: { url: 'https://github.com/example/book', branch: 'main' },
    images: { tallRatio: 1.4, classRules: [] },
    contentRules: {
      calloutClassRules: [],
      paragraphClassRules: [],
      treeAriaLabel: 'Document hierarchy',
    },
    mermaid: {},
    structure: {
      introHeading: 'Introduction',
      githubTocHeading: 'Contents',
      parts: [{ title: 'Part one', startHeading: 'Chapter' }],
    },
    toc: { maxDepth: 2 },
  };
}

function markdownWith(body) {
  return `# Introduction

Welcome.

# Contents

- [Chapter](#chapter)

# Chapter

${body}
`;
}

test('rejects traversal, encoded traversal, absolute, and Windows-style source paths', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'readme-press-source-boundary-'));
  try {
    const project = join(temporary, 'project');
    mkdirSync(project);
    for (const reference of [
      '../outside.png',
      '%2e%2e/outside.png',
      '/tmp/outside.png',
    ]) {
      assert.throws(() => resolveContainedSource({
        baseDirectory: project,
        projectRoot: project,
        reference,
        label: 'Image path',
      }));
    }
    for (const reference of [
      'C:%5Coutside.png',
      'C:/outside.png',
    ]) {
      assert.throws(() => resolveContainedSource({
        baseDirectory: project,
        projectRoot: project,
        reference,
        label: 'Image path',
      }), /Image path must be relative/u);
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('rejects source paths that escape through a symbolic link', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'readme-press-source-symlink-'));
  try {
    const project = join(temporary, 'project');
    const outside = join(temporary, 'outside');
    mkdirSync(project);
    mkdirSync(outside);
    writeFileSync(join(outside, 'figure.png'), PNG);
    symlinkSync(outside, join(project, 'linked'));
    assert.throws(() => resolveContainedSource({
      baseDirectory: project,
      projectRoot: project,
      reference: 'linked/figure.png',
      label: 'Image path',
    }), /symbolic|escapes/u);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('accepts nested PDF outputs and rejects output escapes', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'readme-press-output-boundary-'));
  try {
    const output = join(temporary, 'dist');
    mkdirSync(output);
    assert.equal(
      resolveContainedOutput(output, 'editions/book.pdf', { extension: '.pdf' }),
      join(output, 'editions/book.pdf'),
    );
    for (const path of ['../book.pdf', '%2e%2e/book.pdf', '/tmp/book.pdf', 'book.html']) {
      assert.throws(() => resolveContainedOutput(output, path, { extension: '.pdf' }));
    }
    const outside = join(temporary, 'outside');
    mkdirSync(outside);
    symlinkSync(outside, join(output, 'linked'));
    assert.throws(
      () => resolveContainedOutput(output, 'linked/book.pdf', { extension: '.pdf' }),
      /symbolic/u,
    );
    symlinkSync(join(outside, 'missing'), join(output, 'dangling'));
    assert.throws(
      () => resolveContainedOutput(output, 'dangling/book.pdf', { extension: '.pdf' }),
      /dangling symbolic link/u,
    );

    const nested = resolveContainedOutput(output, 'editions/race.pdf', { extension: '.pdf' });
    mkdirSync(join(output, 'editions'));
    unlinkSync(join(output, 'linked'));
    rmSync(join(output, 'editions'), { recursive: true });
    symlinkSync(outside, join(output, 'editions'));
    assert.throws(
      () => assertContainedOutputSink(output, nested, { label: 'outputs.normal' }),
      /symbolic link/u,
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('renderer lifecycle closes every acquired resource and preserves the primary error', async () => {
  const events = [];
  const server = {
    closeAllConnections: () => events.push('server-connections'),
    close: (callback) => {
      events.push('server-close');
      callback(new Error('server close failed'));
    },
  };
  const browser = {
    close: async () => {
      events.push('browser-close');
      throw new Error('browser close failed');
    },
  };

  await assert.rejects(
    runRendererLifecycle({
      createServer: async () => server,
      listen: async () => 1234,
      launch: async () => browser,
      render: async () => {
        throw new Error('primary render failed');
      },
    }),
    (error) => {
      assert.match(error.message, /primary render failed/u);
      assert.equal(error.cause?.message, 'browser close failed');
      assert.deepEqual(error.cleanupErrors, ['browser close failed', 'server close failed']);
      return true;
    },
  );
  assert.deepEqual(events, ['browser-close', 'server-connections', 'server-close']);
});

test('renderer lifecycle closes a listening server when browser launch fails', async () => {
  let closes = 0;
  await assert.rejects(runRendererLifecycle({
    createServer: async () => ({
      closeAllConnections() {},
      close(callback) {
        closes += 1;
        callback();
      },
    }),
    listen: async () => 1234,
    launch: async () => { throw new Error('launch failed'); },
    render: async () => assert.fail('render should not run'),
  }), /launch failed/u);
  assert.equal(closes, 1);
});

test('deduplicates repeated missing figure diagnostics by source reference', async () => {
  const project = mkdtempSync(join(tmpdir(), 'readme-press-missing-figures-'));
  try {
    const result = await transformReadme(markdownWith(`![First](missing.png)

![Again](missing.png)

![Other](other.png)`), transformConfig(project), { sourceDir: project });
    assert.deepEqual(
      result.diagnostics.filter(({ code }) => code === 'MISSING_FIGURE_FILE'),
      [
        { code: 'MISSING_FIGURE_FILE', detail: 'missing.png' },
        { code: 'MISSING_FIGURE_FILE', detail: 'other.png' },
      ],
    );
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('uses content-addressed assets and changes only image nodes between editions', async () => {
  const project = mkdtempSync(join(tmpdir(), 'readme-press-image-variants-'));
  try {
    mkdirSync(join(project, 'images'));
    writeFileSync(join(project, 'images/figure.png'), PNG);
    const digest = createHash('sha256').update(PNG).digest('hex').slice(0, 24);
    const normalUrl = `assets/figures/${digest}.jpg`;
    const losslessUrl = `assets/figures/${digest}.png`;
    const result = await transformReadme(markdownWith(`The literal path is ${normalUrl}.

\`${normalUrl}\`

![A figure](images/figure.png)

<img src="images/figure.png" alt="Raw figure">`), transformConfig(project), {
      sourceDir: project,
    });
    const chapter = result.chapters.find((item) => item.title === 'Chapter');
    assert.equal(result.images.size, 1);
    assert.match(chapter.htmlByQuality.normal, new RegExp(`src="${normalUrl}"`, 'u'));
    assert.match(chapter.htmlByQuality.high, new RegExp(`src="${losslessUrl}"`, 'u'));
    assert.equal((chapter.htmlByQuality.high.match(new RegExp(normalUrl, 'gu')) ?? []).length, 2);
    assert.doesNotMatch(chapter.htmlByQuality.high, /data-readme-press/u);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('rejects local image traversal during Markdown transformation', async () => {
  const temporary = mkdtempSync(join(tmpdir(), 'readme-press-transform-boundary-'));
  try {
    const project = join(temporary, 'project');
    mkdirSync(project);
    writeFileSync(join(temporary, 'outside.png'), PNG);
    await assert.rejects(
      transformReadme(markdownWith('![Escape](../outside.png)'), transformConfig(project), {
        sourceDir: project,
      }),
      /escapes the project root/u,
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('the rendering server refuses files reached through a symbolic link', async () => {
  const temporary = mkdtempSync(join(tmpdir(), 'readme-press-server-boundary-'));
  const root = join(temporary, 'root');
  const outside = join(temporary, 'outside');
  mkdirSync(root);
  mkdirSync(outside);
  writeFileSync(join(outside, 'secret.txt'), 'secret');
  symlinkSync(outside, join(root, 'linked'));
  const server = createStaticServer([{
    prefix: '/document/',
    root,
    canonicalRoot: realpathSync(root),
  }]);
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const response = await fetch(`http://127.0.0.1:${address.port}/document/linked/secret.txt`);
    assert.equal(response.status, 403);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    rmSync(temporary, { recursive: true, force: true });
  }
});
