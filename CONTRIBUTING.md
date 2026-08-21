# Contributing to README Press

Thanks for helping improve README Press. Changes should keep the command-line,
library, GitHub Action, npm package, and generated PDFs in agreement.

## Development environment

Use an active supported Node.js LTS release: Node.js 22 or Node.js 24. Node.js
22 is the canonical rendering and release environment so visual baselines stay
stable; CI also runs the source and public API contracts on Node.js 24.

Install the external PDF tools before running the artifact tests:

```bash
# Ubuntu
sudo apt-get install -y poppler-utils qpdf

# macOS
brew install poppler qpdf
```

Install the locked dependency tree with `npm ci`. Do not edit
`npm-shrinkwrap.json` by hand.

## Making a change

1. Create a focused branch such as `fix/...`, `feat/...`, `harden/...`,
   `docs/...`, or `chore/...`.
2. Add or update the closest regression test with the implementation.
3. Run `npm run verify:source` while iterating.
4. Run `npm run verify:publish` before requesting final review.
5. Keep generated fixture output, caches, tarballs, and consumer artifacts out
   of commits.

Use small commits with imperative English subjects. Pull requests should state
the compatibility impact, security impact, tests run, and whether PDF rendering
is expected to change.

## Verification commands

| Command | Contract |
|---|---|
| `npm run verify:source` | Syntax, composite Action schema, unit/security/API tests, and TypeScript declarations |
| `npm run verify:artifacts` | English/Persian PDF integration, installed tarball smoke test, package inventory, and dependency audit |
| `npm run verify:publish` | The complete local publication gate |
| `go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.7 .github/workflows/*.yml` | Workflow expression and shell validation |

The full rationale and release-specific visual gates are documented in
[the testing strategy](./docs/testing.md).

## Security reports

Do not open a public issue for an undisclosed vulnerability. Follow the private
reporting instructions in [SECURITY.md](./SECURITY.md).
