// Render the HTML cover to a 300dpi PNG, then embed that image in a one-page
// PDF. Rasterizing only the cover avoids Apple PDFKit compositing bugs while
// the book body stays vector, searchable, tagged, and linkable.

import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { PDFArray, PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';
import puppeteer from 'puppeteer';
import { normalizeNetworkPolicy, withRequestPolicy } from './network.mjs';

const CSS_DPI = 96;
const MAX_STABLE_SCREENSHOT_ATTEMPTS = 5;

function stableRequestInventory(values) {
  return [...new Set(values)].sort();
}

function pngPathFor(pdfPath) {
  return /\.pdf$/i.test(pdfPath)
    ? pdfPath.replace(/\.pdf$/i, '.png')
    : `${pdfPath}.png`;
}

export async function captureStableScreenshot(
  page,
  options,
  maxAttempts = MAX_STABLE_SCREENSHOT_ATTEMPTS,
) {
  await freezeCoverMotion(page);
  let previous = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await page.evaluate(() => new Promise((resolvePaint) => {
      requestAnimationFrame(() => requestAnimationFrame(resolvePaint));
    }));
    const current = Buffer.from(await page.screenshot(options));
    if (previous?.equals(current)) {
      return { buffer: current, stabilized: true, attempts: attempt };
    }
    previous = current;
  }
  return { buffer: previous, stabilized: false, attempts: maxAttempts };
}

