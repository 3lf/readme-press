// Assembles the final book HTML: detailed TOC + colophon + quiet part
// transitions + half-page chapter openers.

import { wrapLatinHtml } from './transform.mjs';
import { escapeHtmlAttribute, escapeHtmlText } from './html.mjs';

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

function contentSecurityPolicy(config) {
  if (!['safe', 'deny'].includes(config.security?.rawHtml)) return '';
  const policy = config.security.network;
  const remoteSources = policy.mode === 'trusted'
    ? ['http:', 'https:']
    : policy.mode === 'allowlist'
      ? policy.allowHosts.flatMap((host) => [`http://${host}`, `https://${host}`])
      : [];
  const remote = remoteSources.join(' ');
  const value = [
    "default-src 'none'",
    `img-src 'self' data:${remote ? ` ${remote}` : ''}`,
    `style-src 'self' 'unsafe-inline'${remote ? ` ${remote}` : ''}`,
    `font-src 'self' data:${remote ? ` ${remote}` : ''}`,
    "script-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  return `<meta http-equiv="Content-Security-Policy" content="${escapeHtmlAttribute(value)}">`;
}

function colophon(config) {
  const { metadata, labels, repository } = config;
  return `<section class="colophon" role="doc-colophon">
  <div class="colophon-inner">
    <div class="colophon-orn">${SHAMSA}</div>
    <p class="colophon-kicker">${escapeHtmlText(labels.colophon)}</p>
    <dl class="colophon-grid">
      <dt>${escapeHtmlText(labels.title)}</dt><dd>${escapeHtmlText(metadata.title)}</dd>
      ${metadata.subtitle ? `<dt>${escapeHtmlText(labels.subtitle)}</dt><dd>${escapeHtmlText(metadata.subtitle)}</dd>` : ''}
      <dt>${escapeHtmlText(labels.author)}</dt><dd><bdi>${escapeHtmlText(metadata.author)}</bdi></dd>
      <dt>${escapeHtmlText(labels.edition)}</dt><dd>${editionHtml(metadata.edition)}</dd>
      ${config.releaseVersion ? `<dt>${escapeHtmlText(labels.releaseVersion)}</dt><dd><bdi dir="ltr">${escapeHtmlText(config.releaseVersion)}</bdi></dd>` : ''}
      <dt>${escapeHtmlText(labels.source)}</dt><dd><a href="${escapeHtmlAttribute(repository.url)}" class="mono-link">${escapeHtmlText(repository.display)}</a></dd>
      ${metadata.license ? `<dt>${escapeHtmlText(labels.license)}</dt><dd><bdi>${escapeHtmlText(metadata.license)}</bdi></dd>` : ''}
    </dl>
    <div class="colophon-update">
      <div class="colophon-update-copy">
        <strong>${escapeHtmlText(labels.latestTitle)}</strong>
        <p>${escapeHtmlText(labels.latestBody)}</p>
        <a href="${escapeHtmlAttribute(repository.url)}" class="mono-link">${escapeHtmlText(repository.display)}</a>
      </div>
      <a href="${escapeHtmlAttribute(repository.url)}" class="colophon-qr" aria-label="${escapeHtmlAttribute(labels.latestLink)}">
        <img src="assets/repository-qr.svg" alt="${escapeHtmlAttribute(labels.latestLink)}">
        <span>${escapeHtmlText(labels.latestLink)}</span>
      </a>
    </div>
    <p class="colophon-note">${escapeHtmlText(labels.issueNote)}</p>
  </div>
</section>`;
}

function buildToc(parts, chapters, config) {
  const { labels } = config;
  const byNumber = new Map(chapters.map((c) => [c.number, c]));
  const introductions = chapters
    .filter((chapter) => chapter.isIntroduction)
    .map((chapter) => `    <li class="toc-frontmatter">
      <a class="toc-chapter-head" href="#${escapeHtmlAttribute(chapter.slug)}"><span class="kicker">${escapeHtmlText(labels.introduction)}</span><span class="t">${wrapLatinHtml(chapter.title)}</span><span class="dots"></span></a>
    </li>`)
    .join('\n');
  const groups = parts
    .map((part) => {
      const rows = part.chapterNumbers
        .map((n) => {
          const ch = byNumber.get(n);
          const sections = (ch.tocHeadings ?? [])
            .map((heading) => `          <li class="toc-section toc-depth-${heading.depth}">
            <a href="#${escapeHtmlAttribute(heading.slug)}"><span class="section-mark"></span><span class="t">${wrapLatinHtml(heading.text)}</span><span class="dots"></span></a>
          </li>`)
            .join('\n');
          return `      <li class="toc-chapter">
        <a class="toc-chapter-head" href="#${escapeHtmlAttribute(ch.slug)}"><span class="no">${formatNumber(ch.displayNumber, config)}</span><span class="t">${wrapLatinHtml(ch.title)}</span><span class="dots"></span></a>
        <ol class="toc-sections">
${sections}
        </ol>
      </li>`;
        })
        .join('\n');
      return `    <li class="toc-part">
      <a class="toc-part-head" href="#part-${escapeHtmlAttribute(part.number)}"><span class="pno">${escapeHtmlText(labels.part)} ${formatNumber(part.number, config)}</span><span class="pt">${escapeHtmlText(part.title)}</span><span class="dots"></span></a>
      <ol>
${rows}
      </ol>
    </li>`;
    })
    .join('\n');

  const numberedChapterCount = chapters.filter((chapter) => !chapter.isIntroduction).length;
  return `<nav class="book-toc" role="doc-toc">
  <header class="toc-intro">
    <p class="toc-eyebrow">${escapeHtmlText(labels.tocEyebrow)}</p>
    <div class="toc-head">${escapeHtmlText(labels.tocTitle)}</div>
    <div class="toc-rule"><span class="seg"></span><span class="dia"></span><span class="seg"></span></div>
    <p class="toc-deck">${escapeHtmlText(labels.tocDescription)}</p>
    <div class="toc-stats">
      <span><b>${formatNumber(parts.length, config)}</b> ${escapeHtmlText(labels.part)}</span>
      <span><b>${formatNumber(numberedChapterCount, config)}</b> ${escapeHtmlText(labels.chapter)}</span>
    </div>
  </header>
  <ol class="toc-root">
${introductions}
${groups}
  </ol>
</nav>`;
}

function chapterSection(ch, part, partCount, config) {
  const chapterHtml = ch.htmlByQuality?.[config.outputVariant ?? 'normal'] ?? ch.html;
  if (ch.isIntroduction) {
    return `<section class="chapter chapter-introduction">
  <header class="chapter-opener">
    <div class="co-shamsa">${SHAMSA}</div>
    <p class="co-eyebrow co-eyebrow-intro">${escapeHtmlText(config.labels.introduction)}</p>
    <h1 id="${escapeHtmlAttribute(ch.slug ?? '')}">${wrapLatinHtml(ch.title)}</h1>
    <div class="co-rule"><span class="seg"></span><span class="dia"></span><span class="seg"></span></div>
  </header>
  <div class="chapter-body">
${chapterHtml}
  </div>
</section>`;
  }
  const transition = ch.isPartStart
    ? `<div class="part-transition" id="part-${part.number}">
    <div class="part-transition-meta"><span>${escapeHtmlText(config.labels.part)} ${formatNumber(part.number, config)} از ${formatNumber(partCount, config)}</span><i></i><span>${formatNumber(part.chapterNumbers.length, config)} ${escapeHtmlText(config.labels.chapter)}</span></div>
    <strong>${escapeHtmlText(part.title)}</strong>
  </div>`
    : '';
  const configuredClasses = config.contentRules.chapterClassRules
    .filter((rule) => ch.title.startsWith(rule.titleStartsWith))
    .map((rule) => ` ${rule.className}`)
    .join('');
  return `<section class="${escapeHtmlAttribute(`chapter${ch.isPartStart ? ' chapter-part-start' : ''}${configuredClasses}`)}">
  ${transition}
  <header class="chapter-opener">
    <div class="co-shamsa">${SHAMSA}</div>
    <p class="co-eyebrow"><span>${escapeHtmlText(config.labels.part)} ${formatNumber(ch.partNumber, config)}</span><i class="dia"></i><span>${escapeHtmlText(config.labels.chapter)} ${formatNumber(ch.displayNumber, config)}</span></p>
    <h1 id="${escapeHtmlAttribute(ch.slug ?? '')}">${wrapLatinHtml(ch.title)}</h1>
    <div class="co-rule"><span class="seg"></span><span class="dia"></span><span class="seg"></span></div>
  </header>
  <div class="chapter-body">
${chapterHtml}
  </div>
</section>`;
}

export function buildDocument({ parts, chapters }, config) {
  const byPart = new Map(parts.map((part) => [part.number, part]));
  const body = chapters
    .map((chapter) => chapterSection(chapter, byPart.get(chapter.partNumber), parts.length, config))
    .join('\n');

  const variant = config.outputVariant ?? 'normal';
  return `<!doctype html>
<html lang="${escapeHtmlAttribute(config.metadata.language)}" dir="${escapeHtmlAttribute(config.metadata.direction)}" data-readme-press-variant="${escapeHtmlAttribute(variant)}">
<head>
<meta charset="utf-8">
${contentSecurityPolicy(config)}
<title>${escapeHtmlText(config.metadata.title)}؛ ${escapeHtmlText(config.metadata.edition)}${config.releaseVersion ? `؛ ${escapeHtmlText(config.releaseVersion)}` : ''}</title>
<meta name="author" content="${escapeHtmlAttribute(config.metadata.author)}">
<link rel="stylesheet" href="book.css">
</head>
<body>
${buildToc(parts, chapters, config)}
${colophon(config)}
${body}
</body>
</html>`;
}
