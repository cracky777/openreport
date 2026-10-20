// A custom measure made of two others by one operation — the form the chat
// writes (utils/ai/reportMeasures.js: variance, ratio, percentage) — read back
// from its expression, so a pivot can rebuild its totals from the totals of
// the two parts: Σ(a − b) = Σa − Σb, and a ratio of totals is the true ratio
// of the whole, where a sum of per-row ratios is not. A product is left out:
// Σ(a × b) is not Σa × Σb.

const REF = '\\$\\{([^}]+)\\}';
const FORMS = [
  [new RegExp(`^\\(${REF}\\) \\+ \\(${REF}\\)$`), 'add'],
  [new RegExp(`^\\(${REF}\\) - \\(${REF}\\)$`), 'subtract'],
  [new RegExp(`^\\(${REF}\\) / NULLIF\\(\\(${REF}\\), 0\\)$`), 'divide'],
  [new RegExp(`^100\\.0 \\* \\(${REF}\\) / NULLIF\\(\\(${REF}\\), 0\\)$`), 'percent'],
];

/**
 * @param {string} expression  a custom measure's expression
 * @returns {{ op: string, left: string, right: string }|null}  the measure names it combines
 */
function parseArithmetic(expression) {
  const text = String(expression || '').trim();
  for (const [re, op] of FORMS) {
    const m = re.exec(text);
    if (m) return { op, left: m[1].trim(), right: m[2].trim() };
  }
  return null;
}

// What a total can be rebuilt from: a plain sum or count of a column, summed
// again over the groups. Never a distinct count, an average or an expression.
const ADDITIVE = new Set(['sum', 'count', 'count_col']);
const isAdditive = (m) => !!m && ADDITIVE.has(String(m.aggregation || '').toLowerCase()) && !m.runningTotal && !m.periodShift && !m.lastValue;

module.exports = { parseArithmetic, isAdditive };
