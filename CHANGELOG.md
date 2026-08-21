# Changelog

All notable changes to README Press are documented in this file. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project follows semantic versioning within its pre-1.0 compatibility policy.

## [Unreleased]

Release-specific changes are added here by their release pull request.

## [0.2.1] - 2026-08-21

### Added

- Filesystem containment for source images, generated assets, static-server
  requests, and nested PDF outputs, including canonical symlink checks.
- Safe and deny raw HTML modes, centralized context encoding, a sanitized cover
  note, Content Security Policy, and transform/browser network policies.
- Atomic staged builds, manifest-owned cleanup, structured diagnostics, and
  readable external-tool preflight failures.
- Zod configuration validation, a stable CLI error contract, public library
  documentation, JavaScript declarations, and TypeScript consumer tests.
- SHA-pinned Actions, Node.js 22/24 compatibility coverage, Dependabot, and
  documented contribution and test policies.

### Changed

- Generated figure names are content-addressed and edition image selection is
  performed on the document tree instead of global string replacement.
- npm tarball smoke tests now verify the runtime API, TypeScript declarations,
  and all three PDF editions from a clean installation.

### Deprecated

- Omitting `security.rawHtml`, `security.network`, `security.diagnostics`, or
  `security.strictConfig` now emits a non-blocking migration warning. Version
  0.2.1 retains the 0.2.x defaults; version 0.3.0 changes them to `safe`, `deny`,
  `strict`, and `true` respectively.

## [0.2.0] - 2026-08-18

### Added

- Optional print-optimized PDF editions with white page backgrounds and
  lossless figures.
- English and Persian integration fixtures for normal, print, and high-quality
  output.
- A reusable composite GitHub Action and guarded release workflows.
- Clean-install npm package smoke testing and expanded PDF QA.

[Unreleased]: https://github.com/3lf/readme-press/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/3lf/readme-press/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/3lf/readme-press/releases/tag/v0.2.0
