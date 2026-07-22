// GitHub-flavored Markdown → clean book HTML fragments.
// Strategy: slice chapters at mdast level (the README's <div> wrappers live as
// separate top-level `html` nodes, so real headings stay real heading nodes),
// clean GitHub-only presentation, then finish styling passes at hast level.

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeStringify from 'rehype-stringify';
import { visit, SKIP, EXIT } from 'unist-util-visit';
import { toString as mdastToString } from 'mdast-util-to-string';
import { renderMermaid } from './mermaid.mjs';
import { highlight } from './highlight.mjs';

/* ---------------- emoji helpers (twemoji naming rules) ---------------- */

export const EMOJI_RE =
  /[\u{1F1E6}-\u{1F1FF}]{2}|(?:\p{Extended_Pictographic}️?(?:\p{Emoji_Modifier})?)(?:‍\p{Extended_Pictographic}️?(?:\p{Emoji_Modifier})?)*|[#*0-9]️⃣/gu;

const TRAILING_EMOJI_RE =
  /(?:\s|\/|️|‍|⃣|\p{Extended_Pictographic}|\p{Emoji_Modifier}|[\u{1F1E6}-\u{1F1FF}])+$/u;

function toCodePoint(str, sep = '-') {
  const r = [];
  let c = 0, p = 0, i = 0;
  while (i < str.length) {
    c = str.charCodeAt(i++);
    if (p) { r.push((0x10000 + ((p - 0xd800) << 10) + (c - 0xdc00)).toString(16)); p = 0; }
    else if (c >= 0xd800 && c <= 0xdbff) p = c;
    else r.push(c.toString(16));
  }
  return r.join(sep);
}

// twemoji drops FE0F from the filename unless the sequence contains a ZWJ
export function twemojiFile(emoji) {
  const cleaned = emoji.includes('‍') ? emoji : emoji.replace(/️/g, '');
  return toCodePoint(cleaned) + '.svg';
}

/* ---------------- bidi helper: isolate Latin runs ---------------- */

// A mixed token may start with a digit (1M, 400K, 10M). Requiring the first
// character to be Latin isolated only the suffix and made RTL layout reverse
// the visible value. Every match must still contain at least one Latin letter,
// so ordinary Persian/Latin digits are left in their surrounding direction.
const LATIN_TOKEN_SOURCE = String.raw`(?:[A-Za-z][A-Za-z0-9۰-۹./+#&_-]*|[0-9۰-۹][A-Za-z0-9۰-۹./+#&_-]*[A-Za-z][A-Za-z0-9۰-۹./+#&_-]*)`;
const LATIN_RUN_SOURCE = String.raw`${LATIN_TOKEN_SOURCE}(?:[ \t]+[A-Za-z0-9۰-۹./+#&_-]+)*`;
// Parentheses belong to the isolated LTR phrase. Leaving them in the RTL
// context makes Vivliostyle mirror or detach them when a heading wraps.
const ISOLATED_LATIN_RE = new RegExp(
  String.raw`\([ \t]*${LATIN_RUN_SOURCE}[ \t]*\)|${LATIN_RUN_SOURCE}`,
  'g',
);

function escapeHtmlText(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** Wraps Latin phrases in <bdi> so RTL line-breaking can't scramble them
 *  (e.g. a heading wrapping inside «(Fine-tuning vs RAG)»). */
export function wrapLatinHtml(text) {
  const parts = [];
  let last = 0;
  ISOLATED_LATIN_RE.lastIndex = 0;
  for (const match of String(text).matchAll(ISOLATED_LATIN_RE)) {
    if (match.index > last) parts.push(escapeHtmlText(String(text).slice(last, match.index)));
    const classes = match[0].includes(' ') ? 'latin-isolate' : 'latin-isolate latin-token';
    parts.push(`<bdi dir="ltr" class="${classes}">${escapeHtmlText(match[0])}</bdi>`);
    last = match.index + match[0].length;
  }
  if (last < String(text).length) parts.push(escapeHtmlText(String(text).slice(last)));
  return parts.join('');
}

function wrapLatinInHastText(node) {
  // splits a hast text node into text + bdi elements
  const parts = [];
  let last = 0;
  ISOLATED_LATIN_RE.lastIndex = 0;
  for (const m of node.value.matchAll(ISOLATED_LATIN_RE)) {
    if (m.index > last) parts.push({ type: 'text', value: node.value.slice(last, m.index) });
    parts.push({
      type: 'element', tagName: 'bdi',
      properties: {
        dir: 'ltr',
        className: m[0].includes(' ') ? ['latin-isolate'] : ['latin-isolate', 'latin-token'],
      },
      children: [{ type: 'text', value: m[0] }],
    });
    last = m.index + m[0].length;
  }
  if (last < node.value.length) parts.push({ type: 'text', value: node.value.slice(last) });
  return parts.length ? parts : [node];
}

function isolateLatinDescendants(node) {
  if (!node.children) return;
  const skip = new Set(['bdi', 'code', 'pre', 'svg', 'style', 'script']);
  node.children = node.children.flatMap((child) => {
    if (child.type === 'text') return wrapLatinInHastText(child);
    if (child.type === 'element' && !skip.has(child.tagName)) isolateLatinDescendants(child);
    return [child];
  });
}

function classNames(node) {
  const value = node?.properties?.className;
  if (Array.isArray(value)) return value.map(String);
  return value ? [String(value)] : [];
}

function wrapHeadingTableGroups(parent) {
  if (!parent?.children) return;

  for (const child of parent.children) {
    if (child.type === 'element') wrapHeadingTableGroups(child);
  }

  for (let i = 0; i < parent.children.length; i++) {
    const heading = parent.children[i];
    if (heading.type !== 'element' || !['h2', 'h3', 'h4'].includes(heading.tagName)) continue;

    let tableIndex = i + 1;
    while (
      tableIndex < parent.children.length
      && parent.children[tableIndex].type === 'text'
      && !parent.children[tableIndex].value.trim()
    ) {
      tableIndex++;
    }

    const tableWrap = parent.children[tableIndex];
    const tableClasses = classNames(tableWrap);
    if (
      tableWrap?.type !== 'element'
      || tableWrap.tagName !== 'div'
      || !tableClasses.includes('table-wrap')
      || tableClasses.includes('table-wrap--long')
    ) continue;

    const children = parent.children.slice(i, tableIndex + 1);
    parent.children.splice(i, children.length, {
      type: 'element',
      tagName: 'div',
      properties: { className: ['heading-table-group'] },
      children,
    });
  }
}

function groupMixedHeadingTerm(node) {
  if (node.children?.length !== 1 || node.children[0].type !== 'text') return;
  const value = node.children[0].value;
  const match = value.match(/^(.*?\([ \t]*[A-Za-z][A-Za-z0-9۰-۹./+#&_\- \t]*[ \t]*\))(.*)$/u);
  if (!match) return;
  node.children = [
    {
      type: 'element', tagName: 'span',
      properties: { className: ['heading-mixed-term'] },
      children: [{ type: 'text', value: match[1] }],
    },
    { type: 'text', value: match[2] },
  ];
}

/* ---------------- callout classification ---------------- */

const CALLOUT_KINDS = {
  '💡': { kind: 'tip', label: 'نکته' },
  '⚠️': { kind: 'warn', label: 'هشدار' },
  '🚨': { kind: 'warn', label: 'هشدار' },
  '📅': { kind: 'date', label: 'به‌روزرسانی' },
  '🧠': { kind: 'note', label: 'نکته' },
  '🆕': { kind: 'new', label: 'تازه' },
  '🎯': { kind: 'note', label: 'هدف' },
  '📋': { kind: 'note', label: 'یادداشت' },
  '🔒': { kind: 'warn', label: 'امنیت' },
  '⭐': { kind: 'star', label: 'حمایت' },
};

function boundaryCalloutEmoji(text) {
  const markerLine = text.split(/\r?\n/u, 1)[0];
  const matches = [...markerLine.matchAll(EMOJI_RE)];
  const leading = matches.find((match) => match.index <= 2);
  if (leading) return leading[0];
  const trailing = matches.at(-1);
  if (!trailing) return null;
  return markerLine.slice(trailing.index + trailing[0].length).trim() ? null : trailing[0];
}

/* ---------------- mdast-level helpers ---------------- */

function headingText(node) {
  return mdastToString(node).trim();
}

function isNoiseHtml(node) {
  if (node.type !== 'html') return false;
  const v = node.value.trim();
  return (
    /^<\/?div[\s>]/i.test(v) ||
    /^<\/div>$/i.test(v) ||
    /^(?:<br\s*\/?>\s*)+$/i.test(v)
  );
}

function cleanTitle(text) {
  return text.replace(TRAILING_EMOJI_RE, '').trim();
}

function firstStrongDirection(text) {
  const latin = text.search(/[A-Za-z]/u);
  const persian = text.search(/\p{Script=Arabic}/u);
  return latin !== -1 && (persian === -1 || latin < persian) ? 'ltr' : 'rtl';
}

function selectTocHeadings(title, headings, toc = {}) {
  const maxDepth = toc.maxDepth ?? 2;
  const chapterOnly = (toc.chapterOnly ?? []).some((prefix) => title.startsWith(prefix));
  if (chapterOnly) return [];
  return headings.filter((heading) => heading.depth <= maxDepth);
}

function renderTextTree(value, ariaLabel) {
  const lines = value.split('\n').map((line) => line.trimEnd()).filter((line) => line.trim());
  if (lines.length < 3) return null;
  const children = lines.slice(1).map((line) => {
    const match = line.match(/^\s*([├└])──\s+(.+?)\s*$/u);
    return match ? { last: match[1] === '└', text: match[2] } : null;
  });
  if (children.some((child) => child === null)) return null;

  const rows = children.map((child) => `    <div class="book-tree-child${child.last ? ' is-last' : ''}" role="treeitem">
      <span class="book-tree-branch" aria-hidden="true"></span>
      <span class="book-tree-node">${wrapLatinHtml(child.text)}</span>
    </div>`).join('\n');
  return `<div class="book-tree" role="tree" aria-label="${escapeHtmlText(ariaLabel)}">
  <div class="book-tree-root" role="treeitem">${wrapLatinHtml(lines[0].trim())}</div>
  <div class="book-tree-children" role="group">
${rows}
  </div>
</div>`;
}

/* ---------------- GitHub anchor slugger ----------------
   GitHub keeps letters/digits/marks (incl. VS16 U+FE0F), ZWNJ, «-» and «_»;
   drops everything else (punctuation, parens, emoji base chars = \p{So},
   ZWJ); spaces become dashes. Validated against every hand-written anchor
   in the README. github-slugger diverges on emoji/VS16, hence this one. */

function githubSlugChars(value) {
  return [...String(value).toLowerCase()]
    .filter((ch) => ch === '-' || ch === '_' || ch === '‌' || /[\p{L}\p{N}\p{M}\s]/u.test(ch))
    .join('')
    .replace(/\s/g, '-');
}

export class GithubSlugger {
  constructor() { this.counts = new Map(); }
  slug(text) {
    const base = githubSlugChars(text);
    const n = this.counts.get(base) ?? 0;
    this.counts.set(base, n + 1);
    return n === 0 ? base : `${base}-${n}`;
  }
}

/** loose form used to match hrefs whose anchors contain ZWJ-emoji leftovers */
export function looseAnchor(value) {
  return githubSlugChars(value).replace(/️/g, '');
}

/** Whole-book selection: the standalone intro (before the hand-written GitHub
 *  TOC) plus every numbered chapter after it, grouped into configured parts. */
export function selectBook(tree, structure) {
  const kids = tree.children;
  const isH1 = (n) => n.type === 'heading' && n.depth === 1;
  const introIdx = kids.findIndex((n) => isH1(n) && headingText(n).startsWith(structure.introHeading));
  const tocIdx = kids.findIndex((n) => isH1(n) && headingText(n).startsWith(structure.githubTocHeading));
  if (introIdx === -1) throw new Error(`intro chapter not found: ${structure.introHeading}`);
  if (tocIdx === -1 || tocIdx <= introIdx) throw new Error('GitHub TOC heading not found after the intro');
  const afterToc = kids.findIndex((n, i) => i > tocIdx && isH1(n));
  if (afterToc === -1) throw new Error('no chapters found after the GitHub TOC');

  const bookNodes = [...kids.slice(introIdx, tocIdx), ...kids.slice(afterToc)];

  // group into chapters at h1 boundaries, assigning parts by startHeading
  const partStarts = structure.parts.map((p, i) => ({
    ...p,
    number: i + 1,
    key: cleanTitle(p.startHeading),
  }));
  const parts = [];
  const chapters = [];
  const introKey = cleanTitle(structure.introHeading);
  let currentPart = null;
  let currentChapter = null;
  let displayNumber = 0;
  for (const node of bookNodes) {
    if (isH1(node)) {
      const title = cleanTitle(headingText(node));
      const isIntroduction = title.startsWith(introKey) && currentPart === null;
      const startsPart = partStarts.find((p) => title.startsWith(p.key));
      if (startsPart) {
        currentPart = { number: startsPart.number, title: startsPart.title, chapters: [] };
        parts.push(currentPart);
      }
      if (isIntroduction) {
        currentChapter = {
          number: chapters.length + 1,
          displayNumber: null,
          part: null,
          isPartStart: false,
          isIntroduction: true,
          nodes: [node],
        };
        chapters.push(currentChapter);
        continue;
      }
      if (!currentPart) throw new Error(`chapter before any configured part: ${title}`);
      displayNumber += 1;
      currentChapter = {
        number: chapters.length + 1,
        displayNumber,
        part: currentPart,
        isPartStart: Boolean(startsPart),
        isIntroduction: false,
        nodes: [node],
      };
      chapters.push(currentChapter);
      currentPart.chapters.push(currentChapter);
    } else if (currentChapter) {
      currentChapter.nodes.push(node);
    }
  }
  if (parts.length !== structure.parts.length) {
    const found = new Set(parts.map((p) => p.number));
    const missing = partStarts.filter((p) => !found.has(p.number)).map((p) => p.startHeading);
    throw new Error(`part starts not found in README: ${missing.join(' | ')}`);
  }
  return { parts, chapters };
}

/* ---------------- per-chapter mdast cleaning ---------------- */

function cleanChapterMdast(nodes, ctx) {
  const out = [];
  for (const n of nodes) {
    if (isNoiseHtml(n)) continue;
    if (n.type === 'thematicBreak') continue; // decorative --- separators
    out.push(n);
  }
  const root = { type: 'root', children: out };

  // headings: record slug from ORIGINAL text (GitHub behavior), then strip
  // trailing emoji for the book, and demote h4->strong-para styling via class.
  visit(root, 'heading', (node) => {
    const original = headingText(node);
    const slug = ctx.slugger.slug(original);
    const clean = original.replace(TRAILING_EMOJI_RE, '').trim();
    node.data = {
      hProperties: { id: slug, 'data-level': node.depth },
    };
    ctx.headings.push({ depth: node.depth, text: clean, slug });
    // replace children with single clean text (styling is CSS's job)
    node.children = [{ type: 'text', value: clean }];
  });

  // Blockquote callouts accept the original leading marker and an RTL-safe
  // trailing marker. The latter lets GitHub choose direction from Persian text.
  visit(root, 'blockquote', (node) => {
    const fullText = mdastToString(node).trim();
    const firstBlockText = mdastToString(node.children?.[0] ?? node).trim();
    const marker = boundaryCalloutEmoji(firstBlockText);
    if (!marker) return;
    const meta = CALLOUT_KINDS[marker] ?? { kind: 'note', label: 'نکته' };
    const className = ['callout', `callout-${meta.kind}`];
    for (const rule of ctx.contentRules.calloutClassRules) {
      if (fullText.includes(rule.contains)) className.push(rule.className);
    }
    node.data = {
      hName: 'aside',
      hProperties: { className, 'data-icon': marker },
    };
    // Drop the source marker from whichever text node contains it. The icon
    // column replaces it in the rendered book.
    visit(node, 'text', (t) => {
      if (t.value.includes(marker)) {
        t.value = t.value
          .replace(marker, '')
          .replace(/^\s*/u, '')
          .replace(/\s*$/u, '');
        return EXIT;
      }
    });
  });

  visit(root, 'paragraph', (node) => {
    const text = mdastToString(node);
    for (const rule of ctx.contentRules.paragraphClassRules) {
      const matches = rule.startsWith ? text.startsWith(rule.startsWith) : text.includes(rule.contains);
      if (!matches) continue;
      node.data = {
        ...(node.data ?? {}),
        hProperties: {
          ...(node.data?.hProperties ?? {}),
          className: String(rule.className).split(/\s+/).filter(Boolean),
        },
      };
    }
  });

  return root;
}

/* ---------------- code fences: shiki + mermaid ---------------- */

/* Author figures: markdown images (e.g. images/vis-01-….png) become the same
 * <figure class="diagram"> as mermaid output, sized from the PNG header so
 * Vivliostyle prints them correctly; files are registered for the dist copy. */
function pngSize(path) {
  const buf = readFileSync(path);
  if (buf.length < 24 || buf.readUInt32BE(12) !== 0x49484452) return null; // "IHDR"
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function renderImages(root, ctx) {
  visit(root, 'image', (node, index, parent) => {
    if (!parent || !node.url || node.url.startsWith('http')) return;
    const abs = ctx.sourceDir ? resolve(ctx.sourceDir, node.url) : null;
    if (!abs || !existsSync(abs)) {
      ctx.diagnostics?.push({ code: 'MISSING_FIGURE_FILE', detail: node.url });
      return;
    }
    const size = node.url.endsWith('.png') ? pngSize(abs) : null;
    const tall = size && size.height / size.width > ctx.imageOptions.tallRatio ? ' diagram--tall' : '';
    const special = ctx.imageOptions.classRules
      .filter((rule) => node.url.endsWith(rule.endsWith))
      .map((rule) => ` ${rule.className}`)
      .join('');
    const dims = size ? ` width="${size.width}" height="${size.height}"` : '';
    const alt = (node.alt || 'تصویر').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const outputUrl = node.url.endsWith('.png') ? node.url.replace(/\.png$/i, '.jpg') : node.url;
    ctx.images.set(outputUrl, { source: abs, optimize: node.url.endsWith('.png') });
    parent.children[index] = {
      type: 'html',
      value: `<figure class="diagram${tall}${special}"><img src="${outputUrl}"${dims} alt="${alt}"></figure>`,
    };
  });
}

async function renderCodeBlocks(root, ctx) {
  const jobs = [];
  visit(root, 'code', (node, index, parent) => {
    jobs.push({ node, index, parent });
  });
  for (const { node, index, parent } of jobs) {
    const lang = (node.lang || '').toLowerCase();
    if (lang === 'mermaid') {
      const d = await renderMermaid(node.value, ctx.mermaid);
      ctx.diagrams.set(d.file, d.path);
      const tall = d.height / d.width > 1.4 ? ' diagram--tall' : '';
      parent.children[index] = {
        type: 'html',
        value: `<figure class="diagram${tall}"><img src="assets/diagrams/${d.file}" width="${d.width}" height="${d.height}" alt="دیاگرام"></figure>`,
      };
    } else if (['python', 'bash', 'json', 'js', 'javascript', 'yaml'].includes(lang)) {
      const html = await highlight(node.value, lang);
      // long listings must be allowed to fragment across pages
      const long = node.value.split('\n').length > 24 ? ' codeblock--long' : '';
      parent.children[index] = {
        type: 'html',
        value: `<div class="codeblock${long}" dir="ltr" data-lang="${lang}">${html}</div>`,
      };
    } else {
      // Text fences can be Persian examples or copy-ready English prompts.
      // Keep the raw text intact, but give long LTR prompts their own layout.
      const tree = renderTextTree(node.value, ctx.contentRules.treeAriaLabel);
      if (tree) {
        parent.children[index] = { type: 'html', value: tree };
        continue;
      }
      const esc = escapeHtmlText(node.value);
      const direction = firstStrongDirection(node.value);
      if (direction === 'ltr') {
        const long = node.value.split('\n').length > 18 || node.value.length > 900
          ? ' promptblock--long'
          : '';
        parent.children[index] = {
          type: 'html',
          value: `<div class="promptblock${long}" dir="ltr"><pre>${esc}</pre></div>`,
        };
      } else {
        const long = node.value.split('\n').length > 11 || node.value.length > 340
          ? ' example--long'
          : '';
        parent.children[index] = {
          type: 'html',
          value: `<pre class="example${long}" dir="rtl">${esc}</pre>`,
        };
      }
    }
  }
}

/* ---------------- callout icons (inline SVG, currentColor) ---------------- */

const ICONS = {
  tip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 21h4M12 3a6.5 6.5 0 0 0-3.6 11.9c.7.5 1.1 1.2 1.3 2.1h4.6c.2-.9.6-1.6 1.3-2.1A6.5 6.5 0 0 0 12 3z"/></svg>',
  note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><circle cx="12" cy="8" r="0.4" fill="currentColor"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5 21.5 20h-19L12 3.5z"/><path d="M12 10v4.5"/><circle cx="12" cy="17.2" r="0.4" fill="currentColor"/></svg>',
  date: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 9.5h17M8 3.2v3M16 3.2v3"/></svg>',
  new: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4.5 13.8 10 19.5 12l-5.7 2-1.8 5.5L10.2 14 4.5 12l5.7-2L12 4.5z"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3.5 2.65 5.37 5.93.86-4.29 4.18 1.01 5.91L12 17.03l-5.3 2.79 1.01-5.91-4.29-4.18 5.93-.86L12 3.5z"/></svg>',
};

/* ---------------- hast-level passes ---------------- */

function hastPasses(tree, ctx) {
  // 0) callouts: wrap children into icon + content columns
  visit(tree, 'element', (node) => {
    if (node.tagName !== 'aside') return;
    const cls = node.properties?.className ?? [];
    if (!cls.includes('callout')) return;
    const kind = String(cls.find((c) => String(c).startsWith('callout-')) ?? 'callout-note')
      .replace('callout-', '');
    const inner = node.children;
    node.children = [
      {
        type: 'element', tagName: 'div',
        properties: { className: ['callout-icon'] },
        children: [{ type: 'raw', value: ICONS[kind] ?? ICONS.note }],
      },
      {
        type: 'element', tagName: 'div',
        properties: { className: ['callout-content'] },
        children: inner,
      },
    ];
    delete node.properties['data-icon'];
    return SKIP;
  });
  // 1) internal links: keep if target exists in the sliced book, else unwrap.
  // Repository-relative document links must become public URLs before the PDF
  // renderer resolves them against its localhost build server.
  visit(tree, 'element', (node, index, parent) => {
    if (node.tagName !== 'a' || !parent) return;
    const href = node.properties?.href ?? '';
    if (typeof href === 'string' && ['CONTRIBUTING.md', './CONTRIBUTING.md'].includes(href)) {
      node.properties.href = `${ctx.repository.url}/blob/${ctx.repository.branch}/CONTRIBUTING.md`;
    } else if (typeof href === 'string' && ['LICENSE', './LICENSE'].includes(href)) {
      node.properties.href = `${ctx.repository.url}/blob/${ctx.repository.branch}/LICENSE`;
    } else if (typeof href === 'string' && href.startsWith('#')) {
      const target = decodeURIComponent(href.slice(1));
      if (!ctx.headings.some((h) => h.slug === target)) {
        // legacy anchors with ZWJ-emoji leftovers still resolve loosely
        const loose = looseAnchor(target);
        const hit = ctx.headings.find((h) => looseAnchor(h.slug) === loose);
        if (hit) {
          node.properties.href = `#${hit.slug}`;
        } else {
          ctx.diagnostics?.push({ code: 'UNRESOLVED_INTERNAL_LINK', detail: href });
          parent.children.splice(index, 1, ...node.children);
          return index;
        }
      }
    }
  });

  // 1.5) Prose, headings, and table cells: isolate mixed-script runs. Single
  // tokens also receive a no-break class, so names such as Persian-Phi and
  // values such as 400K stay intact without forcing long phrases onto one line.
  visit(tree, 'element', (node) => {
    if (!['p', 'li', 'dt', 'dd', 'figcaption', 'h2', 'h3', 'h4', 'td', 'th'].includes(node.tagName)) return;
    if (['h2', 'h3', 'h4'].includes(node.tagName)) groupMixedHeadingTerm(node);
    isolateLatinDescendants(node);
    return SKIP;
  });

  // 2) tables: wrap for overflow control; long tables may break across pages
  visit(tree, 'element', (node, index, parent) => {
    if (node.tagName !== 'table' || !parent) return;
    if (parent.tagName === 'div' && parent.properties?.className?.includes('table-wrap')) return;
    const rowCount = (node.children ?? []).reduce(
      (sum, c) => sum + ((c.tagName === 'tbody' || c.tagName === 'thead') ? (c.children?.length ?? 0) : 0),
      0,
    );
    const cls = ['table-wrap'];
    if (rowCount > 12) cls.push('table-wrap--long');
    parent.children[index] = {
      type: 'element', tagName: 'div',
      properties: { className: cls },
      children: [node],
    };
    return SKIP;
  });

  // 2.5) A short table is already atomic in paged media. Keep its heading in
  // the same atomic wrapper so Vivliostyle never starts the mixed RTL/LTR
  // heading, rolls the table to the next page, and leaves a stale fragment.
  wrapHeadingTableGroups(tree);

  // 3) inline code inside RTL prose: isolate LTR
  visit(tree, 'element', (node) => {
    if (node.tagName === 'code') {
      const cls = node.properties.className;
      const inShiki = Array.isArray(cls) && cls.some((c) => String(c).startsWith('shiki'));
      if (!inShiki) node.properties.dir = 'ltr';
    }
  });

  // 4) emoji in text → local twemoji SVG imgs (skip code/pre/svg subtrees)
  const SKIP_TAGS = new Set(['pre', 'code', 'svg', 'style', 'script']);
  const walk = (node) => {
    if (node.type === 'element' && SKIP_TAGS.has(node.tagName)) return;
    if (!node.children) return;
    const next = [];
    for (const child of node.children) {
      if (child.type !== 'text' || !EMOJI_RE.test(child.value)) {
        walk(child);
        next.push(child);
        continue;
      }
      EMOJI_RE.lastIndex = 0;
      let last = 0;
      for (const m of child.value.matchAll(EMOJI_RE)) {
        if (m.index > last) next.push({ type: 'text', value: child.value.slice(last, m.index) });
        const file = twemojiFile(m[0]);
        ctx.usedEmoji.add(file);
        next.push({
          type: 'element', tagName: 'img',
          properties: { className: ['emoji'], src: `assets/twemoji/${file}`, alt: m[0] },
          children: [],
        });
        last = m.index + m[0].length;
      }
      if (last < child.value.length) next.push({ type: 'text', value: child.value.slice(last) });
    }
    node.children = next;
  };
  walk(tree);
}

/* ---------------- public API ---------------- */

export async function transformReadme(markdown, config, ctxExtra = {}) {
  const ctx = {
    slugger: new GithubSlugger(),
    headings: [],
    usedEmoji: new Set(),
    diagrams: new Map(),
    images: new Map(),
    diagnostics: [],
    repository: config.repository,
    imageOptions: config.images,
    contentRules: config.contentRules,
    mermaid: config.mermaid,
    ...ctxExtra,
  };

  const mdast = unified().use(remarkParse).use(remarkGfm).parse(markdown);
  const { parts, chapters } = selectBook(mdast, config.structure);

  // pass 1: clean + collect headings (slugs must be computed in document order)
  const cleanedChapters = [];
  for (const chapter of chapters) {
    const headingStart = ctx.headings.length;
    const root = cleanChapterMdast(chapter.nodes, ctx);
    const subheadings = ctx.headings
      .slice(headingStart)
      .filter((heading) => heading.depth === 2 || heading.depth === 3);
    cleanedChapters.push({ chapter, root, subheadings });
  }

  // pass 2: code fences (async: mermaid render, shiki) + author figures
  for (const ch of cleanedChapters) {
    renderImages(ch.root, ctx);
    await renderCodeBlocks(ch.root, ctx);
  }

  // pass 3: mdast → hast → html per chapter
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeStringify, { allowDangerousHtml: true });

  const rendered = [];
  for (const { chapter, root, subheadings } of cleanedChapters) {
    const hast = await processor.run(root);
    hastPasses(hast, ctx);
    // pull the h1 out — the chapter opener renders it
    let title = '';
    let titleSlug = null;
    visit(hast, 'element', (node, index, parent) => {
      if (node.tagName === 'h1' && parent) {
        title = node.children.map((c) => (c.type === 'text' ? c.value : '')).join('').trim();
        titleSlug = node.properties?.id ?? null;
        parent.children.splice(index, 1);
        return EXIT;
      }
    });
    rendered.push({
      number: chapter.number,
      displayNumber: chapter.displayNumber,
      partNumber: chapter.part?.number ?? null,
      partTitle: chapter.part?.title ?? null,
      isPartStart: chapter.isPartStart,
      isIntroduction: chapter.isIntroduction,
      title,
      slug: titleSlug,
      subheadings,
      tocHeadings: selectTocHeadings(title, subheadings, config.toc),
      html: processor.stringify(hast),
    });
  }

  return {
    parts: parts.map((p) => ({ number: p.number, title: p.title, chapterNumbers: p.chapters.map((c) => c.number) })),
    chapters: rendered,
    headings: ctx.headings,
    usedEmoji: ctx.usedEmoji,
    diagrams: ctx.diagrams,
    images: ctx.images,
    diagnostics: ctx.diagnostics,
  };
}
