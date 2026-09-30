import { defineConfig } from '../../../src/config.mjs';

export default defineConfig({
  source: 'README.md',
  outputDir: 'dist-test',
  metadata: {
    title: 'Layout stress book',
    subtitle: 'A compact pagination fixture',
    author: 'README Press',
    edition: 'Test edition · 2026',
    language: 'en',
    direction: 'ltr',
  },
  repository: { url: 'https://github.com/3lf/readme-press' },
  structure: {
    introHeading: 'Introduction',
    githubTocHeading: 'Contents',
    parts: [
      {
        title: 'Constructing the book',
        startHeading: 'From source to pages when one README becomes a book',
      },
      {
        title: 'Checking the output',
        startHeading: 'Checking rendered editions',
      },
    ],
  },
  toc: { maxDepth: 3 },
  outputs: {
    normal: 'stress-book.pdf',
    print: 'stress-book-print.pdf',
    high: 'stress-book-high-quality.pdf',
  },
  qa: {
    minPages: 12,
    maxPages: 18,
    minimumDestinations: 18,
    fontFamilies: ['Vazirmatn', 'JetBrainsMono'],
    extractablePhrases: [
      'From source to pages',
      'A long heading tests line wrapping',
      'Checking rendered editions',
      'The same content runs through',
    ],
    expectedLinks: [
      'https://github.com/3lf/readme-press',
      'https://example.org/specification',
    ],
  },
});
