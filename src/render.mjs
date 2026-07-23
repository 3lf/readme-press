import { createServer } from 'node:http';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const VIEWER_ROOT = resolve(
  dirname(fileURLToPath(import.meta.resolve('@vivliostyle/viewer/package.json'))),
  'lib',
);

const MIME_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.ttf', 'font/ttf'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

function within(root, path) {
  return path === root || path.startsWith(`${root}${sep}`);
}

function createStaticServer(routes) {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const route = routes.find(({ prefix }) => url.pathname.startsWith(prefix));
      if (!route) {
        response.writeHead(404).end();
        return;
      }

      const relative = decodeURIComponent(url.pathname.slice(route.prefix.length)) || 'index.html';
      const path = resolve(route.root, relative);
      if (!within(route.root, path)) {
        response.writeHead(403).end();
        return;
      }

      const info = await stat(path);
      if (!info.isFile()) {
        response.writeHead(404).end();
        return;
      }

      response.setHeader('Content-Type', MIME_TYPES.get(extname(path).toLowerCase())
        ?? 'application/octet-stream');
      response.setHeader('Cache-Control', 'no-store');
      response.end(await readFile(path));
    } catch {
      response.writeHead(404).end();
    }
  });
}

async function listen(server) {
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Unable to start the local renderer.');
  return address.port;
}

async function closeServer(server) {
  await new Promise((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
  });
}

async function pageSizeData(page) {
  return page.evaluate(() => {
    const sizes = [];
    const containers = document.querySelectorAll(
      '#vivliostyle-viewer-viewport > div > div > div[data-vivliostyle-page-container]',
    );
    for (const container of containers) {
      const bleedBox = container.querySelector('div[data-vivliostyle-bleed-box]');
      sizes.push({
        mediaWidth: Number.parseFloat(container.style.width) * 0.75,
        mediaHeight: Number.parseFloat(container.style.height) * 0.75,
        bleedOffset: Number.parseFloat(bleedBox?.style.left ?? '') * 0.75,
        bleedSize: Number.parseFloat(bleedBox?.style.paddingLeft ?? '') * 0.75,
      });
    }
    return sizes;
  });
}

export async function renderPagedHtml({
  htmlPath,
  pdfPath,
  timeout = 300_000,
}) {
  const documentRoot = dirname(htmlPath);
  const server = createStaticServer([
    { prefix: '/viewer/', root: VIEWER_ROOT },
    { prefix: '/document/', root: documentRoot },
  ]);
  const port = await listen(server);
  let browser;

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: process.env.CI ? ['--no-sandbox'] : [],
    });
    const page = await browser.newPage();
    page.setDefaultTimeout(timeout);
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('response', (response) => {
      if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) {
        pageErrors.push(`${response.status()} ${response.url()}`);
      }
    });

    const base = `http://127.0.0.1:${port}`;
    const sourceUrl = `${base}/document/${encodeURIComponent(basename(htmlPath))}`;
    const viewerUrl = `${base}/viewer/index.html#src=${sourceUrl}&bookMode=true&renderAllPages=true`;
    const response = await page.goto(viewerUrl, { waitUntil: 'domcontentloaded', timeout });
    if (!response?.ok()) {
      throw new Error(`Unable to load the Vivliostyle viewer: HTTP ${response?.status() ?? 'unknown'}.`);
    }
    await page.waitForNetworkIdle({ timeout });
    await page.emulateMediaType('print');
    await page.waitForFunction(
      () => globalThis.coreViewer?.readyState === 'complete',
      { polling: 500, timeout },
    );

    const sizes = await pageSizeData(page);
    if (!sizes.length) throw new Error('Vivliostyle completed without producing any pages.');
    if (pageErrors.length) {
      throw new Error(`Vivliostyle browser error: ${pageErrors.join('\n')}`);
    }

    const pdf = await page.pdf({
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      preferCSSPageSize: true,
      printBackground: true,
      tagged: true,
    });
    await writeFile(pdfPath, pdf);
    return { pageSizeData: sizes };
  } finally {
    await browser?.close();
    await closeServer(server);
  }
}
