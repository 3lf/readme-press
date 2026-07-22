// Render the HTML cover to a 300dpi PNG, then embed that image in a one-page
// PDF. Rasterizing only the cover avoids Apple PDFKit compositing bugs while
// the book body stays vector, searchable, tagged, and linkable.

import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { PDFArray, PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';
import puppeteer from 'puppeteer';

const CSS_DPI = 96;

function pngPathFor(pdfPath) {
  return /\.pdf$/i.test(pdfPath)
    ? pdfPath.replace(/\.pdf$/i, '.png')
    : `${pdfPath}.png`;
}

export async function renderCover(htmlPath, outPath, config) {
  const { widthCm, heightCm, coverDpi } = config.page;
  const scale = coverDpi / CSS_DPI;
  const cssWidth = widthCm / 2.54 * CSS_DPI;
  const cssHeight = heightCm / 2.54 * CSS_DPI;
  const pageWidth = widthCm / 2.54 * 72;
  const pageHeight = heightCm / 2.54 * 72;
  const pngPath = pngPathFor(outPath);
  let repoBounds = null;
  const browser = await puppeteer.launch({
    headless: true,
    args: process.env.CI ? ['--no-sandbox'] : [],
  });

  try {
    const page = await browser.newPage();
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
    });
    await page.evaluate(() => document.fonts.ready);

    const size = await page.$eval('.cover', (element) => {
      const rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    if (Math.abs(size.width - cssWidth) > 0.75 || Math.abs(size.height - cssHeight) > 0.75) {
      throw new Error(`Cover canvas is ${size.width}×${size.height} CSS pixels; expected ${cssWidth}×${cssHeight}`);
    }
    repoBounds = await page.$eval('.repo-url', (element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });

    await page.screenshot({
      path: pngPath,
      type: 'png',
      clip: { x: 0, y: 0, width: cssWidth, height: cssHeight },
      captureBeyondViewport: false,
    });
    await page.close();
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
  if (config.repository.url && repoBounds) {
    const scaleX = pageWidth / cssWidth;
    const scaleY = pageHeight / cssHeight;
    const rect = [
      repoBounds.x * scaleX,
      pageHeight - (repoBounds.y + repoBounds.height) * scaleY,
      (repoBounds.x + repoBounds.width) * scaleX,
      pageHeight - repoBounds.y * scaleY,
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
}
