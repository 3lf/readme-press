# README Press hardening design

## Goal

Make README Press safe and predictable as a public CLI, library, npm package,
and GitHub Action without changing the visual output of existing trusted books.
The work ships in two compatibility stages: `0.2.1` introduces guarded
behaviour and migration controls, while `0.3.0` enables secure defaults.

## Trust boundaries

The JavaScript configuration file remains trusted executable code. Markdown,
raw HTML, local assets, and network references are treated as data and must not
gain filesystem, browser-script, or unrestricted network capabilities.

Local references resolve from the README directory but their canonical target
must remain inside the configured project root. Generated files must remain
inside the configured output directory. The renderer serves only canonical
files below its route roots.

## Content and rendering

Local images receive content-addressed destinations below
`assets/figures/`. Normal and lossless image URLs are selected structurally,
never through whole-document string replacement. Raw HTML supports trusted,
safe, and denied modes. Safe mode keeps the semantic HTML needed by GitHub
READMEs while removing executable or layout-hostile markup and attributes.

All configuration text is escaped for its actual HTML or Markdown context. The
cover repository note supports only a small sanitized inline-markup vocabulary.
Browser rendering enforces the configured network policy independently from
the transformation pipeline.

## Compatibility and releases

`0.2.1` retains trusted HTML, trusted network access, warning diagnostics, and
permissive unknown configuration keys. `0.3.0` defaults to safe HTML, denied
network access, strict diagnostics, and strict core configuration keys. Custom
QA and release extension data remain supported.

The existing ESM exports become an intentional public API with runtime and type
contracts. No TypeScript source migration is required.

## Delivery

The implementation is split into seven stacked draft pull requests. Each pull
request has a focused behavioural boundary and its own tests. No merge, GitHub
Release, npm staging, or npm publishing occurs without explicit approval.