export async function freezeCoverMotion(page) {
  await page.evaluate(() => {
    const styleId = 'readme-press-motion-freeze';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        *, *::before, *::after {
          animation-play-state: paused !important;
          caret-color: transparent !important;
          transition: none !important;
        }
      `;
      document.head.append(style);
    }
    for (const animation of document.getAnimations()) {
      try {
        animation.currentTime = 0;
        animation.pause();
      } catch {
        // Some browser-managed animations cannot be controlled. The bounded
        // screenshot fallback below still produces a complete cover frame.
      }
    }
  });
}

export async function renderCover(htmlPath, outPath, config) {
  const { widthCm, heightCm, coverDpi } = config.page;
  const scale = coverDpi / CSS_DPI;
  const cssWidth = widthCm / 2.54 * CSS_DPI;
  const cssHeight = heightCm / 2.54 * CSS_DPI;
  const pageWidth = widthCm / 2.54 * 72;
  const pageHeight = heightCm / 2.54 * 72;
  const pngPath = pngPathFor(outPath);
  let captureData = null;
  const browser = await puppeteer.launch({
    headless: true,
    args: process.env.CI ? ['--no-sandbox'] : [],
  });

  try {
    const page = await browser.newPage();
    const networkPolicy = config.security?.network ?? normalizeNetworkPolicy('trusted');
    captureData = await withRequestPolicy(
      page,
      networkPolicy,
      {
        offlineForDeny: true,
        blockedRequestLabel: 'Network policy blocked cover request',
      },
      async (requests) => {
        await page.setViewport({
          width: Math.ceil(cssWidth),
          height: Math.ceil(cssHeight),
          deviceScaleFactor: scale,
        });
        await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle0' });
        await page.evaluate((data) => {
            document.title = data.documentTitle;
            document.documentElement.dir = data.direction;
            document.documentElement.lang = data.language;
            document.documentElement.dataset.readmePressVariant = data.variant;
            document.body.dataset.readmePressVariant = data.variant;
            document.body.style.direction = data.direction;
            const values = {
              series: data.series,
              'title-prefix': data.titlePrefix,
              title: data.title,
              tagline: data.tagline,
              author: data.author,
              'date-local': data.localDate,
              'date-latin': data.latinDate,
              repository: data.repository,
            };
            for (const [name, value] of Object.entries(values)) {
              const element = document.querySelector(`[data-readme-press="${name}"]`);
              if (element) element.textContent = value ?? '';
            }
            const note = document.querySelector('[data-readme-press="repository-note"]');
            if (note) note.innerHTML = data.repositoryNote;
            document.querySelector('.cover')?.setAttribute('aria-label', data.documentTitle);
        }, {
            documentTitle: config.metadata.title,
            series: config.cover.series,
            titlePrefix: config.cover.titlePrefix,
            title: config.cover.title,
            tagline: config.cover.tagline,
            author: config.metadata.author,
            localDate: config.metadata.localDate,
            latinDate: config.metadata.latinDate,
            repository: config.repository.display,
            repositoryNote: config.cover.repositoryNote,
            direction: config.metadata.direction,
            language: config.metadata.language,
            variant: config.outputVariant ?? 'normal',
        });
        await page.evaluate(() => document.fonts.ready);
        if (requests.blocked.length) {
          throw new Error(`Network policy blocked cover request: ${requests.blocked.join(', ')}`);
        }
        await page.evaluate(() => new Promise((resolvePaint) => {
          requestAnimationFrame(() => requestAnimationFrame(resolvePaint));
        }));

        const size = await page.$eval('.cover', (element) => {
          const rect = element.getBoundingClientRect();
          return { width: rect.width, height: rect.height };
        });
        if (Math.abs(size.width - cssWidth) > 0.75 || Math.abs(size.height - cssHeight) > 0.75) {
          throw new Error(`Cover canvas is ${size.width}×${size.height} CSS pixels; expected ${cssWidth}×${cssHeight}`);
        }
        const repoBounds = await page.$eval('.repo-url', (element) => {
          const rect = element.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        });

        const capture = await captureStableScreenshot(page, {
          type: 'png',
          clip: { x: 0, y: 0, width: cssWidth, height: cssHeight },
          captureBeyondViewport: false,
        });
        await writeFile(pngPath, capture.buffer);
        if (requests.blocked.length) {
          throw new Error(`Network policy blocked cover request: ${requests.blocked.join(', ')}`);
        }
        return {
          repoBounds,
          // Keep the live arrays until the policy-controlled close lifecycle
          // has observed pagehide keepalives and unload beacons.
          externalRequests: requests.observedExternal,
          blockedRequests: requests.blocked,
          capture,
        };
      },
    );
  } finally {
    await browser.close();
  }

  const png = await readFile(pngPath);
  const pdf = await PDFDocument.create();
  pdf.setTitle(config.metadata.title);
  pdf.setAuthor(config.metadata.author);
  pdf.setCreator(config.metadata.creator);
  const page = pdf.addPage([pageWidth, pageHeight]);
  const image = await pdf.embedPng(png);
  page.drawImage(image, {
    x: 0,
    y: 0,
    width: pageWidth,
    height: pageHeight,
  });
  if (config.repository.url && captureData.repoBounds) {
    const scaleX = pageWidth / cssWidth;
    const scaleY = pageHeight / cssHeight;
    const rect = [
      captureData.repoBounds.x * scaleX,
      pageHeight - (captureData.repoBounds.y + captureData.repoBounds.height) * scaleY,
      (captureData.repoBounds.x + captureData.repoBounds.width) * scaleX,
      pageHeight - captureData.repoBounds.y * scaleY,
    ];
    const annotation = pdf.context.register(pdf.context.obj({
      Type: PDFName.of('Annot'),
      Subtype: PDFName.of('Link'),
      Rect: rect,
      Border: [0, 0, 0],
      F: 4,
      Contents: PDFHexString.fromText(config.labels.latestLink),
      A: pdf.context.obj({
        S: PDFName.of('URI'),
        URI: PDFString.of(config.repository.url),
      }),
    }));
    const annotations = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray) ?? pdf.context.obj([]);
    annotations.push(annotation);
    page.node.set(PDFName.of('Annots'), annotations);
  }
  await writeFile(outPath, await pdf.save({ useObjectStreams: false }));
  const diagnostics = captureData.capture.stabilized === false
    ? [{
      code: 'ANIMATED_COVER_FALLBACK',
      severity: 'warning',
      promoteInStrict: false,
      detail: `${config.outputVariant ?? 'normal'} cover used the final complete frame after ${captureData.capture.attempts} attempts.`,
    }]
    : [];
  return {
    externalRequests: stableRequestInventory(captureData.externalRequests),
    blockedRequests: stableRequestInventory(captureData.blockedRequests),
    diagnostics,
  };
}
