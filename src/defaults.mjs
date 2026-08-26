const SECURITY_DEFAULTS = Object.freeze({
  rawHtml: 'safe',
  network: Object.freeze({ mode: 'deny', allowHosts: Object.freeze([]) }),
  diagnostics: 'strict',
  strictConfig: true,
});

export function createSecurityDefaults() {
  return {
    rawHtml: SECURITY_DEFAULTS.rawHtml,
    network: {
      mode: SECURITY_DEFAULTS.network.mode,
      allowHosts: [...SECURITY_DEFAULTS.network.allowHosts],
    },
    diagnostics: SECURITY_DEFAULTS.diagnostics,
    strictConfig: SECURITY_DEFAULTS.strictConfig,
  };
}
