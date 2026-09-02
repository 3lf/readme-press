# Testing strategy

README Press treats the CLI, public JavaScript API, npm tarball, GitHub Action,
and generated PDFs as one release contract. A change is complete only when the
relevant layers below pass.

## Supported Node.js versions

- Node.js 22 is the canonical build, PDF rendering, package, and release
  environment.
- Node.js 24 runs the syntax, unit, security, runtime API, and TypeScript
  compatibility suite in CI.
- Unsupported odd-numbered or future major releases are not part of the tested
  contract.

Keeping PDF regression renders on one Node/Chromium toolchain prevents runtime
upgrades from being mistaken for product layout changes.

## Verification layers

### Source contracts

`npm run verify:source` checks JavaScript syntax, the composite Action schema,
unit and security behaviour, runtime exports, CLI errors, and TypeScript
declarations. Security coverage includes path traversal, absolute and
Windows-style paths, symlink escapes, raw HTML modes, dangerous URLs, network
requests, output containment, failed publication, and manifest-owned cleanup.

### Artifact contracts

`npm run verify:artifacts` builds English LTR and Persian RTL fixtures in
normal, print, and high-quality editions. QA inspects PDF containers, page
geometry, fonts, searchable text, links, named destinations, bookmarks,
lossless figures, print backgrounds, and cross-edition text alignment.

The package smoke test packs the exact npm artifact, installs it into an empty
project, imports the runtime API, compiles a strict TypeScript consumer, audits
the installed dependency tree, and builds and verifies all three editions with
the installed CLI.

### Workflow contracts

`action-validator` checks `action.yml`. `actionlint` checks workflow syntax,
expressions, and embedded shell. CI then invokes the repository's composite
Action against both integration fixtures so the published Action entrypoint is
covered in addition to direct CLI execution.

### Release visual regression

This is a manual, owner-supplied release gate. Repository automation does not
currently create or approve the production-book baseline. Before approving a
renderer or security release, the owner must build the current production book and its
approved baseline from clean, temporary source archives with the same Node,
Chromium, Poppler, fonts, and raster DPI. Compare every rasterized page by
cryptographic hash. When a milestone declares no visual change, every page in
normal, print, and high-quality editions must match exactly.

Also require zero unexpected external network requests, zero sanitizer or
transform diagnostics in safe mode, `qpdf --check` success, and a clean
`npm audit --audit-level=low` result.

## Pull request evidence

Pull requests should list the exact commands run and summarize artifact counts.
Do not commit generated PDFs or caches. Release pull requests must additionally
record the source tag and commit used for the real-book baseline and candidate,
and attach or link the all-page hash comparison result. A green CI run does not
substitute for this manual evidence.
