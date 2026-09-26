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
  assert.deepEqual(segmentBidiText('$30.00'), [
    { text: '$30.00', direction: 'ltr' },
  ]);
  assert.deepEqual(segmentBidiText('ساعت ۸:۱۵ و ۹:۴۵؛ جواب ۱۴:۱۵'), [
    { text: 'ساعت ', direction: null },
    { text: '۸:۱۵', direction: 'ltr' },
    { text: ' و ', direction: null },
    { text: '۹:۴۵', direction: 'ltr' },
    { text: '؛ جواب ', direction: null },
    { text: '۱۴:۱۵', direction: 'ltr' },
  ]);
  assert.deepEqual(segmentBidiText('ساعت 9:45 و 14:15'), [
    { text: 'ساعت ', direction: null },
    { text: '9:45', direction: 'ltr' },
    { text: ' و ', direction: null },
    { text: '14:15', direction: 'ltr' },
  ]);
  assert.deepEqual(segmentBidiText('با temperature=0.7 پرسیده می‌شود'), [
    { text: 'با ', direction: null },
    { text: 'temperature=0.7', direction: 'ltr' },
    { text: ' پرسیده می‌شود', direction: null },
  ]);
  assert.deepEqual(segmentBidiText('تابع len(numbers) و get_price("BTC")'), [
    { text: 'تابع ', direction: null },
    { text: 'len(numbers)', direction: 'ltr' },
    { text: ' و ', direction: null },
    { text: 'get_price("BTC")', direction: 'ltr' },
  ]);
  assert.deepEqual(segmentBidiText('مسیر /legacy را باز کن'), [
    { text: 'مسیر ', direction: null },
    { text: '/legacy', direction: 'ltr' },
    { text: ' را باز کن', direction: null },
  ]);
  assert.deepEqual(segmentBidiText('به پوشه legacy/ دست نزن'), [
    { text: 'به پوشه ', direction: null },
    { text: 'legacy/', direction: 'ltr' },
    { text: ' دست نزن', direction: null },
  ]);
  for (const token of [
    'https://example.com/path',
    '/legacy/v1',
    'legacy/',
    '--quality=print',
    'v1.2.3',
    '$30.00',
    'get_price("BTC")',
    'temperature=0.7',
    '۱۴:۱۵',
  ]) {
    assert.deepEqual(segmentBidiText(`متن ${token} متن`), [
      { text: 'متن ', direction: null },
      { text: token, direction: 'ltr' },
      { text: ' متن', direction: null },
    ], `technical token must remain in one directional isolate: ${token}`);
  }
  for (const [persian, latin] of [
    ['نقش', 'Context'],
    ['اپ', 'IDE'],
    ['وب', 'PDF/RAG'],
    ['جست‌وجو', 'RAG'],
    ['روتینگ', 'Auto'],
    ['نقش', 'GPT-5'],
  ]) {
    assert.deepEqual(segmentBidiText(`${persian}/${latin}`), [
      { text: `${persian}/${latin}`, direction: null },
    ], `slash must stay at the authored Persian/Latin boundary: ${persian}/${latin}`);
  }
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

test('currency keeps its prefix in RTL table cells and highlighted output comments', async () => {
  const markdown = `# مقدمه\n\nمتن.\n\n# فهرست\n\n- فصل\n\n# فصل\n\n| مدل | هزینه |\n|-----|-------|\n| نمونه | $30.00 |\n\n\`\`\`python\n# خروجی: ورودی: $0.0050 | کل: $0.0200\n\`\`\`\n`;
  const result = await transformReadme(markdown, transformConfig());
  const html = result.chapters.map((chapter) => chapter.html).join('\n');

  assert.match(html, /<td><bdi dir="ltr"[^>]*>\$30\.00<\/bdi><\/td>/u);
  assert.match(html, /<bdi dir="ltr"[^>]*>\$0\.0050<\/bdi>/u);
  assert.match(html, /<bdi dir="ltr"[^>]*>\$0\.0200<\/bdi>/u);
});

