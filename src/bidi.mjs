// Central bidirectional-text policy for book content and covers.
//
// Keep source text in logical order. We only choose a base direction and mark
// technical runs as isolated LTR spans, leaving the Unicode Bidirectional
// Algorithm in the browser to perform the final visual layout.

const ARABIC_LETTER_RE = /(?=\p{Script=Arabic})\p{Letter}/u;
const LATIN_RE = /[A-Za-z]/u;
const DIGIT_RE = /[0-9\u06F0-\u06F9]/u;
const STRUCTURED_RE = /[\[\]{}()=+*/×÷−<>≤≥≈:.,٫٬%٪]/u;

// Directional overrides and isolates in source text are almost always an
// author workaround. Generated <bdi> elements are explicit and inspectable,
// so the engine never needs to inject invisible controls.
export const BIDI_CONTROL_RE = /[\u202A-\u202E\u2066-\u2069]/u;

const LATIN_TOKEN_SOURCE = String.raw`(?:[A-Za-z][A-Za-z0-9۰-۹./+#&_%\-]*|[0-9۰-۹][A-Za-z0-9۰-۹./+#&_%\-]*[A-Za-z][A-Za-z0-9۰-۹./+#&_%\-]*)`;
const LATIN_RUN_SOURCE = String.raw`${LATIN_TOKEN_SOURCE}(?:[ \t]+[A-Za-z0-9۰-۹./+#&_%\-]+)*`;
const PAREN_TECH_SOURCE = String.raw`\([^()\n]*[A-Za-z0-9۰-۹][^()\n]*\)`;
const BRACKET_TECH_SOURCE = String.raw`(?:\[[^\]\n]*[A-Za-z0-9۰-۹][^\]\n]*\]|\{[^}\n]*[A-Za-z0-9۰-۹][^}\n]*\})`;
const NUMBER_SOURCE = String.raw`(?:[=≈<>≤≥+*/×÷−-][ \t]*)?\$?[+\-−]?[0-9۰-۹]+(?:[.,٫٬][0-9۰-۹]+)*(?:[%٪])?`;
const TECHNICAL_PATTERNS = [
  { source: PAREN_TECH_SOURCE, whole: true },
  { source: BRACKET_TECH_SOURCE, whole: true },
  { source: LATIN_RUN_SOURCE, whole: false },
  { source: NUMBER_SOURCE, whole: false },
];

function normalizeDirection(direction) {
  return direction === 'ltr' ? 'ltr' : 'rtl';
}

function technicalMatches(text) {
  const matches = [];
  for (const [priority, pattern] of TECHNICAL_PATTERNS.entries()) {
    const re = new RegExp(pattern.source, 'gu');
    for (const match of text.matchAll(re)) {
      // A parenthesized/bracketed Persian sentence may contain a year. Do not
      // turn the whole phrase LTR, but keep scanning its inner technical runs.
      if (pattern.whole && ARABIC_LETTER_RE.test(match[0])) continue;
      matches.push({
        index: match.index,
        text: match[0],
        end: match.index + match[0].length,
        priority,
      });
    }
  }
  return matches.sort((left, right) => (
    left.index - right.index
    || left.priority - right.priority
    || right.end - left.end
  ));
}

/** Split mixed prose into logical-order text and isolated LTR runs. */
export function segmentBidiText(value) {
  const text = String(value ?? '');
  const segments = [];
  let last = 0;
  for (const match of technicalMatches(text)) {
    if (match.index < last) continue;
    if (match.index > last) {
      segments.push({ text: text.slice(last, match.index), direction: null });
    }
    segments.push({ text: match.text, direction: 'ltr' });
    last = match.end;
  }

  if (last < text.length) segments.push({ text: text.slice(last), direction: null });
  return segments.length ? segments : [{ text, direction: null }];
}

/**
 * Classify a text container without changing its source order.
 * Numeric and mathematical blocks are LTR even though they have no Latin
 * strong character. Mixed prose keeps the document direction and isolates
 * only its technical runs.
 */
export function analyzeBidiText(value, options = {}) {
  const text = String(value ?? '');
  const context = options.context ?? 'prose';
  const documentDirection = normalizeDirection(options.documentDirection);
  const hasArabic = ARABIC_LETTER_RE.test(text);
  const hasLatin = LATIN_RE.test(text);
  const hasDigit = DIGIT_RE.test(text);
  const hasStructure = STRUCTURED_RE.test(text);

  let direction;
  if (context === 'code' || context === 'formula') {
    direction = 'ltr';
  } else if (!hasArabic && (hasLatin || hasDigit)) {
    direction = 'ltr';
  } else if (hasArabic && !hasLatin && !hasDigit && !hasStructure) {
    direction = 'rtl';
  } else {
    direction = documentDirection;
  }

  let kind = 'neutral';
  if (context === 'code') kind = 'code';
  else if (context === 'formula' || (!hasArabic && hasDigit && hasStructure)) kind = 'formula';
  else if (hasArabic && (hasLatin || hasDigit || hasStructure)) kind = 'mixed';
  else if (hasArabic) kind = 'rtl-prose';
  else if (hasLatin || hasDigit) kind = 'ltr-text';

  return {
    text,
    direction,
    kind,
    segments: direction === 'ltr'
      ? [{ text, direction: null }]
      : segmentBidiText(text),
    hasSourceControls: BIDI_CONTROL_RE.test(text),
  };
}

/** Build a serializable cover/body text specification. */
export function createBidiSpec(value, options = {}) {
  const analysis = analyzeBidiText(value, options);
  return {
    direction: analysis.direction,
    kind: analysis.kind,
    segments: analysis.segments,
  };
}

/**
 * Browser-safe DOM writer. This function is intentionally self-contained so
 * Puppeteer can serialize it and execute it in the cover page.
 */
export function applyBidiSpecToElement(element, spec) {
  const ownerDocument = element.ownerDocument;
  const fragment = ownerDocument.createDocumentFragment();
  for (const segment of spec.segments) {
    if (!segment.direction) {
      fragment.append(ownerDocument.createTextNode(segment.text));
      continue;
    }
    const isolated = ownerDocument.createElement('bdi');
    isolated.setAttribute('dir', segment.direction);
    isolated.className = 'bidi-isolate';
    isolated.textContent = segment.text;
    fragment.append(isolated);
  }
  element.replaceChildren(fragment);
  element.setAttribute('dir', spec.direction);
  element.setAttribute('data-bidi-kind', spec.kind);
}
