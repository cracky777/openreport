/**
 * Sync the report-level `reportFilters` state with the URL search params so a
 * filtered view can be bookmarked and shared.
 *
 * Format: one URL param per dimension, prefixed with `f_`, value
 * comma-separated. The schema/table prefix is stripped — `orders.country`
 * becomes `f_country` for readability:
 *
 *   ?f_country=FR,DE&f_status=Open
 *
 * If two model dimensions share the same column name (e.g. `orders.country`
 * and `customers.country`), the parser maps to the first match. The
 * serializer falls back to `f_orders.country` for the duplicate to keep the
 * URL unambiguous.
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

export function parseFiltersFromUrl(search, model) {
  if (!model || !Array.isArray(model.dimensions)) return null;
  const params = new URLSearchParams(search || '');
  const out = {};
  for (const [key, raw] of params.entries()) {
    if (!key.startsWith(PREFIX)) continue;
    const lookupKey = key.slice(PREFIX.length);
    const dim = model.dimensions.find((d) => d.name === lookupKey)
      || model.dimensions.find((d) => shortName(d.name) === lookupKey);
    if (!dim) continue;
    const values = raw.split(',').map((s) => s.trim()).filter((s) => s !== '');
    if (values.length > 0) out[dim.name] = values;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Push or replace the filter params in the current URL without triggering a
 * router navigation. Mutates window.history directly so the data fetcher
 * (which already reacts to reportFilters state) doesn't fire twice.
 */
export function syncFiltersToUrl(filters, model) {
  if (typeof window === 'undefined') return;
  if (!model || !Array.isArray(model.dimensions)) return;

  const params = new URLSearchParams(window.location.search);
  // Wipe existing filter params first so removed dims don't linger
  for (const key of Array.from(params.keys())) {
    if (key.startsWith(PREFIX)) params.delete(key);
  }

  // Detect duplicate short names so we can keep the full name for the loser
  const shortCounts = {};
  for (const d of model.dimensions) {
    const s = shortName(d.name);
    shortCounts[s] = (shortCounts[s] || 0) + 1;
  }

  if (filters && typeof filters === 'object') {
    for (const [dimName, values] of Object.entries(filters)) {
      if (!Array.isArray(values) || values.length === 0) continue;
      const s = shortName(dimName);
      const useShort = shortCounts[s] === 1;
      params.set(PREFIX + (useShort ? s : dimName), values.join(','));
    }
  }

  const qs = params.toString();
  const newUrl = window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash;
  if (newUrl !== window.location.pathname + window.location.search + window.location.hash) {
    window.history.replaceState({}, '', newUrl);
  }
}
