import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import test from 'node:test';
import puppeteer from 'puppeteer';
import {
  analyzeBidiText,
  applyBidiSpecToElement,
  createBidiSpec,
  segmentBidiText,
} from '../src/bidi.mjs';
import { transformReadme } from '../src/transform.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function transformConfig() {
  return {
    metadata: { direction: 'rtl' },
    repository: { url: 'https://github.com/example/book', branch: 'main' },
    images: { classRules: [], tallRatio: 1.4 },
    contentRules: {
      calloutClassRules: [],
      paragraphClassRules: [],
      chapterClassRules: [],
      tableClassRules: [],
      treeAriaLabel: 'Document hierarchy',
    },
    mermaid: {},
    contentRoot: root,
    structure: {
      introHeading: 'مقدمه',
      githubTocHeading: 'فهرست',
      parts: [{ title: 'بخش', startHeading: 'فصل' }],
    },
    toc: { maxDepth: 2 },
  };
}

test('bidi analysis preserves logical order and classifies structured text', () => {
  assert.deepEqual(analyzeBidiText('[2, 6, 512]', {
    context: 'text-fence',
    documentDirection: 'rtl',
  }), {
    text: '[2, 6, 512]',
    direction: 'ltr',
    kind: 'formula',
    segments: [{ text: '[2, 6, 512]', direction: null }],
    hasSourceControls: false,
  });
  assert.equal(analyzeBidiText('-0.05', { documentDirection: 'rtl' }).direction, 'ltr');
  assert.equal(analyzeBidiText('[۲، ۶، ۵۱۲]', { documentDirection: 'rtl' }).direction, 'ltr');
  assert.equal(
    analyzeBidiText('1×1 + 2×0 + 3×2 = 7', { documentDirection: 'rtl' }).direction,
    'ltr',
  );
  assert.deepEqual(segmentBidiText('مجموع = 1.7904'), [
    { text: 'مجموع ', direction: null },
    { text: '= 1.7904', direction: 'ltr' },
  ]);
  assert.deepEqual(segmentBidiText('مهندسی LLM'), [
    { text: 'مهندسی ', direction: null },
    { text: 'LLM', direction: 'ltr' },
  ]);
  assert.deepEqual(segmentBidiText('نسخه (مدل GPT-5 در سال ۲۰۲۶)'), [
    { text: 'نسخه (مدل ', direction: null },
    { text: 'GPT-5', direction: 'ltr' },
    { text: ' در سال ', direction: null },
    { text: '۲۰۲۶', direction: 'ltr' },
    { text: ')', direction: null },
  ]);
  assert.equal(
    segmentBidiText('امروز → [0.21, -0.05, 1.33, ...]').map(({ text }) => text).join(''),
    'امروز → [0.21, -0.05, 1.33, ...]',
  );
  assert.equal(
    analyzeBidiText(`متن${String.fromCodePoint(0x202e)}`, { documentDirection: 'rtl' }).hasSourceControls,
    true,
  );
});

test('text fences distinguish formulas from Persian mixed prose without prompt styling', async () => {
  const result = await transformReadme(`# مقدمه

متن.

# فهرست

- فصل

# فصل

\`\`\`text
[2, 6, 512]
\`\`\`

\`\`\`text
مجموع = 1.7904
\`\`\`

\`\`\`text
امروز → [0.21, -0.05, 1.33, ...]
\`\`\`

\`\`\`text
exp(z - 2.0) = [1.0000, 0.3679]
مجموع        = 1.7904
\`\`\`

\`\`\`
1 + 2 = 3
\`\`\`
`, transformConfig());
  const html = result.chapters.map((chapter) => chapter.html).join('\n');

  assert.match(
    html,
    /<pre class="example example--ltr" dir="ltr" data-bidi-kind="formula">\[2, 6, 512\]<\/pre>/u,
  );
  assert.match(
    html,
    /<pre class="example" dir="rtl" data-bidi-kind="mixed"><span class="bidi-line" dir="rtl" data-bidi-kind="mixed">مجموع <bdi dir="ltr"[^>]*>= 1\.7904<\/bdi><\/span><\/pre>/u,
  );
  assert.match(
    html,
    /<span class="bidi-line" dir="rtl" data-bidi-kind="mixed">امروز → <bdi dir="ltr"[^>]*>\[0\.21, -0\.05, 1\.33, \.\.\.\]<\/bdi><\/span>/u,
  );
  assert.match(
    html,
    /<span class="bidi-line" dir="ltr" data-bidi-kind="formula">exp\(z - 2\.0\) = \[1\.0000, 0\.3679\]<\/span><span class="bidi-line" dir="rtl" data-bidi-kind="mixed">مجموع {8}<bdi dir="ltr"[^>]*>= 1\.7904<\/bdi><\/span>/u,
  );
  assert.doesNotMatch(html, /promptblock|PROMPT/u);
});

test('cover uses semantic RTL layout and isolates only the LLM token', async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: [...(process.env.CI ? ['--no-sandbox'] : [])],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 900, height: 1200 });
    await page.goto(pathToFileURL(resolve(root, 'themes/lapis-rtl/cover.html')).href, {
      waitUntil: 'load',
    });
    const spec = createBidiSpec('مهندسی LLM', {
      context: 'cover',
      documentDirection: 'rtl',
    });
    await page.$eval(
      '[data-readme-press="title-prefix"]',
      applyBidiSpecToElement,
      spec,
    );
    await page.evaluate(() => document.fonts.ready);

    const result = await page.$eval('[data-readme-press="title-prefix"]', (element) => {
      const persian = element.firstChild;
      const latin = element.querySelector('bdi');
      const range = element.ownerDocument.createRange();
      range.selectNode(persian);
      const persianRect = range.getBoundingClientRect();
      const latinRect = latin.getBoundingClientRect();
      return {
        direction: getComputedStyle(element).direction,
        text: element.textContent,
        latin: latin.textContent,
        persianLeft: persianRect.left,
        latinLeft: latinRect.left,
      };
    });

    assert.equal(result.direction, 'rtl');
    assert.equal(result.text, 'مهندسی LLM');
    assert.equal(result.latin, 'LLM');
    assert.ok(
      result.persianLeft > result.latinLeft,
      `expected Persian run to render to the right of LLM: ${JSON.stringify(result)}`,
    );
  } finally {
    await browser.close();
  }
});
