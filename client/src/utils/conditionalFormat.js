/**
 * Evaluate a discrete-threshold color condition.
 *
 *   condition.rules   — array of { op: '<'|'<='|'='|'!='|'>='|'>', value, color }
 *   condition.defaultColor — fallback when no rule matches (optional)
 *
 * Rules are evaluated top-to-bottom; the first match wins. Order matters when
 * intervals overlap (e.g. `< 100 → red`, `< 500 → orange`, `>= 500 → green`).
 *
 * Returns the matched colour, the default colour, or `null` when nothing
 * applies and the caller should fall back to the regular background config.
 */
export function evaluateColorCondition(condition, value) {
  if (!condition || !Array.isArray(condition.rules) || condition.rules.length === 0) return null;
  if (value == null || isNaN(value)) return condition.defaultColor || null;
  const num = Number(value);
  for (const rule of condition.rules) {
    if (!rule || rule.value === '' || rule.value == null) continue;
    const t = Number(rule.value);
    if (isNaN(t)) continue;
    let match = false;
    switch (rule.op) {
      case '<':  match = num < t; break;
      case '<=': match = num <= t; break;
      case '=':  match = num === t; break;
      case '!=': match = num !== t; break;
      case '>=': match = num >= t; break;
      case '>':  match = num > t; break;
      default:   match = false;
    }
    if (match) return rule.color || null;
  }
  return condition.defaultColor || null;
}
