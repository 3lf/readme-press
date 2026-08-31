import { unified } from 'unified';
import rehypeParse from 'rehype-parse';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';

export function escapeHtmlText(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export function escapeHtmlAttribute(value) {
  return escapeHtmlText(value)
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const RAW_HTML_SCHEMA = {
  ...defaultSchema,
  tagNames: [...new Set([
    ...(defaultSchema.tagNames ?? []),
    'div',
    'span',
    'sub',
    'sup',
  ])],
  attributes: {
    ...defaultSchema.attributes,
    '*': [
      ...(defaultSchema.attributes?.['*'] ?? []),
      'className',
    ],
  },
};

const INLINE_MARKUP_SCHEMA = {
  tagNames: ['strong', 'em', 'br'],
  attributes: {},
  protocols: {},
};

function sanitizer(schema) {
  return unified()
    .use(rehypeParse, { fragment: true })
    .use(rehypeSanitize, schema)
    .use(rehypeStringify);
}

const rawHtmlSanitizer = sanitizer(RAW_HTML_SCHEMA);
const inlineMarkupSanitizer = sanitizer(INLINE_MARKUP_SCHEMA);
const RAW_HTML_TAGS = new Set(RAW_HTML_SCHEMA.tagNames ?? []);
const VOID_HTML_TAGS = new Set(['area', 'br', 'col', 'hr', 'img', 'input', 'wbr']);

function sanitizeFragment(value) {
  return String(rawHtmlSanitizer.processSync(String(value)));
}

function sanitizeBoundaryToken(markup, name) {
  if (!RAW_HTML_TAGS.has(name)) return null;
  if (markup.startsWith('</')) {
    return VOID_HTML_TAGS.has(name) ? null : `</${name}>`;
  }
  if (/\/>$/u.test(markup) && !VOID_HTML_TAGS.has(name)) return null;

  let fragment;
  if (name === 'tr') {
    fragment = `<table><tbody>${markup}</tr></tbody></table>`;
  } else if (name === 'td' || name === 'th') {
    fragment = `<table><tbody><tr>${markup}</${name}></tr></tbody></table>`;
  } else {
    fragment = VOID_HTML_TAGS.has(name) ? markup : `${markup}</${name}>`;
  }
  const sanitized = sanitizeFragment(fragment);
  return sanitized.match(new RegExp(`<${name}\\b[^>]*>`, 'u'))?.[0] ?? '';
}

function sanitizeBoundaryMarkup(value) {
  const source = String(value);
  const tokens = [...source.matchAll(/<\/?([A-Za-z][\w-]*)\b[^>]*>/gu)];
  if (!tokens.length) return null;
  const remainder = source.replace(/<\/?[A-Za-z][\w-]*\b[^>]*>/gu, '');
  if (/[<>]/u.test(remainder)) return null;

  let cursor = 0;
  let output = '';
  for (const token of tokens) {
    const name = token[1].toLowerCase();
    const sanitized = sanitizeBoundaryToken(token[0], name);
    if (sanitized === null) return null;
    output += source.slice(cursor, token.index) + sanitized;
    cursor = token.index + token[0].length;
  }
  return output + source.slice(cursor);
}

export function sanitizeRawHtml(value) {
  return sanitizeBoundaryMarkup(value) ?? sanitizeFragment(value);
}

export function sanitizeInlineMarkup(value) {
  return String(inlineMarkupSanitizer.processSync(String(value ?? '')));
}
