// Mermaid fences → standalone SVG files, themed to the book palette.
// Rendered via @mermaid-js/mermaid-cli (mmdc); cached by content hash so CI
// only pays for diagrams that actually changed.
//
// The SVGs are referenced as <img> (NOT inlined): Vivliostyle mishandles
// inline SVG in RTL flow (vertical clipping, dropped arrow markers, and
// unpredictable mirroring — all confirmed empirically). As <img>, Chromium
// renders the SVG in an isolated document, so the Persian font is embedded
// into the SVG itself as a data-URI @font-face.

import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { installedPackageVersion } from './render-inputs.mjs';

const EMOJI_RE =
  /[\u{1F1E6}-\u{1F1FF}]{2}|(?:\p{Extended_Pictographic}️?(?:\p{Emoji_Modifier})?)(?:‍\p{Extended_Pictographic}️?(?:\p{Emoji_Modifier})?)*/gu;

// - `style X fill:#...` lines are hardcoded for GitHub's default theme and
//   fight the book palette
// - emoji in labels would need a color-emoji font inside the isolated SVG
//   image (unreliable in CI), so they are dropped for the book
function cleanSource(source) {
  return source
    .split('\n')
    .filter((l) => !/^\s*style\s+\S+\s+fill:/.test(l))
    .join('\n')
    .replace(EMOJI_RE, '')
    .replace(/ +<br\/>/g, '<br/>');
}

function getFontFace(fontBytes, fontFamily) {
  return `@font-face{font-family:${JSON.stringify(fontFamily)};` +
    `src:url(data:font/woff2;base64,${fontBytes.toString('base64')}) format('woff2');` +
    'font-weight:100 900;}';
}

export function mermaidCacheKey(source, options) {
  const clean = cleanSource(source);
  const hash = createHash('sha256');
  for (const item of [
    'mermaid-svg-v3',
    clean,
    readFileSync(options.configPath),
    readFileSync(options.fontPath),
    options.fontFamily ?? 'Vazirmatn',
    readFileSync(options.mmdcPath),
    installedPackageVersion('@mermaid-js/mermaid-cli'),
    process.env.CI && options.puppeteerConfig ? readFileSync(options.puppeteerConfig) : '',
    Boolean(process.env.CI && options.puppeteerConfig),
  ]) {
    const bytes = Buffer.isBuffer(item) ? item : Buffer.from(String(item));
    hash.update(`${bytes.length}:`).update(bytes);
  }
  return hash.digest('hex').slice(0, 24);
}

/** Renders a mermaid source; returns { file, width, height } (file inside cache). */
export async function renderMermaid(source, options) {
  const {
    cacheDir,
    configPath,
    fontPath,
    fontFamily = 'Vazirmatn',
    mmdcPath,
    puppeteerConfig,
  } = options;
  mkdirSync(cacheDir, { recursive: true });
  const clean = cleanSource(source);
  const hash = mermaidCacheKey(source, options);
  const svgPath = resolve(cacheDir, `${hash}.svg`);

  if (!existsSync(svgPath)) {
    const mmdPath = resolve(cacheDir, `${hash}.mmd`);
    writeFileSync(mmdPath, clean, 'utf8');
    execFileSync(mmdcPath, [
      '-i', mmdPath,
      '-o', svgPath,
      '--configFile', configPath,
      '--backgroundColor', 'transparent',
      '--quiet',
      // GitHub Actions runners need the Chrome sandbox off
      ...(process.env.CI && puppeteerConfig ? ['-p', puppeteerConfig] : []),
    ], { stdio: ['ignore', 'inherit', 'inherit'] });

    let svg = readFileSync(svgPath, 'utf8').replace(/^<\?xml[^>]*>\s*/i, '');
    // explicit intrinsic size from the viewBox so <img> sizes correctly
    const vb = svg.match(/viewBox="([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)"/);
    const w = vb ? Math.ceil(Number(vb[3])) : 800;
    const h = vb ? Math.ceil(Number(vb[4])) : 400;
    svg = svg
      .replace(/width="100%"/, `width="${w}" height="${h}"`)
      .replace(/max-width:\s*[\d.]+px;/, '');
    // embed the Persian font so the isolated SVG image shapes text correctly
    svg = svg.replace(/(<svg[^>]*>)/, `$1<style>${getFontFace(readFileSync(fontPath), fontFamily)}</style>`);
    writeFileSync(svgPath, svg, 'utf8');
  }

  const final = readFileSync(svgPath, 'utf8');
  const vb = final.match(/viewBox="([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)"/);
  return {
    file: `${hash}.svg`,
    path: svgPath,
    width: vb ? Math.ceil(Number(vb[3])) : 800,
    height: vb ? Math.ceil(Number(vb[4])) : 400,
  };
}
