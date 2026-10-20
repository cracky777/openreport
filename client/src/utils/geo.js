import * as echarts from 'echarts';

// The places a map widget can draw, served from client/public/geo (sources in
// SOURCES.md there): areas coloured by value, or towns drawn as bubbles over
// the départements. A column of place names is matched against each one by
// name — accents, case and punctuation aside — or by code (FR, FRA, 69).
export const MAP_AREAS = [
  { value: 'fr-regions', label: 'France — regions', file: 'fr-regions.json', kind: 'areas' },
  { value: 'fr-departements', label: 'France — départements', file: 'fr-departements.json', kind: 'areas' },
  { value: 'world', label: 'World — countries', file: 'world.json', kind: 'areas' },
  { value: 'fr-communes', label: 'France — towns', file: 'fr-communes.json', kind: 'points', base: 'fr-departements' },
];
const AREA = Object.fromEntries(MAP_AREAS.map((a) => [a.value, a]));
export const isMapArea = (v) => !!AREA[v];
export const mapNameOf = (area) => `openreport-${area}`;

export function normalizePlace(value) {
  return String(value ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^st /, 'saint ').replace(/ st /g, ' saint ')
    .replace(/^ste /, 'sainte ').replace(/ ste /g, ' sainte ');
}

// normalized name → what the map knows it as: the feature's name for areas,
// { name, coord } for towns (the most populated of namesakes).
export function indexArea(area, json) {
  const index = new Map();
  if (AREA[area]?.kind === 'points') {
    const sorted = [...json].sort((a, b) => b[4] - a[4]);
    for (const [name, , lon, lat] of sorted) {
      const key = normalizePlace(name);
      if (!index.has(key)) index.set(key, { name, coord: [lon, lat] });
    }
    return index;
  }
  for (const f of json.features || []) {
    for (const n of f.properties.names || [f.properties.name]) {
      const key = normalizePlace(n);
      if (key && !index.has(key)) index.set(key, f.properties.name);
    }
  }
  return index;
}

// The area that knows the most of these values; first listed on a tie.
export function bestArea(values, indexes) {
  let best = null;
  let bestCount = 0;
  for (const { value } of MAP_AREAS) {
    const index = indexes[value];
    if (!index) continue;
    const count = values.filter((v) => index.has(normalizePlace(v))).length;
    if (count > bestCount) { best = value; bestCount = count; }
  }
  return best;
}

// One fetch per file for the page's life; areas registered with ECharts.
const loading = new Map();
export function loadArea(area) {
  if (!AREA[area]) return Promise.reject(new Error(`Unknown map: ${area}`));
  if (!loading.has(area)) {
    const { file, kind, base } = AREA[area];
    const promise = fetch(`/geo/${file}`)
      .then((res) => { if (!res.ok) throw new Error(`Map ${area} unavailable`); return res.json(); })
      .then(async (json) => {
        if (kind === 'areas') echarts.registerMap(mapNameOf(area), json);
        if (base) await loadArea(base);
        return { area, index: indexArea(area, json) };
      });
    promise.catch(() => loading.delete(area));
    loading.set(area, promise);
  }
  return loading.get(area);
}

// `area` 'auto' (or unset) loads them all and keeps the one that knows the
// values best.
export async function resolveArea(area, values) {
  if (isMapArea(area)) return loadArea(area);
  const loaded = await Promise.all(MAP_AREAS.map((a) => loadArea(a.value).catch(() => null)));
  const indexes = Object.fromEntries(loaded.filter(Boolean).map((l) => [l.area, l.index]));
  const best = bestArea(values, indexes) || 'world';
  return loaded.find((l) => l?.area === best) || loadArea(best);
}
