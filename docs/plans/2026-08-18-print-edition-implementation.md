# Print edition implementation plan

## 1. Extend the configuration and CLI contract

Update `src/config.mjs`, `src/build.mjs`, the CLI help, and unit tests so `outputs.print` is optional, `--quality print` is accepted only when configured, and `--quality all` builds every configured output. Preserve the current normal/high defaults and error messages for existing projects.

## 2. Build a distinct print artifact

Add the print variant to `src/build.mjs`. Reuse source PNG figures, emit distinct HTML/body PDF/final PDF paths, mark the body HTML as the print variant, and render a separate print cover. Keep shared transformation and asset work single-pass.

Update `src/template.mjs` and `src/cover.mjs` to expose a stable variant marker without changing document content or layout.

## 3. Add the ink-efficient lapis theme

Update the bundled body and cover theme files with print-specific overrides. Make paper and large decorative/component fills white, convert dark code panels to white, retain dark readable text and restrained accents, and leave figure pixels untouched.

## 4. Generalize QA and releases

Update `src/qa.mjs` to validate every configured output and compare all variants against the normal baseline for page count, geometry, annotations, destinations, and text boxes.

Update `src/release.mjs` so it discovers manifest outputs, verifies each file, writes checksums for all of them, and renders a release table that includes an optional print purpose. Keep two-output manifests compatible.

Add print-background and preserved-color assertions using rendered fixture pages. Extend fixtures and package-smoke expectations to cover both a legacy two-output project and a print-enabled project.

## 5. Document and verify README Press

Update English and Persian documentation, action input help, examples, and package tests. Run syntax checks, unit tests, integration builds, release preparation, rendered-page QA, package smoke tests, and the full publish verification gate.

Commit the verified engine implementation. Use that immutable commit in the LLM for Humans feature branch during review; replace it with the eventual stable release tag before merging if a new README Press release is published.

## 6. Integrate LLM for Humans

On `feat/print-book-download`:

- configure `llm-for-humans-book-print.pdf`;
- update project QA for the print HTML and lossless figure inventory;
- update build/release workflows to upload, checksum, and attach all three PDFs;
- revise release copy and `book/README.md`;
- add a prominent local SVG latest-download control and a clear three-edition table at the top of the root README.

## 7. Verify the complete book

Run metadata tests, source QA, action workflow syntax checks, and a local full build through the updated engine. Run README Press QA plus project QA, `qpdf --check`, checksum verification, all-page rendering, white-background analysis, color-figure analysis, and visual inspection of representative cover, TOC, chapter, code, callout, table, and figure pages.
