import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import puppeteer from 'puppeteer';
import { renderCover } from '../src/cover.mjs';
import { installRequestPolicy, normalizeNetworkPolicy } from '../src/network.mjs';

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
  let delayedRequestScheduled = false;
  Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
    if (!delayedRequestScheduled && this.classList.contains('cover')) {
      delayedRequestScheduled = true;
      setTimeout(() => fetch('${base}/delayed').catch(() => {}), 25);
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
