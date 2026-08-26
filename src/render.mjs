import { createServer } from 'node:http';
import { readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { createSecurityDefaults } from './defaults.mjs';
import { withRequestPolicy } from './network.mjs';

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

export function createStaticServer(routes) {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const route = routes.find(({ prefix }) => url.pathname.startsWith(prefix));
      if (!route) {
        response.writeHead(404).end();
        return;
      }

      const relative = decodeURIComponent(url.pathname.slice(route.prefix.length)) || 'index.html';
      if (relative.includes('\\')) {
        response.writeHead(403).end();
        return;
      }
      const path = resolve(route.root, relative);
      if (!within(route.root, path)) {
        response.writeHead(403).end();
        return;
      }
      const canonicalPath = await realpath(path);
      if (!within(route.canonicalRoot, canonicalPath)) {
        response.writeHead(403).end();
        return;
      }

      const info = await stat(canonicalPath);
      if (!info.isFile()) {
        response.writeHead(404).end();
        return;
      }

      response.setHeader('Content-Type', MIME_TYPES.get(extname(canonicalPath).toLowerCase())
        ?? 'application/octet-stream');
      response.setHeader('Cache-Control', 'no-store');
      response.end(await readFile(canonicalPath));
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
  server.closeIdleConnections?.();
  server.closeAllConnections?.();
  await new Promise((resolveClose, reject) => {
    server.close((error) => {
      if (error?.code === 'ERR_SERVER_NOT_RUNNING') resolveClose();
      else if (error) reject(error);
      else resolveClose();
    });
  });
}

export async function runRendererLifecycle({
  createServer: createServerResource,
  listen: listenResource,
  launch,
  render,
}) {
  let server;
  let browser;
  let result;
  let primaryError;
  try {
    server = await createServerResource();
    const port = await listenResource(server);
    browser = await launch();
    result = await render({ browser, port, server });
  } catch (error) {
    primaryError = error;
  }

  const cleanupTasks = [];
  if (browser) cleanupTasks.push(Promise.resolve().then(() => browser.close()));
  if (server) cleanupTasks.push(Promise.resolve().then(() => closeServer(server)));
  const cleanupResults = await Promise.allSettled(cleanupTasks);
  const cleanupErrors = cleanupResults
    .filter(({ status }) => status === 'rejected')
    .map(({ reason }) => reason instanceof Error ? reason : new Error(String(reason)));

  if (primaryError) {
    if (cleanupErrors.length) {
      if (primaryError.cause === undefined) primaryError.cause = cleanupErrors[0];
      primaryError.cleanupErrors = cleanupErrors.slice(0, 5).map(({ message }) => message);
    }
    throw primaryError;
  }
  if (cleanupErrors.length) {
    const [error] = cleanupErrors;
    error.cleanupErrors = cleanupErrors.slice(0, 5).map(({ message }) => message);
    throw error;
  }
  return result;
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
  network = createSecurityDefaults().network,
  timeout = 300_000,
}) {
  const documentRoot = dirname(htmlPath);
  return runRendererLifecycle({
    createServer: async () => createStaticServer(await Promise.all([
      { prefix: '/viewer/', root: VIEWER_ROOT },
      { prefix: '/document/', root: documentRoot },
    ].map(async (route) => ({ ...route, canonicalRoot: await realpath(route.root) })))),
    listen,
    launch: () => puppeteer.launch({
      headless: true,
      args: process.env.CI ? ['--no-sandbox'] : [],
    }),
    render: async ({ browser, port }) => {
    const page = await browser.newPage();
    page.setDefaultTimeout(timeout);
    const base = `http://127.0.0.1:${port}`;
    return withRequestPolicy(page, network, { allowedOrigins: [base] }, async (requests) => {
      const pageErrors = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));
      page.on('response', (response) => {
        if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) {
          pageErrors.push(`${response.status()} ${response.url()}`);
        }
      });

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
      if (requests.blocked.length) {
        throw new Error(`Network policy blocked request: ${requests.blocked.join(', ')}`);
      }

      const pdf = await page.pdf({
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
        preferCSSPageSize: true,
        printBackground: true,
        tagged: true,
      });
      await writeFile(pdfPath, pdf);
      return { pageSizeData: sizes, externalRequests: requests.observedExternal };
    });
    },
  });
}
