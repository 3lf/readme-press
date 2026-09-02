export const PROSE_RULE_MATCHERS = Object.freeze(['contains', 'startsWith']);

export function matchesProseRule(text, rule) {
  const value = String(text ?? '');
  return PROSE_RULE_MATCHERS.some((matcher) => (
    typeof rule?.[matcher] === 'string'
    && rule[matcher].length > 0
    && (matcher === 'startsWith'
      ? value.startsWith(rule[matcher])
      : value.includes(rule[matcher]))
  ));
}
