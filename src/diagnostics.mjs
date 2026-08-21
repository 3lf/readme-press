const ERROR_CODES = new Set([
  'MISSING_FIGURE_FILE',
  'MISSING_TWEMOJI',
]);

export function normalizeDiagnostics(diagnostics, mode = 'warn') {
  return diagnostics.map((diagnostic) => {
    const baseSeverity = diagnostic.severity
      ?? (ERROR_CODES.has(diagnostic.code) ? 'error' : 'warning');
    return {
      ...diagnostic,
      severity: mode === 'strict' && baseSeverity === 'warning' ? 'error' : baseSeverity,
    };
  });
}

export function assertNoDiagnosticErrors(diagnostics) {
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  if (!errors.length) return;
  const summary = errors.map((diagnostic) => `${diagnostic.code}: ${diagnostic.detail}`).join('\n');
  throw new Error(`README Press stopped because of ${errors.length} diagnostic error(s):\n${summary}`);
}
