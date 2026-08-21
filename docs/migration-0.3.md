# Migrating from 0.2.x to 0.3.0

README Press 0.2.1 keeps the 0.2.0 rendering defaults so existing books can
upgrade without a layout change. When any security setting is omitted, the
build manifest records a non-blocking `SECURITY_DEFAULTS_DEPRECATED` warning.
That warning identifies the settings that need an explicit migration decision.

Version 0.3.0 changes four defaults:

| Setting | 0.2.1 compatibility default | 0.3.0 default |
|---|---|---|
| `security.rawHtml` | `trusted` | `safe` |
| `security.network` | `trusted` | `deny` |
| `security.diagnostics` | `warn` | `strict` |
| `security.strictConfig` | `false` | `true` |

## Recommended migration on 0.2.1

Opt in to the future defaults while still using 0.2.1:

```js
export default defineConfig({
  // Existing book configuration...
  security: {
    rawHtml: 'safe',
    network: 'deny',
    diagnostics: 'strict',
    strictConfig: true,
  },
});
```

Build and inspect every edition before upgrading:

```bash
npx readme-press pipeline \
  --config readme-press.config.mjs \
  --release-version v1.0.0 \
  --render-all
```

The migration is ready when the build has no sanitizer or transform diagnostic,
no unexpected external network request, and the rendered books match the
approved visual baseline.

## Raw HTML

`safe` preserves the supported GFM and book markup but removes scripts,
iframes, event handlers, inline styles, and unsafe URL protocols. Replace
removed presentation markup with Markdown or theme CSS. Use `deny` only when
the selected book contains no raw HTML.

If the Markdown is fully trusted and intentionally depends on unrestricted raw
HTML, set `rawHtml: 'trusted'` explicitly. This keeps the old behaviour after
the upgrade, but it should not be used for untrusted contributions.

## Network access

Prefer `network: 'deny'` and store book assets locally. If the build must fetch
specific remote assets, declare hostnames without schemes or paths:

```js
security: {
  network: {
    mode: 'allowlist',
    allowHosts: ['images.example.com'],
  },
}
```

The policy is enforced both during Markdown transformation and inside
Chromium. Redirects and subresources must also resolve to an allowed hostname.

## Strict configuration and diagnostics

With `strictConfig: true`, unknown README Press core keys fail validation.
Project-specific `qa` and `release` keys remain extension-friendly. Fix every
`UNKNOWN_CONFIG_KEY` warning before enabling the setting.

With `diagnostics: 'strict'`, sanitizer, transform, and artifact warnings become
errors before publication. The 0.2.1 compatibility-default notice remains a
warning so enabling strict diagnostics cannot break an otherwise compatible
0.2.x build.

Configuration files, custom themes, QA modules, and release modules remain
trusted executable code. These controls harden Markdown and assets; they do not
sandbox project-owned JavaScript.

## Roll back safely

If the 0.3 migration changes output or blocks a required trusted input, pin the
book project to the last verified 0.2.x release instead of weakening the new
defaults implicitly:

```bash
npm install --save-dev --save-exact readme-press@0.2.1
npx readme-press version
npx readme-press pipeline \
  --config readme-press.config.mjs \
  --release-version v0.2.1 \
  --render-all
```

Re-run the same source commit and compare the manifest, checksums, and all-page
visual evidence with the last approved build. Record the pinned engine version
in both local dependencies and CI.

Never overwrite or reuse a version already published to npm. If a faulty
version reached the registry, restore consumers to a known-good exact version
and publish any correction under a new version number. Treat GitHub Release
assets the same way: keep the historical release intact and create a new,
verified corrective release.

After upgrading to 0.3.0, settings omitted from `security` use the secure values
in the table above and the 0.2.1 compatibility warning is no longer emitted.
