// Build-time syntax highlighting with Shiki (static HTML, zero JS in output).
// The book uses dark lajvard code panels, so the theme is github-dark; its
// background is overridden in book.css.

import { createHighlighter } from 'shiki';

let highlighterPromise = null;

function getHighlighter() {
  highlighterPromise ??= createHighlighter({
    themes: ['github-dark'],
    langs: ['python', 'bash', 'json', 'javascript', 'yaml'],
  });
  return highlighterPromise;
}

// github-dark token colors for comments (#8B949E) and strings (#A5D6FF):
// give those tokens dir="auto" so fully-Persian comments/strings lay out as
// proper RTL runs inside the LTR code block instead of scrambling around
// their punctuation.
const BIDI_TOKEN_RE = /<span style="color:#(8B949E|A5D6FF)"/g;

export async function highlight(code, lang) {
  const hl = await getHighlighter();
  const html = hl.codeToHtml(code, { lang, theme: 'github-dark' });
  return html.replace(BIDI_TOKEN_RE, '<span dir="auto" style="color:#$1"');
}
