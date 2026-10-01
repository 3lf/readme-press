# README Press 0.4.0 production acceptance

Local release acceptance: **PASS** for the pinned production benchmark below.
Exact-head CI and staged-package byte verification are separate publication gates.

## Inputs and method

- Book repository: `3lf/llm-for-humans`, clean source commit
  `4b3958fefeb1b6d626f6ae4899353affa29873ea`.
- Canonical README SHA-256:
  `5db86732fdf5396b9fd5f7420d9fca5e3bcf4ad275c62a9d0053dd0312265520`.
- Published renderer baseline: README Press `v0.3.0`, commit
  `3d30cf6ae471099045ebedaccb45752a531485ef`.
- Candidate: an immutable source export of prepared Git input tree
  `bacb502bf8982d2d2136d2303afe67ad2d389dd4`, version `0.4.0`. The 108
  exported source-file hashes are bound to release-preparation commit
  [`2fcf78808cc72468d49d2249fbb1bb34a98ee8d3`](https://github.com/3lf/readme-press/commit/2fcf78808cc72468d49d2249fbb1bb34a98ee8d3),
  whose Git tree is identical to the tested input tree. Evidence-only files do
  not change renderer inputs or npm contents.
- Previously accepted renderer reference:
  `f5d97be3d2166225eb4a31fc8df0e8516b54f14f`, using its retained all-page hashes.
  This is a historical reference, not a claim of a fresh rebuild of that engine.
- Toolchain: Node.js `22.22.3`, Chrome for Testing `152.0.7977.54`, Poppler
  `26.03.0`, qpdf `12.3.2`, unchanged bundled fonts, full-page PNGs at **96 DPI**.
- Both rebuilt books use the unchanged committed config. Its effective security
  settings are `rawHtml: safe`, `network: deny`, `diagnostics: strict`, and
  `strictConfig: true`; no trusted-mode overlay was applied.

The published baseline and candidate were freshly built and QA-checked in all
three editions using the explicit respective engine CLI. Both passed **306/306**
production checks, including all-page rendering, PDF/container/geometry,
embedded fonts, images, links, destinations, bookmarks, source contracts, and
cross-edition text-box alignment. All six PDFs passed `qpdf --check`.
Both manifests have zero transform diagnostics and zero external requests in
every edition.

## All-page comparison

All **1,590 baseline and candidate pages** were independently rasterized and
hashed. The [795-row comparison](./page-hashes-96dpi.tsv) includes the current
baseline, candidate, and previously accepted reference hash for every page.
A `none` bounding box denotes no changed pixels. Its SHA-256 is
`5ed335981af8c80c42da335c5617d78797b400d7c0ccf41f5b4cdc880f4c8039`.

| Edition | Baseline pages | Candidate pages | Changed vs published baseline | Body pages equal accepted reference |
| --- | ---: | ---: | ---: | ---: |
| Normal | 265 | 265 | 61 | 264/264 |
| Print | 265 | 265 | 60 | 264/264 |
| High | 265 | 265 | 61 | 264/264 |

The freshly rebuilt baseline matches its retained historical hashes **795/795**.
Every candidate body page matches the previously accepted renderer reference
exactly: **792/792**. The body differences from the published renderer are the
previously reviewed locale/bidi repairs and pagination reflow, not additional
layout changes from release preparation or the dependency patch.

The three covers are the only candidate pages that differ from the accepted
reference hashes. Normal and high now match the published baseline cover
exactly. The print cover differs from the published and accepted print cover
in **four pixels**, each with one changed color channel and a maximum channel
difference of **one**. Inspection of all three cover pairs found identical text,
figures, placement, dates, and palette; this tiny raster variation is visually
imperceptible. This release does not claim hash equality with the old renderer.

Fresh visual review covered all three covers and the targeted source/math/code
pages 34, 77, 83, and 106 in every edition, with additional range checks on pages
46 and 256. Print retains white paper and interior panels; normal/high retain
their color palette. No new clipping or material layout regression was found
in these samples. Automated all-page hashing and the accepted body-page
equivalence supplement this selected-page visual review; they are not a claim
that every page received a new manual visual inspection.

## Source order, security, and limits

A fresh 32-case source-selected extraction probe reports **27 exact raw-text
matches and five visual-review cases per edition**. The matched cases include
slash tokens, paths, clock times, function/assignment examples, currency, and
the source ranges `۲-۳` and `۳-۴`. This selection is different from the historical
32-case probe and is not represented as that earlier result.

Four whole Persian arithmetic expressions extract in physical RTL order rather
than verbatim source order; visual review confirms their operands and operators
remain present and readable. The mixed Persian/Python docstring at source line
2824 still displays `15 * 3.14` as `3.14 * 15` on PDF page 106. Page 83 also retains
the visibly split `Let's think step by step` phrase. These two mixed-script
ordering limitations are inherited from the published/previously accepted
renderers; page 106 matches the published baseline and all candidate body pages
match the accepted reference. This report does not claim perfect bidi, complete
copy fidelity, screen-reader conformance, or PDF/UA compliance. The cover title
is rasterized rather than ordinary searchable page text.

Release preparation updates only transitive DOMPurify **3.4.13 to 3.4.16** for
[GHSA-p98j-92pf-mc4p](https://github.com/advisories/GHSA-p98j-92pf-mc4p).
Only that lock entry's version, resolved URL, and integrity changed; parent
constraints and all other resolved packages remain unchanged. The historical
baseline keeps its original dependency graph. No exploitation claim is made.

The patched candidate passed `npm run verify:publish`: 86 source tests including
browser security, syntax, Action/type contracts, compatibility, nine fixture
PDFs and full QA, four freshness regressions, clean packed-package API/type
installation, six consumer/starter PDFs, package inventory, and audits with
**zero vulnerabilities**. Pinned actionlint `v1.7.7` passed. The inspected npm
artifact was packed with npm **11.18.0** and has **70 files**, **2,149,766 bytes**,
and integrity:

`sha512-Ce/DIb33lxZPgwGmlxCZ1kgFddTUJEqAen6xL+1WZjSa5WQt/Dy88WHcq6nPNkvruWDfr0Xhu9IB+/tdi7mL6w==`

Before human npm approval, the actual staging JSON must match this inspected
artifact's full integrity and file inventory after the exact final-main source
binding. These QA documents are excluded by the existing npm files whitelist.
No production-book release or deployment is part of this acceptance.
