# Hardening Stack Final Remediation Design

Date: 2026-08-26

Scope: Draft PRs #7 through #13

Status: approved for implementation

## Decision

Repair each validated finding in the earliest stacked PR that owns the affected contract, then rebase every descendant onto the corrected parent. This keeps each merge step independently safe and reviewable. No separate follow-up PR is required for the current release blockers.

The independent fact check corrected the source report's headline from 29 to 30 per-layer findings:

- 27 findings are implemented now.
- 2 findings are already resolved by later stack layers and retain regression coverage.
- 1 proposed remedy is rejected: fixture-specific `release-notes.md` must not be attached to an engine release.

## Ownership by PR

1. PR #7 owns path classification and containment, project-root validation, output sink revalidation, renderer lifecycle cleanup, and missing-figure diagnostic deduplication.
2. PR #8 owns unsafe reference-link filtering, intercepted-request settlement, deny-mode CSP, and boundary-tokenizer coverage.
3. PR #9 owns canonical generated-artifact identity, manifest-last publication, abandoned-stage recovery, additive ownership, central diagnostic deduplication, cleanup telemetry, and failure recovery.
4. PR #10 owns schema-derived configuration contracts, fail-closed security keys, actionable validation errors, lazy Mermaid preflight, and runtime/type alignment.
5. PR #11 owns final-hop checksum verification and accurate documentation of the manual visual release gate.
6. PR #12 owns 0.2.1 compatibility, animated-cover fallback, strict compatibility integration, consumer migration commands, and rollback guidance.
7. PR #13 owns policy-enforced cover capture, combined request inventory, secure direct-API defaults, and final 0.3 migration wording.

## Compatibility constraints

- Version 0.2.1 keeps `rawHtml=trusted`, `network=trusted`, warning diagnostics, and non-strict core configuration defaults.
- Version 0.3.0 changes those defaults to safe HTML, denied network access, strict diagnostics, and strict core configuration.
- Executable JavaScript configuration remains trusted. Hardening protects Markdown, assets, rendering, publication, and public API boundaries.
- Existing public exports remain supported. Deferred expansion such as a complete public error-code catalog is outside this stack.
- Publication remains atomic per file. Tests and documentation must not claim whole-output rollback.

## Acceptance gates

Every fix starts with an exploit-oriented regression and finishes with targeted plus full layer checks. Before pushing the rewritten stack, verification must cover syntax, unit, security, browser security, API, TypeScript, workflow validation, package installation, all three PDF editions for English and Persian fixtures, external-tool QA, npm audit, and a real `llm-for-humans@v1.0.2` build. Baseline and candidate rendering use the same environment and require identical page counts and zero visual differences for unchanged local-only content.

The final review re-checks all 30 findings against the resulting code and records commit and test evidence. No finding is closed from implementation intent alone.

## Release boundaries

All seven pull requests remain Draft. This work may commit, rebase, push with exact force-with-lease protection, update Draft PR descriptions, run checks, and improve the PRs. It must not merge branches, stage or publish npm packages, create GitHub releases, delete stacked branches, or mark pull requests ready for review.
