/**
 * Sync the report-level filter rules (`settings.reportFilters`) with the
 * URL search params so a filtered view can be bookmarked and shared.
 *
 * Format: one URL param per dimension, prefixed with `f_`, value
 * comma-separated. The schema/table prefix is stripped — `orders.country`
 * becomes `f_country` for readability:
 *
 *   ?f_country=FR,DE&f_status=Open
 *
 * Only the `in` operator is reflected in the URL — other rules (between,
 * comparisons, top-N, measure filters) don't have a natural URL encoding
 * and are kept solely in `settings.reportFilters`.
 *
 * If two model dimensions share the same column name, the parser maps to
 * the first match. The serializer falls back to `f_orders.country` for
 * the duplicate to keep the URL unambiguous.
 *
 * Both functions need the loaded `model` to map between short and full
 * dimension names. Call them only AFTER the model has loaded.
 */

const PREFIX = 'f_';

function shortName(dimName) {
  if (!dimName || typeof dimName !== 'string') return dimName;
  const idx = dimName.lastIndexOf('.');
  return idx >= 0 ? dimName.slice(idx + 1) : dimName;
}

/**
 * Parse the URL search string into an array of filter rules using the same
 * shape as `settings.reportFilters`. Returns null if no `f_*` params match a
 * dimension. Caller merges these into the existing rules (URL wins for
 * fields it covers; other saved rules stay).
 */
export function parseFiltersFromUrl(search, model) {
  if (!model || !Array.isArray(model.dimensions)) return null;
  const params = new URLSearchParams(search || '');
  const out = [];
  for (const [key, raw] of params.entries()) {
    if (!key.startsWith(PREFIX)) continue;
    const lookupKey = key.slice(PREFIX.length);
    const dim = model.dimensions.find((d) => d.name === lookupKey)
      || model.dimensions.find((d) => shortName(d.name) === lookupKey);
    if (!dim) continue;
    const values = raw.split(',').map((s) => s.trim()).filter((s) => s !== '');
    if (values.length === 0) continue;
    out.push({ field: dim.name, isMeasure: false, op: 'in', value: '', values });
  }
  return out.length > 0 ? out : null;
}

/**
 * Push or replace the filter params in the current URL without triggering a
 * router navigation. Mutates window.history directly so the data fetcher
 * doesn't fire twice.
 *
 * Accepts the rules array (`settings.reportFilters` shape). Skips rules
 * whose `op` isn't `in` and rules without resolvable values — they stay in
 * `settings.reportFilters` but don't surface in the URL.
 */
export function syncFiltersToUrl(rules, model) {
  if (typeof window === 'undefined') return;
  if (!model || !Array.isArray(model.dimensions)) return;

  const params = new URLSearchParams(window.location.search);
  // Wipe existing filter params first so removed rules don't linger.
  for (const key of Array.from(params.keys())) {
    if (key.startsWith(PREFIX)) params.delete(key);
  }

  // Detect duplicate short names so we can keep the full name for the loser.
  const shortCounts = {};
  for (const d of model.dimensions) {
    const s = shortName(d.name);
    shortCounts[s] = (shortCounts[s] || 0) + 1;
  }

  if (Array.isArray(rules)) {
    for (const r of rules) {
      if (!r || r.isMeasure) continue;
      if (r.op !== 'in') continue;
      const values = Array.isArray(r.values)
        ? r.values.filter((v) => v !== '' && v != null)
        : [];
      if (values.length === 0) continue;
      // Only encode rules whose field actually exists in the model — stale
      // references would produce unparseable params after a model rename.
      const dim = model.dimensions.find((d) => d.name === r.field);
      if (!dim) continue;
      const s = shortName(dim.name);
      const useShort = shortCounts[s] === 1;
      params.set(PREFIX + (useShort ? s : dim.name), values.join(','));
    }
  }

  const qs = params.toString();
  const newUrl = window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash;
  if (newUrl !== window.location.pathname + window.location.search + window.location.hash) {
    window.history.replaceState({}, '', newUrl);
  }
}

/**
 * Decode the `pf=` param ("print filters") used by the cloud scheduler's
 * server-side renderer to inject per-recipient filter overrides. Format:
 * base64url-encoded JSON object whose keys match dimension names (full or
 * short, same resolution as `?f_…`).
 *
 * Returns null if the param is absent or unreadable. The caller is expected
 * to merge the result into `reportFilters` BEFORE the first data fetch so
 * the personalised query goes out on the initial round.
 */
export function parsePrintFiltersFromUrl(search, model) {
  if (!model || !Array.isArray(model.dimensions)) return null;
  const params = new URLSearchParams(search || '');
  const raw = params.get('pf');
  if (!raw) return null;
  let decoded;
  try {
    // base64url → base64 (Node's base64url is browser-safe; we rebuild for
    // Safari which lacks atob('-_') support).
    const b64 = raw.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const json = atob(padded);
    decoded = JSON.parse(json);
  } catch {
    return null;
  }
  if (!decoded || typeof decoded !== 'object') return null;
  const out = {};
  for (const [key, vals] of Object.entries(decoded)) {
    const dim = model.dimensions.find((d) => d.name === key)
      || model.dimensions.find((d) => shortName(d.name) === key);
    if (!dim) continue;
    const arr = Array.isArray(vals) ? vals : [vals];
    const cleaned = arr.map((v) => (v == null ? '' : String(v))).filter((v) => v !== '');
    if (cleaned.length > 0) out[dim.name] = cleaned;
  }
  return Object.keys(out).length > 0 ? out : null;
}