test('Persian time and assignment tokens remain intact in examples, prose, and tables', async () => {
  const markdown = `# مقدمه\n\nمتن.\n\n# فهرست\n\n- فصل\n\n# فصل\n\nساعت ۹:۴۵ تا ۱۴:۱۵ و temperature=0.7. تابع len(numbers) را ببینید و پوشه legacy/ را باز کنید.\n\n| ساعت | تنظیم |\n|------|-------|\n| ۱۳:۳۰ | temperature=0.7 |\n\n\`\`\`text\nساعت ۸:۱۵ و ۹:۴۵ یعنی ۱۴:۱۵؛ گاهی ۱۲:۴۵.\nبا temperature=0.7 پرسیده می‌شود.\n۳ * ۱۲۰۰۰ = ۳۶۰۰۰ تومان\n۶ / ۲ = ۳\nابزار get_exchange_rate("USD") را صدا می‌زند.\n- به پوشه \`legacy/\` دست نزن\n\`\`\`\n`;
  const result = await transformReadme(markdown, transformConfig());
  const html = result.chapters.map((chapter) => chapter.html).join('\n');

  for (const token of ['۹:۴۵', '۱۴:۱۵', '۱۳:۳۰', 'temperature=0.7', 'len(numbers)', 'legacy/']) {
    const occurrences = html.match(new RegExp(`<bdi dir="ltr"[^>]*>${token.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}<\\/bdi>`, 'gu')) ?? [];
    assert.ok(occurrences.length > 0, `expected isolated ${token} in transformed HTML`);
  }
  for (const line of [
    'ساعت ۸:۱۵ و ۹:۴۵ یعنی ۱۴:۱۵؛ گاهی ۱۲:۴۵.',
    'با temperature=0.7 پرسیده می‌شود.',
    '۳ * ۱۲۰۰۰ = ۳۶۰۰۰ تومان',
    '۶ / ۲ = ۳',
    'ابزار get_exchange_rate("USD") را صدا می‌زند.',
  ]) {
    assert.ok(html.includes(`>${line}</span>`), `expected intact RTL example line: ${line}`);
  }
  assert.match(html, /<span class="bidi-line" dir="rtl"[^>]*>- به پوشه <bdi dir="ltr"[^>]*>`legacy\/`<\/bdi> دست نزن<\/span>/u);
  assert.match(html, /<td><bdi dir="ltr"[^>]*>۱۳:۳۰<\/bdi><\/td>/u);
  assert.match(html, /<td><bdi dir="ltr"[^>]*>temperature=0\.7<\/bdi><\/td>/u);
  assert.doesNotMatch(html, /<bdi[^>]*>۹<\/bdi>:<bdi[^>]*>۴۵<\/bdi>/u);
});

test('authored slashes stay between Persian and Latin runs in rendered prose', async () => {
  const markdown = `# مقدمه\n\nمتن.\n\n# فهرست\n\n- فصل\n\n# فصل\n\n1. **نقش/Context:** مثال.\n\nهر اپ/IDE یک مسیر دارد.\n\n- داده وب/PDF/RAG وارد می‌شود.\n- جست‌وجو/RAG برای دانش روز است.\n\nحالت روتینگ/Auto فعال است.\n`;
  const result = await transformReadme(markdown, transformConfig());
  const html = result.chapters.map((chapter) => chapter.html).join('\n');

  for (const [persian, latin] of [
    ['نقش', 'Context'],
    ['اپ', 'IDE'],
    ['وب', 'PDF/RAG'],
    ['جست‌وجو', 'RAG'],
    ['روتینگ', 'Auto'],
  ]) {
    assert.ok(html.includes(`${persian}/${latin}`), `expected intact authored boundary: ${persian}/${latin}`);
    assert.doesNotMatch(html, new RegExp(`${persian}/<bdi dir="ltr"[^>]*>${latin}<\\/bdi>`, 'u'));
  }
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
    /<pre class="example" dir="rtl" data-bidi-kind="mixed"><span class="bidi-line" dir="rtl" data-bidi-kind="mixed">مجموع = 1\.7904<\/span><\/pre>/u,
  );
  assert.match(
    html,
    /<span class="bidi-line" dir="rtl" data-bidi-kind="mixed">امروز → \[0\.21, -0\.05, 1\.33, \.\.\.\]<\/span>/u,
  );
  assert.match(
    html,
    /<span class="bidi-line" dir="ltr" data-bidi-kind="formula">exp\(z - 2\.0\) = \[1\.0000, 0\.3679\]<\/span><span class="bidi-line" dir="rtl" data-bidi-kind="mixed">مجموع {8}= 1\.7904<\/span>/u,
  );
  assert.doesNotMatch(html, /promptblock|PROMPT/u);
});

test('English prose in a text fence keeps prompt treatment even when later lines contain numbers', async () => {
  const markdown = `# مقدمه\n\nمتن.\n\n# فهرست\n\n- فصل\n\n# فصل\n\n\`\`\`text\nYou are an expert prompt engineer. Write a detailed system prompt for this task.\n1. Include three examples.\n2. Check the result.\n\`\`\`\n\n\`\`\`text\nexp(z - 2.0) = [1.0000, 0.3679]\n\`\`\`\n\n\`\`\`text\nx = y\n\`\`\`\n`;
  const result = await transformReadme(markdown, transformConfig());
  const html = result.chapters.map((chapter) => chapter.html).join('\n');

  assert.match(html, /<div class="promptblock" dir="ltr" data-bidi-kind="formula"><pre>You are an expert prompt engineer/u);
  assert.match(html, /<pre class="example example--ltr" dir="ltr" data-bidi-kind="formula">exp\(z - 2\.0\)/u);
  assert.match(html, /<pre class="example example--ltr" dir="ltr" data-bidi-kind="ltr-text">x = y<\/pre>/u);
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
    await page.$eval(
      '[data-readme-press="series"]',
      applyBidiSpecToElement,
      createBidiSpec('کتاب‌های README Press', {
        context: 'cover',
        documentDirection: 'rtl',
      }),
    );
    await page.evaluate(() => document.fonts.ready);

    const series = await page.$eval('.series', (element) => ({
      text: element.textContent,
      height: element.getBoundingClientRect().height,
      childCount: element.children.length,
    }));
    assert.equal(series.text, 'کتاب‌های README Press');
    assert.equal(series.childCount, 1);
    assert.ok(series.height < 30, `expected a single series line: ${JSON.stringify(series)}`);

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
