# Security policy

## Supported versions

Security fixes are provided for the latest stable README Press release. Please reproduce a report against that version before submitting it.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for the `3lf/readme-press` repository. Do not open a public issue for an unpatched vulnerability. Include a minimal README/config fixture, the affected version, the command you ran, and the observed impact. You can expect an initial response within seven days.

## Trust model

README Press configuration files are executable JavaScript and must be trusted. The HTML and network controls protect the renderer from untrusted Markdown and referenced assets; they do not sandbox a malicious configuration file, theme, QA script, or release script.

`security.rawHtml` accepts:

- `trusted`: preserve raw HTML. This is the compatibility default in 0.2.x.
- `safe`: sanitize author HTML with a GFM-compatible allowlist. Scripts, iframes, event handlers, inline styles, and unsafe URL protocols are removed.
- `deny`: reject a selected book that contains raw HTML.

`security.network` accepts `trusted`, `deny`, or `{ mode: 'allowlist', allowHosts: [...] }`. The policy is enforced while Markdown assets are transformed and again for Chromium requests. Local build resources remain available. Safe HTML documents also receive a restrictive Content Security Policy.

Local image paths are resolved relative to the source README. Their canonical paths must remain inside the configured content root. Generated assets are content-addressed, and configured PDF paths must remain inside the output directory.
