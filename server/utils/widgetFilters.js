/**
 * Server-side mirror of `client/src/utils/widgetFilters.js#sanitizeWidgetFilters`.
 *
 * Used by the cache warmer so it composes the SAME `widgetFilters` array
 * the Editor / Viewer / DataPanel send at runtime — without that match,
 * the pre-agg cache key would diverge between warm and runtime, and
 * every visual would miss after the warm pass.
 *
 * Keep these two implementations in sync. They're tiny and the cost of
 * duplication is much lower than wiring a shared package.
 */

const VALUELESS_OPS = new Set(['is_empty', 'is_not_empty']);
const LIST_OPS = new Set(['in', 'not_in']);
const PAIR_OPS = new Set(['between']);

function sanitizeWidgetFilters(filters) {
  if (!Array.isArray(filters)) return [];
  const out = [];
  for (const f of filters) {
    if (!f || !f.field || !f.op) continue;
    if (VALUELESS_OPS.has(f.op)) { out.push(f); continue; }
    if (LIST_OPS.has(f.op)) {
      const cleaned = (f.values || []).filter((v) => v !== '' && v != null);
      if (cleaned.length === 0) continue;
      out.push({ ...f, values: cleaned });
      continue;
    }
    if (PAIR_OPS.has(f.op)) {
      const [a, b] = f.values || [];
      if (a === '' || a == null || b === '' || b == null) continue;
      out.push(f);
      continue;
    }
    if (f.value === '' || f.value == null) continue;
    out.push(f);
  }
  return out;
}

module.exports = { sanitizeWidgetFilters };
