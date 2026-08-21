# README Press hardening implementation plan

1. Harden filesystem and asset boundaries, including canonical path checks,
   content-addressed image destinations, structured edition selection, and
   regression tests for traversal, symlinks, and output containment.
2. Add HTML and browser trust controls: centralized escaping, safe raw-HTML
   allowlists, cover sanitization, CSP, network enforcement, and security docs.
3. Make builds transactional and deterministic through staged generation,
   manifest-owned cleanup, structured diagnostics, tool preflight, and safe
   release-note generation.
4. Stabilize runtime contracts with schema validation, strict CLI parsing,
   public error codes, TypeScript declarations, API documentation, and packed
   consumer tests.
5. Harden repository automation by pinning actions, adding dependency update
   policy, consolidating verification commands, and documenting contribution,
   toolchain, changelog, and testing policy.
6. Prepare the backward-compatible `0.2.1` release candidate and pass all
   source, package, integration, audit, and real-book regression gates.
7. Prepare `0.3.0`, switch to secure defaults, repeat every gate, and keep the
   pull request blocked until `0.2.1` has been explicitly released and verified.

The real-book gate uses `llm-for-humans@v1.0.2` from a temporary archive. It
must keep all three 265-page editions structurally and visually identical to a
same-environment `readme-press@0.2.0` baseline.
