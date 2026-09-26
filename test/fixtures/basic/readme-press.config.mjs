import { defineConfig } from '../../../src/config.mjs';

export default defineConfig({
  source: 'README.md',
  outputDir: 'dist-test',
  metadata: {
    title: 'Press',
    titlePrefix: 'README',
    subtitle: 'A tested Markdown-to-book pipeline',
    tagline: 'Turn Markdown into a professionally typeset book',
    author: 'README Press',
    edition: 'First edition · 2026',
    localDate: 'First edition',
    latinDate: '2026',
    language: 'en',
    direction: 'ltr',
    license: 'MIT',
  },
  repository: {
    url: 'https://github.com/3lf/readme-press',
  },
  structure: {
    introHeading: 'Introduction',
    githubTocHeading: 'Contents',
    parts: [
      { title: 'Production pipeline', startHeading: 'Building a reliable book' },
    ],
  },
  toc: { maxDepth: 2 },
  outputs: {
    normal: 'fixture-book.pdf',
    print: 'fixture-book-print.pdf',
    high: 'fixture-book-high-quality.pdf',
  },
  qa: {
    minPages: 3,
    maxPages: 12,
    minimumDestinations: 4,
    fontFamilies: ['Vazirmatn', 'JetBrainsMono'],
    extractablePhrases: [
      'README Press',
      'Introduction',
      'Building a reliable book',
      'Test the artifact, not only the source',
    ],
    expectedLinks: ['https://github.com/3lf/readme-press'],
  },
});
