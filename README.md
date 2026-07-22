<p align="center">
  <img src="docs/assets/readme-press-hero.png" alt="A Markdown document passing through a precise typesetting press and becoming two PDF book editions" width="100%">
</p>

<h1 align="center">README Press</h1>

<p align="center">
  <strong>Turn the README you already maintain into a release-ready PDF book.</strong>
</p>

<p align="center">
  <strong>English</strong> · <a href="./README.fa.md">فارسی</a>
</p>

<p align="center">
  <a href="https://github.com/3lf/readme-press/actions/workflows/ci.yml"><img alt="CI status" src="https://github.com/3lf/readme-press/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/3lf/readme-press/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/3lf/readme-press?display_name=tag&sort=semver"></a>
  <a href="./LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-17365D"></a>
  <img alt="Node.js 22 or newer" src="https://img.shields.io/badge/node-%E2%89%A522-17365D">
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#see-the-output">PDF examples</a> ·
  <a href="./action.yml">Action reference</a> ·
  <a href="https://github.com/3lf/readme-press/releases/latest">Latest release</a>
</p>

README Press is for projects where one long Markdown file remains the canonical source. It keeps the source pleasant to read on GitHub while moving page structure, typography, covers, image quality, and release checks into configuration.

Its first production use was a Persian, RTL-first book. That origin shaped the engine's handling of bidirectional text, local fonts, mixed scripts, and page-by-page visual QA. The same pipeline now supports LTR, RTL, and mixed-script books.

## See the output

<p align="center">
  <a href="https://github.com/3lf/readme-press/releases/latest">
    <img src="docs/assets/readme-press-preview.png" alt="Real English and Persian PDF pages built by README Press" width="92%">
  </a>
</p>

<p align="center"><sub>Real pages rendered by the English and Persian integration pipelines, not an illustrative mockup.</sub></p>

