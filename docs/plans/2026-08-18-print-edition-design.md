# Print edition design

## Goal

Add an ink-efficient PDF edition to README Press and use it for LLM for Humans without changing the existing standard or high-quality editions. The print edition keeps diagrams and figures in color, uses lossless source images, and removes colored page and decorative backgrounds.

## User-facing result

LLM for Humans will offer three release assets:

- Standard: compact PDF for reading and sharing.
- Print: lossless figures on white page and component backgrounds.
- High quality: the existing full-color, lossless archival edition.

The project README will place a large direct-download control for the latest standard PDF immediately below the preview. A three-column edition table will make the standard, print, and high-quality choices explicit.

## README Press architecture

`outputs.print` is optional. Projects that do not configure it keep the current two-output behavior. Projects that do configure it can request `--quality print`; `--quality all` builds all configured editions.

The print variant shares the high-quality edition's source-PNG image mode. It receives a variant marker in both the body and cover render paths. The bundled `lapis-rtl` theme uses that marker to apply a print palette and targeted overrides:

- white page, cover, surface, table, callout, and code backgrounds;
- dark readable text and syntax tokens;
- restrained colored borders and small accents;
- unchanged layout, spacing, fonts, content, links, and figure colors.

The print cover is rendered separately because the existing cover is a full-page dark raster image. Standard and high-quality editions continue to share the existing cover.

## Manifest and release contract

The manifest records `print` like every other output, including its image mode, file name, page count, size, checksum, links, destinations, and geometry. Release preparation discovers configured outputs instead of assuming exactly two files. Release copy can provide `printPurpose`, and checksums include all release PDFs.

This is backward compatible: an existing manifest with only `normal` and `high` remains valid, and existing configuration defaults do not gain a surprise third artifact.

## LLM for Humans integration

The book configuration adds `llm-for-humans-book-print.pdf`. Both GitHub Actions workflows build and verify all three configured editions. The release workflow uploads and attaches the print PDF and uses wording that no longer describes the high-quality edition as the printing choice.

Project QA checks that:

- print uses all source PNG figures;
- normal remains smaller than the lossless editions;
- every configured output retains stable pagination and footer placement;
- release metadata and checksums cover all three files.

The README's primary latest-download control points to the stable standard filename under GitHub's `/releases/latest/download/` route. The edition table provides direct stable links for all three assets.

## Verification

README Press unit, fixture, CLI, package-smoke, release, and QA tests cover optional and configured print outputs. Cross-edition checks compare page count, geometry, annotations, destinations, and extracted text boxes.

The rendered print artifact is also checked visually and programmatically:

- page backgrounds and large component backgrounds are white;
- the print cover has no full-page dark fill;
- colored figure pixels remain present;
- all pages render successfully;
- `qpdf --check`, fonts, outlines, links, and destinations pass.

LLM for Humans then runs its metadata tests, source QA, workflow syntax validation, a full three-edition build, project QA, and representative rendered-page inspection.

## Delivery sequence

1. Implement and verify the reusable engine change on `readme-press/feat/print-edition`.
2. Integrate and verify the book and README change on `llm-for-humans/feat/print-book-download` using the local engine during development.
3. Before merging the project workflow update, release or pin a verified immutable README Press revision; do not leave production workflows on a mutable feature branch.
