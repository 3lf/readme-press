import { ReadmePressError } from './errors.mjs';

const ERROR_CODES = new Set([
  'MISSING_FIGURE_FILE',
  'MISSING_TWEMOJI',
]);

export function normalizeDiagnostics(diagnostics, mode = 'warn') {
  const normalized = diagnostics.map((diagnostic) => {
    const baseSeverity = diagnostic.severity
      ?? (ERROR_CODES.has(diagnostic.code) ? 'error' : 'warning');
    return {
      ...diagnostic,
      severity: mode === 'strict'
        && baseSeverity === 'warning'
        && diagnostic.promoteInStrict !== false
        ? 'error'
        : baseSeverity,
    };
  });
  const ranks = { warning: 1, error: 2 };
  const byIdentity = new Map();
  for (const diagnostic of normalized) {
    const identity = `${diagnostic.code}\0${JSON.stringify(diagnostic.detail ?? null)}`;
    const existing = byIdentity.get(identity);
    if (!existing) byIdentity.set(identity, diagnostic);
    else if ((ranks[diagnostic.severity] ?? 0) > (ranks[existing.severity] ?? 0)) {
      byIdentity.set(identity, { ...existing, severity: diagnostic.severity });
    }
  }
  return [...byIdentity.values()];
}

export function assertNoDiagnosticErrors(diagnostics) {
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  if (!errors.length) return;
  const summary = errors.map((diagnostic) => `${diagnostic.code}: ${diagnostic.detail}`).join('\n');
  throw new ReadmePressError(
    `README Press stopped because of ${errors.length} diagnostic error(s):\n${summary}`,
    {
      code: 'ERR_DIAGNOSTICS',
      details: { diagnostics: errors },
    },
  );
}
