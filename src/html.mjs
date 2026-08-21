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

function sanitizeFragment(value) {
  return String(rawHtmlSanitizer.processSync(String(value)));
}

function sanitizeBoundaryMarkup(value) {
  const source = String(value);
  const tokens = [...source.matchAll(/<\/?([A-Za-z][\w-]*)\b[^>]*>/gu)];
  if (!tokens.length) return null;
  const remainder = source.replace(/<\/?[A-Za-z][\w-]*\b[^>]*>/gu, '');
  if (remainder.trim() || tokens.some((token) => !['br', 'div'].includes(token[1].toLowerCase()))) {
    return null;
  }

  let cursor = 0;
  let output = '';
  for (const token of tokens) {
    output += source.slice(cursor, token.index);
    const markup = token[0];
    const name = token[1].toLowerCase();
    if (markup.startsWith('</')) {
      output += name === 'div' ? '</div>' : '';
    } else if (name === 'br') {
      output += sanitizeFragment(markup);
    } else {
      output += sanitizeFragment(`${markup}</div>`).replace(/<\/div>$/u, '');
    }
    cursor = token.index + markup.length;
  }
  return output + source.slice(cursor);
}

export function sanitizeRawHtml(value) {
  return sanitizeBoundaryMarkup(value) ?? sanitizeFragment(value);
}

export function sanitizeInlineMarkup(value) {
  return String(inlineMarkupSanitizer.processSync(String(value ?? '')));
}
