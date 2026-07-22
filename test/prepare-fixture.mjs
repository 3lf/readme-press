import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const outputs = [
  resolve(here, 'fixtures/basic/figure.png'),
  resolve(here, 'fixtures/persian/figure.png'),
];

const figure = await sharp({
  create: {
    width: 900,
    height: 540,
    channels: 4,
    background: { r: 244, g: 237, b: 220, alpha: 1 },
  },
})
  .composite([
    {
      input: Buffer.from(`<svg width="900" height="540" xmlns="http://www.w3.org/2000/svg">
        <rect x="80" y="80" width="740" height="380" rx="32" fill="#1C3F73"/>
        <text x="450" y="250" text-anchor="middle" font-family="sans-serif" font-size="58" fill="#F4EDDC">README Press</text>
        <text x="450" y="330" text-anchor="middle" font-family="sans-serif" font-size="32" fill="#DFC585">Markdown → PDF</text>
      </svg>`),
    },
  ])
  .png({ compressionLevel: 9 })
  .toBuffer();

for (const output of outputs) {
  await mkdir(dirname(output), { recursive: true });
  await sharp(figure).toFile(output);
}