| Example | Standard edition | High-quality edition |
|---|---|---|
| English, LTR | [Download PDF](https://github.com/3lf/readme-press/releases/latest/download/readme-press-example.pdf) | [Download PDF](https://github.com/3lf/readme-press/releases/latest/download/readme-press-example-high-quality.pdf) |
| Persian, RTL | [Download PDF](https://github.com/3lf/readme-press/releases/latest/download/readme-press-example-fa.pdf) | [Download PDF](https://github.com/3lf/readme-press/releases/latest/download/readme-press-example-fa-high-quality.pdf) |

## How it works

<table>
  <tr>
    <td width="33%"><strong>1. Keep writing Markdown</strong><br>Your README stays useful on GitHub and remains the only content source.</td>
    <td width="33%"><strong>2. Describe the book</strong><br>A small config defines metadata, chapters, theme, outputs, and project-specific checks.</td>
    <td width="33%"><strong>3. Build, verify, release</strong><br>One pipeline produces both editions, renders every page, and prepares checksums and release notes.</td>
  </tr>
</table>

The built-in pipeline provides:

- GitHub-flavored Markdown with stable GitHub-compatible heading destinations
- configurable introductions, parts, chapters, and table-of-contents depth
- RTL and mixed-script isolation for Persian and other bidirectional documents
- Shiki code highlighting, Mermaid diagrams, local emoji, tables, callouts, and figures
- bookmarks, internal destinations, repository links, QR codes, and artifact footers
- a standard JPEG-optimized edition and a lossless-image high-quality edition from the same source
- PDF checks for geometry, fonts, links, destinations, image fidelity, full-page rendering, and quality parity
- deterministic manifests, SHA-256 checksums, and concise release notes

README Press includes the production `lapis-rtl` theme. Projects can replace its stylesheet, cover, fonts, Mermaid configuration, or add content-specific QA without forking the engine.

## Quick start

Add a manual workflow to the repository that owns the source README:

```yaml
name: Release book

on:
  workflow_dispatch:
    inputs:
      version:
        description: Release version, for example v1.0.0
        required: true
        type: string

jobs:
  book:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v7
      - uses: 3lf/readme-press@v0.1.2
        with:
          command: pipeline
          config: book/readme-press.config.mjs
          release-version: ${{ inputs.version }}
          source-commit: ${{ github.sha }}
          render-all: true
```

Pinning a release tag keeps local and CI builds on the same reviewed engine. The Action installs its locked dependencies, builds both PDF qualities, runs generic and project-specific QA, and prepares release metadata.

## Minimal configuration

Create `readme-press.config.mjs` next to the source README:

```javascript
export default {
  source: "README.md",
  outputDir: "dist",
  metadata: {
    title: "My Book",
    subtitle: "A practical guide",
    author: "Example Author",
    edition: "First edition · 2026",
    language: "en",
    direction: "ltr"
  },
  repository: {
    url: "https://github.com/example/my-book"
  },
  structure: {
    introHeading: "Introduction",
    githubTocHeading: "Contents",
    parts: [
      { title: "Foundations", startHeading: "First chapter" }
    ]
  },
  outputs: {
    normal: "my-book.pdf",
    high: "my-book-high-quality.pdf"
  }
};
```

The source convention is deliberately small: one introduction heading, one hand-written GitHub contents heading, and level-one chapter headings after the contents. The configured start heading for each part controls the printed structure.

## Run locally

README Press is currently distributed as a versioned GitHub Action and a locked source release. Clone the same release tag used by CI:

npm publication is deliberately deferred. A clean downstream npm install does not preserve the root dependency overrides used by the audited Action, so it currently resolves a different PDF toolchain. Use the versioned Action or locked source release until that packaging boundary is fixed.

```bash
git clone --branch v0.1.2 --depth 1 https://github.com/3lf/readme-press.git .readme-press
npm ci --prefix .readme-press
node .readme-press/bin/readme-press.mjs version
```

Build one edition or both:

```bash
node .readme-press/bin/readme-press.mjs build --config readme-press.config.mjs --quality normal
node .readme-press/bin/readme-press.mjs build --config readme-press.config.mjs --quality high
node .readme-press/bin/readme-press.mjs build --config readme-press.config.mjs --quality all
```

System requirements:

- Node.js 22 or newer
- `qpdf` for linearized release PDFs
- Poppler tools for full QA: `pdfinfo`, `pdffonts`, `pdftotext`, `pdfimages`, and `pdftoppm`

Install the PDF tools on Ubuntu with `sudo apt-get install -y poppler-utils qpdf`, or on macOS with `brew install poppler qpdf`.

## Verify and prepare a release

Run the full pipeline for an exact source commit:

```bash
node .readme-press/bin/readme-press.mjs pipeline \
  --config book/readme-press.config.mjs \
  --release-version v1.0.0 \
  --commit FULL_GIT_COMMIT \
  --render-all
```

`--render-all` asks Poppler to rasterize every page of both editions. QA fails on broken rendering, image mismatches, invalid PDF structure, missing links or fonts, different pagination, or project assertions.

Projects can add source-specific checks without changing the engine:

```javascript
export default defineConfig({
  // ...
  qa: {
    script: "book/qa.mjs",
    minPages: 100,
    maxPages: 400,
    fontFamilies: ["Estedad", "Vazirmatn", "JetBrainsMono"],
    extractablePhrases: ["A phrase that must remain searchable"]
  }
});
```

The QA module exports a default function receiving `{ config, manifest, check }`. Keep PDF container and rendering checks in README Press; use the project module for editorial rules, terminology, chapter counts, or pagination contracts.

## Theme contract

Select a custom theme and cover in configuration:

```javascript
theme: {
  directory: "book/theme",
  stylesheet: "book.css"
},
cover: {
  file: "book/theme/cover.html"
}
```

The theme directory may contain fonts, `mermaid.config.json`, and `puppeteer-ci.json`. A cover must expose a `.cover` element. Optional `data-readme-press` fields let the engine inject the series, title, subtitle, author, dates, repository note, and repository URL.

The bundled theme includes Estedad, Vazirmatn, and JetBrains Mono under the SIL Open Font License. README Press itself is released under the [MIT License](./LICENSE).

## Development

```bash
npm ci
npm test
npm run test:syntax
npm run test:action
npm run test:integration
npm run pack:check
npm audit --audit-level=low
go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.7 .github/workflows/ci.yml .github/workflows/release.yml
```

The integration suite builds and fully renders normal and high-quality English and Persian fixtures, checks their PDF containers and links, compares lossless image pixels, and validates release metadata.
