# Programmatic API

README Press is an ESM package for Node.js 22 or newer. The package root exposes the build, QA, release, transform, validation, and error contracts. The `readme-press/config` entry point exposes the config helper, loader, and validator without requiring consumers to import the rest of the API.

```js
import { runBuild, validateConfig, ReadmePressError } from 'readme-press';
import { defineConfig } from 'readme-press/config';
```

## Configuration

`defineConfig(config)` is an identity helper with TypeScript inference. `validateConfig(value, { strict })` validates the exported object with Zod and returns `{ config, diagnostics }`. Unknown core keys produce `UNKNOWN_CONFIG_KEY` warnings when `strict` is false and `ERR_CONFIG_UNKNOWN_KEYS` when it is true. The `qa` and `release` objects intentionally allow project-specific extensions.

`loadConfig(configFile?, cwd?)` executes the trusted JavaScript config, validates it, resolves paths, applies compatibility defaults, and returns the normalized config. Config files are trusted executable code; validation is not a JavaScript sandbox.

## Build and QA

`runBuild({ configFile, quality, releaseVersion })` resolves to the published build manifest. `quality` is `normal`, `print`, `high`, or `all`.

`runQa({ configFile, quality, releaseVersion, renderAll })` verifies the current manifest and artifacts and rejects when a QA gate fails.

## Release helpers

- `normalizeReleaseVersion(value)` validates a `vMAJOR.MINOR.PATCH` release identifier.
- `prepareRelease(options)` verifies manifest-owned PDFs and writes checksums and Markdown-safe release notes.
- `verifyRenderedPages(options)` checks Poppler page inventories against a manifest.

## Transform helpers

`transformReadme`, `selectBook`, `GithubSlugger`, `looseAnchor`, and `wrapLatinHtml` are stable exports for integrations that need README Press's document model without running the PDF pipeline.

## Errors

Public failures may use `ReadmePressError`. It extends `Error` with stable `code`, `details`, `cause`, and `exitCode` fields. The CLI prints only the message by default; pass `--debug` to include the stack trace.
