import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import puppeteer from 'puppeteer';
import { loadConfig } from '../src/config.mjs';
import { renderCover } from '../src/cover.mjs';
import { installRequestPolicy, normalizeNetworkPolicy } from '../src/network.mjs';
import { renderPagedHtml } from '../src/render.mjs';

function coverConfig(network) {
  return {
    page: { widthCm: 17, heightCm: 24, coverDpi: 300 },
    metadata: {
      title: 'Network cover',
      author: 'README Press',
      creator: 'README Press',
      direction: 'ltr',
      language: 'en',
      localDate: '',
      latinDate: '',
    },
    cover: {
      series: '',
      titlePrefix: '',
      title: 'Network cover',
      tagline: '',
      repositoryNote: '',
    },
    repository: { url: 'https://github.com/3lf/readme-press', display: '3lf/readme-press' },
    labels: { latestLink: 'Latest release' },
    security: { network },
    outputVariant: 'normal',
  };
}

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function withWatchdog(promise, label, timeout = 10_000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeout} ms.`)), timeout);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const root = resolve(import.meta.dirname, '..');

test('deny mode stops a browser network canary before it reaches the server', async () => {
  let canaryRequests = 0;
  const canary = createServer((_request, response) => {
    canaryRequests += 1;
    response.writeHead(200, { 'Content-Type': 'image/png' }).end('not-an-image');
  });
  await new Promise((resolve, reject) => {
    canary.once('error', reject);
    canary.listen(0, '127.0.0.1', resolve);
  });
  const address = canary.address();
  assert.ok(address && typeof address !== 'string');

  const browser = await puppeteer.launch({
    headless: true,
    args: process.env.CI ? ['--no-sandbox'] : [],
  });
  try {
    const page = await browser.newPage();
    const requests = await installRequestPolicy(page, normalizeNetworkPolicy('deny'));
    await page.setContent(
      `<img src="http://127.0.0.1:${address.port}/network-canary.png">`,
      { waitUntil: 'networkidle0' },
    );
    assert.equal(canaryRequests, 0);
    assert.equal(requests.observedExternal.length, 1);
    assert.equal(requests.blocked.length, 1);
    await requests.disable();
  } finally {
    await browser.close();
    await new Promise((resolve, reject) => canary.close((error) => (error ? reject(error) : resolve())));
  }
});

test('cover network policy closes popup targets before their first request', {
  timeout: 60_000,
}, async () => {
  const paths = [];
  const canary = createServer((request, response) => {
    paths.push(request.url);
    response.writeHead(200, { 'Content-Type': 'text/html' }).end('<p>popup canary</p>');
  });
  await new Promise((resolve, reject) => {
    canary.once('error', reject);
    canary.listen(0, '127.0.0.1', resolve);
  });
  const address = canary.address();
  assert.ok(address && typeof address !== 'string');
  const popupUrl = `http://127.0.0.1:${address.port}/popup-canary`;
  const temporary = mkdtempSync(join(tmpdir(), 'readme-press-popup-policy-'));

  try {
    const htmlPath = join(temporary, 'cover.html');
    writeFileSync(htmlPath, `<!doctype html>
<style>html,body{margin:0}.cover{width:17cm;height:24cm}</style>
<div class="cover"><span class="repo-url">Repository</span></div>
<script>addEventListener('load', () => window.open('${popupUrl}', '_blank'));</script>`);

    for (const [name, policy] of [
      ['deny', normalizeNetworkPolicy('deny')],
      ['allowlist', normalizeNetworkPolicy({ mode: 'allowlist', allowHosts: ['example.com'] })],
    ]) {
      await assert.rejects(
        withWatchdog(
          renderCover(htmlPath, join(temporary, `${name}.pdf`), coverConfig(policy)),
          `${name} popup guard`,
        ),
        (error) => {
          assert.match(error.message, /Network policy blocked cover request/u);
          assert.match(error.message, /\/popup-canary/u);
          assert.notEqual(error.message, `${name} popup guard timed out after 10000 ms.`);
          return true;
        },
      );
      await new Promise((resolve) => setTimeout(resolve, 250));
      assert.deepEqual(paths, [], `${name} popup reached the canary server`);
    }
  } finally {
    canary.closeAllConnections?.();
    await closeServer(canary);
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('cover capture keeps explicit network policies active until the page closes', {
  timeout: 60_000,
}, async () => {
  const paths = [];
  const canary = createServer((request, response) => {
    paths.push(request.url);
    response.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'text/plain',
    }).end('ok');
  });
  await new Promise((resolve, reject) => {
    canary.once('error', reject);
    canary.listen(0, '127.0.0.1', resolve);
  });
  const address = canary.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const temporary = mkdtempSync(join(tmpdir(), 'readme-press-cover-policy-'));
  try {
    const htmlPath = join(temporary, 'cover.html');
    writeFileSync(htmlPath, `<!doctype html>
<style>html,body{margin:0}.cover{width:17cm;height:24cm}</style>
<div class="cover"><span class="repo-url">Repository</span></div>
<script>
  const readBounds = Element.prototype.getBoundingClientRect;
  let captureBoundaryRequestStarted = false;
  Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
    if (!captureBoundaryRequestStarted && this.classList.contains('cover')) {
      captureBoundaryRequestStarted = true;
      // Start egress only at the final post-stabilization layout boundary. A
      // synchronous request makes that boundary deterministic across Chromium speeds.
      const request = new XMLHttpRequest();
      request.open('GET', '${base}/delayed', false);
      try { request.send(); } catch {}
    }
    return readBounds.call(this);
  };
</script>`);

    for (const [name, policy] of [
      ['deny', normalizeNetworkPolicy('deny')],
      ['allowlist', normalizeNetworkPolicy({ mode: 'allowlist', allowHosts: ['example.com'] })],
    ]) {
      await assert.rejects(
        renderCover(htmlPath, join(temporary, `${name}.pdf`), coverConfig(policy)),
        (error) => {
          assert.match(error.message, /Network policy blocked cover request/u);
          assert.match(error.message, /\/delayed/u);
          return true;
        },
        `${name} did not record the delayed cover request`,
      );
      await new Promise((resolve) => setTimeout(resolve, 900));
      assert.deepEqual(paths, [], `${name} allowed a delayed cover request`);
    }

    const trusted = await renderCover(
      htmlPath,
      join(temporary, 'trusted.pdf'),
      coverConfig(normalizeNetworkPolicy('trusted')),
    );
    assert.ok(trusted.externalRequests.some((url) => url === `${base}/delayed`));
    assert.deepEqual(trusted.blockedRequests, []);
    assert.deepEqual(paths, ['/delayed']);
  } finally {
    await closeServer(canary);
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('cover teardown applies network policy to pagehide keepalive and unload beacon egress', {
  timeout: 120_000,
}, async () => {
  const paths = [];
  const canary = createServer((request, response) => {
    paths.push(request.url);
    request.resume();
    response.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST',
    }).end();
  });
  await new Promise((resolve, reject) => {
    canary.once('error', reject);
    canary.listen(0, '127.0.0.1', resolve);
  });
  const address = canary.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const expectedUrls = [`${base}/pagehide-keepalive`, `${base}/unload-beacon`];
  const temporary = mkdtempSync(join(tmpdir(), 'readme-press-cover-close-policy-'));

  try {
    const htmlPath = join(temporary, 'cover.html');
    writeFileSync(htmlPath, `<!doctype html>
<style>html,body{margin:0}.cover{width:17cm;height:24cm}</style>
<div class="cover"><span class="repo-url">Repository</span></div>
<script>
  addEventListener('pagehide', () => {
    fetch('${base}/pagehide-keepalive', {
      method: 'POST',
      body: 'pagehide',
      keepalive: true,
    }).catch(() => {});
  });
  addEventListener('unload', () => {
    navigator.sendBeacon('${base}/unload-beacon', 'unload');
  });
</script>`);

    for (let run = 0; run < 2; run += 1) {
      for (const [name, policy] of [
        ['deny', normalizeNetworkPolicy('deny')],
        ['allowlist', normalizeNetworkPolicy({ mode: 'allowlist', allowHosts: ['example.com'] })],
      ]) {
        await assert.rejects(
          renderCover(htmlPath, join(temporary, `${name}-${run}.pdf`), coverConfig(policy)),
          (error) => {
            assert.match(error.message, /Network policy blocked cover request/u);
            for (const url of expectedUrls) assert.match(error.message, new RegExp(url.replaceAll('/', '\\/'), 'u'));
            assert.deepEqual(error.blockedRequests, expectedUrls);
            assert.deepEqual(error.policyErrors, []);
            assert.equal(error.cleanupErrors, undefined);
            return true;
          },
          `${name} run ${run} did not reject close-time egress`,
        );
        await new Promise((resolve) => setTimeout(resolve, 250));
        assert.deepEqual(paths, [], `${name} run ${run} released close-time egress`);
      }

      const trusted = await renderCover(
        htmlPath,
        join(temporary, `trusted-${run}.pdf`),
        coverConfig(normalizeNetworkPolicy('trusted')),
      );
      assert.deepEqual(trusted.externalRequests, expectedUrls);
      assert.deepEqual(trusted.blockedRequests, []);
      assert.deepEqual(paths.splice(0).sort(), ['/pagehide-keepalive', '/unload-beacon']);
    }
  } finally {
    canary.closeAllConnections?.();
    await closeServer(canary);
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('body teardown applies network policy to pagehide keepalive and unload beacon egress', {
  timeout: 120_000,
}, async () => {
  const paths = [];
  const canary = createServer((request, response) => {
    paths.push(request.url);
    request.resume();
    response.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST',
    }).end();
  });
  await new Promise((resolve, reject) => {
    canary.once('error', reject);
    canary.listen(0, '127.0.0.1', resolve);
  });
  const address = canary.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const expectedUrls = [`${base}/body-pagehide`, `${base}/body-unload`];
  const temporary = mkdtempSync(join(tmpdir(), 'readme-press-body-close-policy-'));

  try {
    const htmlPath = join(temporary, 'body.html');
    writeFileSync(htmlPath, `<!doctype html>
<style>@page{size:A5;margin:12mm}</style>
<main><h1>Body policy</h1><p>Teardown canary.</p></main>
<script>
  top.addEventListener('pagehide', () => {
    top.fetch('${base}/body-pagehide', {
      method: 'POST',
      body: 'pagehide',
      keepalive: true,
    }).catch(() => {});
    top.navigator.sendBeacon('${base}/body-unload', 'unload');
  });
</script>`);

    await assert.rejects(
      renderPagedHtml({
        htmlPath,
        pdfPath: join(temporary, 'deny.pdf'),
        network: normalizeNetworkPolicy('deny'),
        timeout: 60_000,
      }),
      (error) => {
        assert.match(error.message, /Network policy blocked request/u);
        assert.deepEqual(error.blockedRequests, expectedUrls);
        assert.deepEqual(error.policyErrors, []);
        return true;
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.deepEqual(paths, []);

    const trusted = await renderPagedHtml({
      htmlPath,
      pdfPath: join(temporary, 'trusted.pdf'),
      network: normalizeNetworkPolicy('trusted'),
      timeout: 60_000,
    });
    assert.deepEqual(trusted.externalRequests, expectedUrls);
    assert.deepEqual(paths.sort(), ['/body-pagehide', '/body-unload']);
  } finally {
    canary.closeAllConnections?.();
    await closeServer(canary);
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('an always-changing cover produces a PDF with a non-blocking fallback warning', async () => {
  const temporary = mkdtempSync(join(tmpdir(), 'readme-press-animated-cover-'));
  const htmlPath = join(temporary, 'cover.html');
  const pdfPath = join(temporary, 'cover.pdf');
  try {
    writeFileSync(htmlPath, `<!doctype html>
<style>
  html, body { margin: 0; }
  @keyframes pulse { from { opacity: 0.5; } to { opacity: 1; } }
  .cover { width: 96px; height: 96px; overflow: hidden; animation: pulse 10ms infinite; }
</style>
<div class="cover"><span class="repo-url"></span><span id="tick"></span></div>
<script>
  let tick = 0;
  setInterval(() => {
    tick += 1;
    document.querySelector('#tick').textContent = String(tick);
    document.querySelector('.cover').style.background =
      'rgb(' + (tick % 256) + ', ' + (Math.floor(tick / 2) % 256) + ', 255)';
  }, 1);
</script>`);
    const result = await renderCover(htmlPath, pdfPath, {
      page: { widthCm: 2.54, heightCm: 2.54, coverDpi: 96 },
      metadata: {
        title: 'Animated cover',
        author: 'README Press',
        creator: 'README Press',
        direction: 'ltr',
        language: 'en',
        localDate: '',
        latinDate: '',
      },
      cover: {
        series: '',
        titlePrefix: '',
        title: 'Animated cover',
        tagline: '',
        repositoryNote: '',
      },
      repository: { url: 'https://github.com/3lf/readme-press', display: '3lf/readme-press' },
      labels: { latestLink: 'Latest release' },
      security: { network: normalizeNetworkPolicy('trusted') },
      outputVariant: 'normal',
    });
    assert.equal(existsSync(pdfPath), true);
    assert.deepEqual(result.diagnostics, [{
      code: 'ANIMATED_COVER_FALLBACK',
      severity: 'warning',
      promoteInStrict: false,
      detail: 'normal cover used the final complete frame after 5 attempts.',
    }]);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('deny mode renders a stable local cover without waiting for network idle', {
  timeout: 20_000,
}, async () => {
  const temporary = mkdtempSync(join(tmpdir(), 'readme-press-deny-cover-'));
  try {
    const config = await loadConfig('test/fixtures/basic/readme-press.config.mjs', root);
    const output = join(temporary, 'cover-print.pdf');
    await renderCover(config.cover.file, output, {
      ...config,
      outputVariant: 'print',
      security: {
        ...config.security,
        network: normalizeNetworkPolicy('deny'),
      },
    });
    assert.ok(existsSync(output));
    assert.ok(existsSync(join(temporary, 'cover-print.png')));
    assert.ok(statSync(output).size > 0);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
