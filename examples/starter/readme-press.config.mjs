export default {
  source: 'README.md',
  outputDir: 'dist',
  metadata: {
    title: 'The Starter Book',
    subtitle: 'One Markdown source, three PDF editions',
    author: 'Example Author',
    edition: 'First edition',
    language: 'en',
    direction: 'ltr',
  },
  repository: {
    // Replace this example URL with your book repository before sharing a PDF.
    url: 'https://github.com/3lf/readme-press',
  },
  structure: {
    introHeading: 'Introduction',
    githubTocHeading: 'Contents',
    parts: [{ title: 'Getting started', startHeading: 'The first chapter' }],
  },
  outputs: {
    normal: 'starter-book.pdf',
    print: 'starter-book-print.pdf',
    high: 'starter-book-high-quality.pdf',
  },
};
