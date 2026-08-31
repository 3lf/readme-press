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
import { loadConfig } from '../src/config.mjs';
import { sanitizeInlineMarkup, sanitizeRawHtml } from '../src/html.mjs';
import { installRequestPolicy, normalizeNetworkPolicy } from '../src/network.mjs';
import {
  assertContainedOutputSink,
  resolveContainedOutput,
  resolveContainedSource,
} from '../src/paths.mjs';
import { createStaticServer, runRendererLifecycle } from '../src/render.mjs';
import { buildDocument } from '../src/template.mjs';
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

test('safe raw HTML removes executable markup, handlers, styles, and dangerous URLs', () => {
  const sanitized = sanitizeRawHtml(`<div class="note" onclick="evil()" style="color:red">
<script>alert(1)</script>
<iframe src="https://evil.example"></iframe>
<a href="javascript:alert(1)">safe label</a>
<img src="figure.png" onerror="evil()" style="display:none">
</div>`);
  assert.match(sanitized, /class="note"/u);
  assert.match(sanitized, />safe label<\/a>/u);
  assert.match(sanitized, /src="figure\.png"/u);
  assert.doesNotMatch(sanitized, /script|iframe|onclick|onerror|style=|javascript:/iu);
});

test('safe raw HTML preserves benign GitHub layout boundaries used by the real book', () => {
  const boundaries = [
    '<div dir="rtl">',
    '<div align="center">',
    '</div>',
    '<br>\n<div align="center">',
  ];
  for (const boundary of boundaries) {
    assert.equal(sanitizeRawHtml(boundary), boundary);
  }

  const downloads = `<table width="100%">
<tr>
<td align="center" width="33%">
<a href="https://github.com/3lf/llm-for-humans/releases/latest/download/book.pdf"><img src="images/download.svg" alt="Download" width="300"></a>
<br>
<sub>Same complete book;<br>optimized for everyday reading.</sub>
</td>
</tr>
</table>
</div>`;
  assert.equal(sanitizeRawHtml(downloads), downloads);

  const hostile = sanitizeRawHtml(
    '<div align="center" onclick="evil()"><a href="javascript:evil()">Visible</a></div>',
  );
  assert.match(hostile, />Visible<\/a><\/div>$/u);
  assert.doesNotMatch(hostile, /onclick|javascript:/iu);
});

test('cover repository notes allow only limited inline markup', () => {
  const sanitized = sanitizeInlineMarkup(
    'Get it from <strong>GitHub</strong><br><em>today</em><script>bad()</script><a href="https://evil.example">link</a>',
  );
  assert.equal(sanitized, 'Get it from <strong>GitHub</strong><br><em>today</em>link');
});

