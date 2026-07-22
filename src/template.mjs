// Assembles the final book HTML: detailed TOC + colophon + quiet part
// transitions + half-page chapter openers.

import { wrapLatinHtml } from './transform.mjs';

const SHAMSA = `<svg viewBox="0 0 100 100" fill="none" stroke="currentColor">
  <rect x="22" y="22" width="56" height="56" stroke-width="1.6"/>
  <rect x="22" y="22" width="56" height="56" stroke-width="1.6" transform="rotate(45 50 50)"/>
  <circle cx="50" cy="50" r="14.5" stroke-width="1.2" opacity="0.75"/>
  <rect x="44" y="44" width="12" height="12" transform="rotate(45 50 50)" fill="currentColor" stroke="none" opacity="0.92"/>
</svg>`;

const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
const formatNumber = (n, config) => config.metadata.numerals === 'persian'
  ? String(n).replace(/\d/g, (d) => PERSIAN_DIGITS[d])
  : String(n);

const editionHtml = (edition) => wrapLatinHtml(edition);

function colophon(config) {
  const { metadata, labels, repository } = config;
  return `<section class="colophon" role="doc-colophon">
  <div class="colophon-inner">
    <div class="colophon-orn">${SHAMSA}</div>
    <p class="colophon-kicker">${labels.colophon}</p>
    <dl class="colophon-grid">
      <dt>${labels.title}</dt><dd>${metadata.title}</dd>
      ${metadata.subtitle ? `<dt>${labels.subtitle}</dt><dd>${metadata.subtitle}</dd>` : ''}
      <dt>${labels.author}</dt><dd><bdi>${metadata.author}</bdi></dd>
      <dt>${labels.edition}</dt><dd>${editionHtml(metadata.edition)}</dd>
      ${config.releaseVersion ? `<dt>${labels.releaseVersion}</dt><dd><bdi dir="ltr">${config.releaseVersion}</bdi></dd>` : ''}
      <dt>${labels.source}</dt><dd><a href="${repository.url}" class="mono-link">${repository.display}</a></dd>
      ${metadata.license ? `<dt>${labels.license}</dt><dd><bdi>${metadata.license}</bdi></dd>` : ''}
    </dl>
    <div class="colophon-update">
      <div class="colophon-update-copy">
        <strong>${labels.latestTitle}</strong>
        <p>${labels.latestBody}</p>
        <a href="${repository.url}" class="mono-link">${repository.display}</a>
      </div>
      <a href="${repository.url}" class="colophon-qr" aria-label="${labels.latestLink}">
        <img src="assets/repository-qr.svg" alt="${labels.latestLink}">
        <span>${labels.latestLink}</span>
      </a>
    </div>
    <p class="colophon-note">${labels.issueNote}</p>
  </div>
</section>`;
}

function buildToc(parts, chapters, config) {
  const { labels } = config;
  const byNumber = new Map(chapters.map((c) => [c.number, c]));
  const introductions = chapters
    .filter((chapter) => chapter.isIntroduction)
    .map((chapter) => `    <li class="toc-frontmatter">
      <a class="toc-chapter-head" href="#${chapter.slug}"><span class="kicker">${labels.introduction}</span><span class="t">${wrapLatinHtml(chapter.title)}</span><span class="dots"></span></a>
    </li>`)
    .join('\n');
  const groups = parts
    .map((part) => {
      const rows = part.chapterNumbers
        .map((n) => {
          const ch = byNumber.get(n);
          const sections = (ch.tocHeadings ?? [])
            .map((heading) => `          <li class="toc-section toc-depth-${heading.depth}">
            <a href="#${heading.slug}"><span class="section-mark"></span><span class="t">${wrapLatinHtml(heading.text)}</span><span class="dots"></span></a>
          </li>`)
            .join('\n');
          return `      <li class="toc-chapter">
        <a class="toc-chapter-head" href="#${ch.slug}"><span class="no">${formatNumber(ch.displayNumber, config)}</span><span class="t">${wrapLatinHtml(ch.title)}</span><span class="dots"></span></a>
        <ol class="toc-sections">
${sections}
        </ol>
      </li>`;
        })
        .join('\n');
      return `    <li class="toc-part">
      <a class="toc-part-head" href="#part-${part.number}"><span class="pno">${labels.part} ${formatNumber(part.number, config)}</span><span class="pt">${part.title}</span><span class="dots"></span></a>
      <ol>
${rows}
      </ol>
    </li>`;
    })
    .join('\n');

  const numberedChapterCount = chapters.filter((chapter) => !chapter.isIntroduction).length;
  return `<nav class="book-toc" role="doc-toc">
  <header class="toc-intro">
    <p class="toc-eyebrow">${labels.tocEyebrow}</p>
    <div class="toc-head">${labels.tocTitle}</div>
    <div class="toc-rule"><span class="seg"></span><span class="dia"></span><span class="seg"></span></div>
    <p class="toc-deck">${labels.tocDescription}</p>
    <div class="toc-stats">
      <span><b>${formatNumber(parts.length, config)}</b> ${labels.part}</span>
      <span><b>${formatNumber(numberedChapterCount, config)}</b> ${labels.chapter}</span>
    </div>
  </header>
  <ol class="toc-root">
${introductions}
${groups}
  </ol>
</nav>`;
}

