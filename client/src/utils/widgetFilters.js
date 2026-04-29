/**
 * Sanitize a widget-filters array before sending to the server:
 *   - Drops empty values from list ops (in / not_in) so a trailing comma in
 *     the input doesn't translate into IN ('a', '').
 *   - Drops rules where the value(s) is/are missing entirely (the server is
 *     defensive too, but cleaning client-side keeps the payload small).
 */
export function sanitizeWidgetFilters(filters) {
  if (!Array.isArray(filters)) return undefined;
  const VALUELESS_OPS = new Set(['is_empty', 'is_not_empty']);
  const LIST_OPS = new Set(['in', 'not_in']);
  const PAIR_OPS = new Set(['between']);
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
  return out.length > 0 ? out : undefined;
}