test('safe and deny raw HTML modes are enforced during transformation', async () => {
  const project = mkdtempSync(join(tmpdir(), 'readme-press-raw-html-'));
  try {
    const safeConfig = {
      ...transformConfig(project),
      security: {
        rawHtml: 'safe',
        network: normalizeNetworkPolicy('deny'),
      },
    };
    const safe = await transformReadme(markdownWith(
      '<span onclick="evil()" style="color:red">Visible</span><script>bad()</script>',
    ), safeConfig, { sourceDir: project });
    const html = safe.chapters.map((chapter) => chapter.html).join('\n');
    assert.match(html, /Visible/u);
    assert.doesNotMatch(html, /onclick|style=|script|bad\(\)/iu);
    assert.ok(safe.diagnostics.some((diagnostic) => diagnostic.code === 'RAW_HTML_SANITIZED'));

    await assert.rejects(
      transformReadme(markdownWith('<br>'), {
        ...safeConfig,
        security: { ...safeConfig.security, rawHtml: 'deny' },
      }, { sourceDir: project }),
      /Raw HTML is disabled/u,
    );
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('network policy rejects remote images unless their host is allowlisted', async () => {
  const project = mkdtempSync(join(tmpdir(), 'readme-press-network-transform-'));
  try {
    const base = transformConfig(project);
    await assert.rejects(
      transformReadme(markdownWith('![Remote](https://assets.example/figure.png)'), {
        ...base,
        security: { rawHtml: 'safe', network: normalizeNetworkPolicy('deny') },
      }, { sourceDir: project }),
      /blocked by security\.network=deny/u,
    );
    await assert.rejects(
      transformReadme(markdownWith('![Local file](file:///etc/passwd)'), {
        ...base,
        security: { rawHtml: 'trusted', network: normalizeNetworkPolicy('trusted') },
      }, { sourceDir: project }),
      /unsafe URL protocol/u,
    );
    const allowed = await transformReadme(
      markdownWith('![Remote](https://assets.example/figure.png)'),
      {
        ...base,
        security: {
          rawHtml: 'safe',
          network: normalizeNetworkPolicy({ mode: 'allowlist', allowHosts: ['assets.example'] }),
        },
      },
      { sourceDir: project },
    );
    assert.match(allowed.chapters.at(-1).html, /https:\/\/assets\.example\/figure\.png/u);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('unwraps unsafe Markdown links and reports stable scheme diagnostics', async () => {
  const project = mkdtempSync(join(tmpdir(), 'readme-press-link-schemes-'));
  try {
    const result = await transformReadme(markdownWith(`
[JavaScript](javascript:alert(1))
[mixed case](JaVaScRiPt:alert(1))
[encoded colon](javascript&#58;alert(1))
[encoded tab](java&#9;script:alert(1))
[data](data:text/html;base64,QQ==)
[file](file:///etc/passwd)
[unknown](ftp://host/x)
[HTTPS](https://example.com/x)
[HTTP](http://example.com/x)
[email](mailto:a@b.c)
[fragment](#chapter)
[relative](./relative)
[protocol relative](//example.com/x)
`), transformConfig(project), { sourceDir: project });
    const html = result.chapters.find((chapter) => chapter.title === 'Chapter').html;

    for (const unsafe of ['javascript:', 'data:', 'file:', 'ftp:']) {
      assert.doesNotMatch(html, new RegExp(`href="${unsafe}`, 'iu'));
    }
    for (const visible of [
      'JavaScript', 'mixed case', 'encoded colon', 'encoded tab', 'data', 'file', 'unknown',
    ]) {
      assert.match(html, new RegExp(visible, 'u'));
    }
    for (const allowed of [
      'https://example.com/x',
      'http://example.com/x',
      'mailto:a@b.c',
      '#chapter',
      './relative',
      '//example.com/x',
    ]) {
      assert.match(html, new RegExp(`href="${allowed.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}"`, 'u'));
    }
    assert.deepEqual(
      result.diagnostics.filter((item) => item.code === 'UNSAFE_LINK_SCHEME'),
      [
        { code: 'UNSAFE_LINK_SCHEME', detail: 'javascript' },
        { code: 'UNSAFE_LINK_SCHEME', detail: 'javascript' },
        { code: 'UNSAFE_LINK_SCHEME', detail: 'javascript' },
        { code: 'UNSAFE_LINK_SCHEME', detail: 'javascript' },
        { code: 'UNSAFE_LINK_SCHEME', detail: 'data' },
        { code: 'UNSAFE_LINK_SCHEME', detail: 'file' },
        { code: 'UNSAFE_LINK_SCHEME', detail: 'ftp' },
      ],
    );
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('unwraps unsafe full, collapsed, and shortcut reference links once per definition', async () => {
  const project = mkdtempSync(join(tmpdir(), 'readme-press-reference-links-'));
  try {
    const result = await transformReadme(markdownWith(`
[Full][unsafe]
[Second use][unsafe]
[Collapsed][]
[Shortcut]
[Safe][safe]

The literal javascript:alert(1) remains prose and \`javascript:alert(1)\` remains code.

[unsafe]: javascript:alert(1)
[collapsed]: data:text/html,unsafe
[shortcut]: file:///etc/passwd
[safe]: https://example.com/safe
`), transformConfig(project), { sourceDir: project });
    const html = result.chapters.find((chapter) => chapter.title === 'Chapter').html;
    assert.doesNotMatch(html, /href="(?:javascript|data|file):/iu);
    for (const label of ['Full', 'Second use', 'Collapsed', 'Shortcut']) assert.match(html, new RegExp(label, 'u'));
    assert.match(html, /href="https:\/\/example\.com\/safe"/u);
    assert.match(html.replace(/<[^>]*>/gu, ''), /literal javascript:alert\(1\) remains prose/u);
    assert.match(html, /<code[^>]*>javascript:alert\(1\)<\/code>/u);
    assert.deepEqual(
      result.diagnostics.filter(({ code }) => code === 'UNSAFE_LINK_SCHEME'),
      [
        { code: 'UNSAFE_LINK_SCHEME', detail: 'javascript' },
        { code: 'UNSAFE_LINK_SCHEME', detail: 'data' },
        { code: 'UNSAFE_LINK_SCHEME', detail: 'file' },
      ],
    );
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('request interception fails closed and drains every settlement', async () => {
  let handler;
  const ownerSession = {
    detached: false,
    on() {},
    off() {},
    async send(method) {
      if (method === 'Target.getTargetInfo') return { targetInfo: { targetId: 'owner' } };
      return {};
    },
    async detach() { this.detached = true; },
  };
  const browserSession = {
    detached: false,
    on() {},
    off() {},
    connection() { return { session: () => null, async send() {} }; },
    async send() {},
    async detach() { this.detached = true; },
  };
  const page = {
    on(event, callback) { if (event === 'request') handler = callback; },
    off() {},
    async createCDPSession() { return ownerSession; },
    browser() {
      return { target: () => ({ createCDPSession: async () => browserSession }) };
    },
    async setRequestInterception() {},
  };
  const policy = normalizeNetworkPolicy({ mode: 'allowlist', allowHosts: ['example.com'] });
  const requests = await installRequestPolicy(page, policy);
  let malformedAborts = 0;
  let malformedContinues = 0;
  handler({
    url: () => 'https://bad_host.example/file',
    abort: async () => { malformedAborts += 1; },
    continue: async () => { malformedContinues += 1; },
  });
  let rejectedContinues = 0;
  handler({
    url: () => 'https://example.com/file',
    abort: async () => assert.fail('allowed request must not abort'),
    continue: async () => {
      rejectedContinues += 1;
      throw new Error('continue failed');
    },
  });
  await requests.disable();
  assert.equal(malformedAborts, 1);
  assert.equal(malformedContinues, 0);
  assert.equal(rejectedContinues, 1);
  assert.equal(requests.errors.length, 2);
  assert.match(requests.errors[0].message, /invalid allowlist host/u);
  assert.match(requests.errors[1].message, /continue failed/u);
});

test('boundary markup fast path preserves safe Markdown HTML boundaries', () => {
  assert.equal(sanitizeRawHtml('<div class="note"><br></div>'), '<div class="note"><br></div>');
  assert.equal(sanitizeRawHtml('<div><div></div></div>'), '<div><div></div></div>');
  assert.equal(sanitizeRawHtml('<div><br>'), '<div><br>');
  assert.equal(sanitizeRawHtml('</div>'), '</div>');
  assert.doesNotMatch(sanitizeRawHtml('<div><span onclick="bad()">x'), /onclick/u);
});

test('validates exact allowlist hosts before constructing CSP sources', async () => {
  for (const host of [
    '"*"',
    'evil.com/path',
    '*.com',
    '[::1]:999',
    'example.com:443',
    'user@example.com',
    'example.com; script-src *',
  ]) {
    assert.throws(
      () => normalizeNetworkPolicy({ mode: 'allowlist', allowHosts: [host] }),
      /invalid allowlist host/u,
    );
  }

  const policy = normalizeNetworkPolicy({
    mode: 'allowlist',
    allowHosts: [' Example.COM ', '127.0.0.1', '[::1]'],
  });
  assert.deepEqual(policy.allowHosts, ['example.com', '127.0.0.1', '[::1]']);

  const config = await loadConfig('test/fixtures/basic/readme-press.config.mjs', process.cwd());
  config.security = { rawHtml: 'safe', network: policy };
  const html = buildDocument({ parts: [], chapters: [] }, config);
  assert.match(html, /https:\/\/example\.com/u);
  assert.match(html, /https:\/\/127\.0\.0\.1/u);
  assert.match(html, /https:\/\/\[::1\]/u);
});

test('rejects non-HTTP repository URLs at config load', async () => {
  const project = mkdtempSync(join(tmpdir(), 'readme-press-repository-url-'));
  try {
    writeFileSync(join(project, 'readme-press.config.mjs'), `export default {
  metadata: { title: 'Book', author: 'Author', edition: 'First' },
  repository: { url: 'file:///tmp/book' },
  structure: {
    introHeading: 'Introduction',
    githubTocHeading: 'Contents',
    parts: [{ title: 'Part', startHeading: 'Chapter' }],
  },
};\n`);
    await assert.rejects(
      loadConfig('readme-press.config.mjs', project),
      /repository\.url must use HTTP or HTTPS/u,
    );
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('document templates context-encode config values and emit CSP in safe mode', async () => {
  const config = await loadConfig('test/fixtures/basic/readme-press.config.mjs', process.cwd());
  config.metadata = {
    ...config.metadata,
    title: '</title><script>bad()</script>',
    author: 'Author" onload="bad()',
  };
  config.security = {
    rawHtml: 'safe',
    network: normalizeNetworkPolicy('deny'),
  };
  const html = buildDocument({
    parts: [],
    chapters: [{
      isIntroduction: true,
      title: 'Introduction',
      slug: 'intro',
      html: '<p>Body</p>',
      htmlByQuality: { normal: '<p>Body</p>' },
      tocHeadings: [],
    }],
  }, config);
  assert.match(html, /Content-Security-Policy/u);
  assert.match(html, /&lt;\/title&gt;&lt;script&gt;bad\(\)&lt;\/script&gt;/u);
  assert.match(html, /Author&quot; onload=&quot;bad\(\)/u);
  assert.doesNotMatch(html, /<script>bad\(\)<\/script>/u);
});

test('document templates emit restrictive CSP in deny mode', async () => {
  const config = await loadConfig('test/fixtures/basic/readme-press.config.mjs', process.cwd());
  config.security = { rawHtml: 'deny', network: normalizeNetworkPolicy('deny') };
  const html = buildDocument({ parts: [], chapters: [] }, config);
  assert.match(html, /Content-Security-Policy/u);
  assert.match(html, /default-src &#39;none&#39;/u);
  assert.match(html, /script-src &#39;none&#39;/u);
});
