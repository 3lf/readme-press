import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import puppeteer from 'puppeteer';
import { installRequestPolicy, normalizeNetworkPolicy } from '../src/network.mjs';

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