function chapterSection(ch, part, partCount, config) {
  if (ch.isIntroduction) {
    return `<section class="chapter chapter-introduction">
  <header class="chapter-opener">
    <div class="co-shamsa">${SHAMSA}</div>
    <p class="co-eyebrow co-eyebrow-intro">${config.labels.introduction}</p>
    <h1 id="${ch.slug ?? ''}">${wrapLatinHtml(ch.title)}</h1>
    <div class="co-rule"><span class="seg"></span><span class="dia"></span><span class="seg"></span></div>
  </header>
  <div class="chapter-body">
${ch.html}
  </div>
</section>`;
  }
  const transition = ch.isPartStart
    ? `<div class="part-transition" id="part-${part.number}">
    <div class="part-transition-meta"><span>${config.labels.part} ${formatNumber(part.number, config)} از ${formatNumber(partCount, config)}</span><i></i><span>${formatNumber(part.chapterNumbers.length, config)} ${config.labels.chapter}</span></div>
    <strong>${part.title}</strong>
  </div>`
    : '';
  const configuredClasses = config.contentRules.chapterClassRules
    .filter((rule) => ch.title.startsWith(rule.titleStartsWith))
    .map((rule) => ` ${rule.className}`)
    .join('');
  return `<section class="chapter${ch.isPartStart ? ' chapter-part-start' : ''}${configuredClasses}">
  ${transition}
  <header class="chapter-opener">
    <div class="co-shamsa">${SHAMSA}</div>
    <p class="co-eyebrow"><span>${config.labels.part} ${formatNumber(ch.partNumber, config)}</span><i class="dia"></i><span>${config.labels.chapter} ${formatNumber(ch.displayNumber, config)}</span></p>
    <h1 id="${ch.slug ?? ''}">${wrapLatinHtml(ch.title)}</h1>
    <div class="co-rule"><span class="seg"></span><span class="dia"></span><span class="seg"></span></div>
  </header>
  <div class="chapter-body">
${ch.html}
  </div>
</section>`;
}

export function buildDocument({ parts, chapters }, config) {
  const byPart = new Map(parts.map((part) => [part.number, part]));
  const body = chapters
    .map((chapter) => chapterSection(chapter, byPart.get(chapter.partNumber), parts.length, config))
    .join('\n');

  return `<!doctype html>
<html lang="${config.metadata.language}" dir="${config.metadata.direction}">
<head>
<meta charset="utf-8">
<title>${config.metadata.title}؛ ${config.metadata.edition}${config.releaseVersion ? `؛ ${config.releaseVersion}` : ''}</title>
<meta name="author" content="${config.metadata.author}">
<link rel="stylesheet" href="book.css">
</head>
<body>
${buildToc(parts, chapters, config)}
${colophon(config)}
${body}
</body>
</html>`;
}
