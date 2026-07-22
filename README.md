# README Press

README Press turns a long Markdown README into a professionally typeset, release-ready PDF book.

It is designed for repositories where the README remains the canonical source. Print structure, typography, covers, output quality, and release checks live in configuration instead of leaking into the Markdown.

## What it provides

- GitHub-flavored Markdown parsing with stable GitHub-compatible heading destinations
- configurable introductions, parts, chapters, and curated table-of-contents depth
- right-to-left and mixed-script isolation for Persian and other RTL books
- Shiki syntax highlighting, Mermaid rendering, local emoji assets, tables, callouts, and figures
- a tagged and searchable Vivliostyle body with a raster-safe 300 DPI cover
- bookmarks, internal destinations, repository links, QR codes, and artifact footers
- normal JPEG-optimized and high-quality lossless-PNG output variants from one source
- generic PDF QA for geometry, fonts, links, destinations, image fidelity, full-page rendering, and quality parity
- deterministic release manifests, SHA-256 checksums, and release notes

README Press ships one production theme, `lapis-rtl`. A project can also provide its own stylesheet, cover, fonts, Mermaid configuration, and content-specific QA module.

## Requirements

- Node.js 22 or newer
- `qpdf` for linearized release PDFs
- Poppler tools for full QA: `pdfinfo`, `pdffonts`, `pdftotext`, `pdfimages`, and `pdftoppm`

On Ubuntu:

```bash
sudo apt-get update
sudo apt-get install -y poppler-utils qpdf
```

On macOS:

```bash
brew install poppler qpdf
```

## Use the versioned GitHub Action

Pin the public release tag in a manual workflow:

```yaml
jobs:
  book:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v7

      - name: Build and fully verify both PDF qualities
        uses: 3lf/readme-press@v0.1.0
        with:
          command: pipeline
          config: book/readme-press.config.mjs
          release-version: v1.0.0
          source-commit: ${{ github.sha }}
          render-all: true
```

The action installs the engine from its own audited lockfile, builds both variants, renders every page, runs generic and project-specific QA, and prepares checksums plus release notes.

## Run locally

Clone the same release tag so local and CI builds use the same engine and lockfile:

```bash
git clone --branch v0.1.0 --depth 1 https://github.com/3lf/readme-press.git .readme-press
npm ci --prefix .readme-press
node .readme-press/bin/readme-press.mjs version
```

Then run the CLI from the consumer repository:

```bash
node .readme-press/bin/readme-press.mjs build \
  --config book/readme-press.config.mjs \
  --quality all
```

README Press v0.1.x is distributed as a GitHub Action and a locked source release. npm registry publication is intentionally deferred until its PDF toolchain can preserve the same audited dependency graph in downstream npm installs.

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

The source convention is intentionally small:

1. One level-one introduction heading
2. One level-one hand-written GitHub contents heading
3. Level-one chapter headings after the contents
4. A configured chapter heading that starts each part

## Build

```bash
npx readme-press build --config readme-press.config.mjs --quality normal
npx readme-press build --config readme-press.config.mjs --quality high
npx readme-press build --config readme-press.config.mjs --quality all
```

For an exact release candidate:

```bash
npx readme-press build \
  --config readme-press.config.mjs \
  --quality all \
  --release-version v1.0.0
```

The release version is written to the colophon, PDF metadata, and `manifest.json`.

To build both variants, run full QA, and prepare the release metadata in one command:

```bash
node .readme-press/bin/readme-press.mjs pipeline \
  --config book/readme-press.config.mjs \
  --release-version v1.0.0 \
  --commit FULL_GIT_COMMIT \
  --render-all
```

## Verify

```bash
npx readme-press qa \
  --config readme-press.config.mjs \
  --quality all \
  --release-version v1.0.0 \
  --render-all
```

`--render-all` asks Poppler to rasterize every page of every requested variant. QA fails if page rendering, lossless image matching, PDF structure, variant parity, links, fonts, or configured project assertions fail.

Projects can add source-specific checks without forking the engine:

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

The QA module exports a default function receiving `{ config, manifest, check }`. Use it for editorial rules, terminology, exact chapter counts, or project-specific pagination hooks. Keep PDF container and rendering checks in README Press.

## Prepare release artifacts

```bash
npx readme-press release validate v1.0.0
npx readme-press release prepare \
  --config readme-press.config.mjs \
  --version v1.0.0 \
  --commit FULL_GIT_COMMIT
```

This verifies both outputs against their manifest entries and creates:

- `SHA256SUMS.txt`
- `release-notes.md`

The release helper rejects malformed versions, mismatched source commits, missing files, changed hashes, and quality variants with different page counts.

## Theme contract

A custom theme directory can be selected with:

```javascript
theme: {
  directory: "book/theme",
  stylesheet: "book.css"
},
cover: {
  file: "book/theme/cover.html"
}
```

The directory may contain `fonts/`, `mermaid.config.json`, and `puppeteer-ci.json`. The cover must expose a `.cover` element. Optional `data-readme-press` fields let the engine inject metadata:

- `series`
- `title-prefix`
- `title`
- `tagline`
- `author`
- `date-local`
- `date-latin`
- `repository-note`
- `repository`

## Included font licenses

The built-in `lapis-rtl` theme includes Estedad, Vazirmatn, and JetBrains Mono. Their SIL Open Font License texts are stored under `themes/lapis-rtl/licenses/`. README Press itself is released under the MIT License.

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

The integration fixture builds both quality variants, validates the release metadata, compares lossless image pixels, renders every page with Poppler, and checks the resulting PDF containers.
