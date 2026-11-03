// The states, provinces or regions of one country, as the map widget reads a
// base map (client/src/utils/geo.js): a FeatureCollection whose features carry
// `name` and the `names` a place column may hold (names in several languages,
// postal and ISO codes). Built from Natural Earth's admin-1 layer — the source
// of the world map already shipped — when the user validates the card the
// assistant hands over (utils/ai/actions.js, add_map). Pure: the download and
// the storage are baseMaps.js.

// Simplified to about a kilometre, then rounded like world.json: a state map
// of a few hundred kilobytes instead of the source's tens of megabytes.
const TOLERANCE = 0.02;
const DECIMALS = 2;
const LANGS = ['en', 'fr', 'de', 'es', 'it', 'nl', 'pt', 'sv', 'pl'];

// Pieces far from the rest, moved next to it so the mainland is not drawn
// tiny (ECharts `specialAreas`, in the coordinates of the map). Only where a
// country is known to need it.
const INSETS = {
  US: { Alaska: { left: -131, top: 25, width: 15 }, Hawaii: { left: -110, top: 28, width: 5 } },
};

// Douglas–Peucker on one ring; a ring keeps at least its triangle.
function simplifyRing(points, tolerance) {
  if (points.length <= 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    const [ax, ay] = points[first];
    const [bx, by] = points[last];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    let worst = -1;
    let worstDist = 0;
    for (let i = first + 1; i < last; i++) {
      const [px, py] = points[i];
      const dist = len === 0 ? Math.hypot(px - ax, py - ay) : Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
      if (dist > worstDist) { worst = i; worstDist = dist; }
    }
    if (worst !== -1 && worstDist > tolerance) {
      keep[worst] = 1;
      stack.push([first, worst], [worst, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

const round = (v) => Math.round(v * 10 ** DECIMALS) / 10 ** DECIMALS;

// Rounded, consecutive duplicates dropped, closed; null when nothing is left
// of it (an islet smaller than the tolerance).
function cleanRing(ring, shift) {
  const out = [];
  for (const [x, y] of simplifyRing(ring.map(([x, y]) => [shift(x), y]), TOLERANCE)) {
    const p = [round(x), round(y)];
    const prev = out[out.length - 1];
    if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) out.push(p);
  }
  if (out.length && (out[0][0] !== out[out.length - 1][0] || out[0][1] !== out[out.length - 1][1])) out.push(out[0]);
  return out.length >= 4 ? out : null;
}

function polygonsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

// A country across the antimeridian (Alaska's Aleutians, Russia's Chukotka):
// its minority side is moved by 360° so the map is not stretched round the globe.
function antimeridianShift(features) {
  let west = 0;
  let east = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const f of features) {
    for (const poly of polygonsOf(f.geometry)) {
      for (const [x] of poly[0]) {
        if (x < 0) west++; else east++;
        if (x < min) min = x;
        if (x > max) max = x;
      }
    }
  }
  if (max - min <= 180) return (x) => x;
  return west >= east ? (x) => (x > 0 ? x - 360 : x) : (x) => (x < 0 ? x + 360 : x);
}

function geometryOf(feature, shift) {
  const polygons = [];
  for (const poly of polygonsOf(feature.geometry)) {
    const outer = cleanRing(poly[0], shift);
    if (!outer) continue;
    polygons.push([outer, ...poly.slice(1).map((r) => cleanRing(r, shift)).filter(Boolean)]);
  }
  if (!polygons.length) return null;
  return polygons.length === 1 ? { type: 'Polygon', coordinates: polygons[0] } : { type: 'MultiPolygon', coordinates: polygons };
}

// Every name a place column may hold for this subdivision.
function namesOf(p) {
  const names = [p.name, ...LANGS.map((l) => p[`name_${l}`]), p.postal, p.iso_3166_2, ...String(p.name_alt || '').split('|')];
  return [...new Set(names.filter((n) => typeof n === 'string' && n.trim()).map((n) => n.trim()))];
}

// "State" → "states", "Province" → "provinces": what the list of maps calls them.
function plural(type) {
  const t = String(type || 'region').toLowerCase();
  if (/(s|sh|ch|x)$/.test(t)) return `${t}es`;
  if (/[^aeiou]y$/.test(t)) return `${t.slice(0, -1)}ies`;
  return `${t}s`;
}

function mostCommon(values) {
  const counts = new Map();
  for (const v of values) if (v) counts.set(v, (counts.get(v) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

/**
 * @param {object} source  Natural Earth admin-1 FeatureCollection
 * @param {string} country ISO 3166-1 alpha-2 code
 * @returns {object|null}  the base map ({ country, label, type, features, specialAreas? }), null when the source holds none of it
 */
function buildSubdivisions(source, country) {
  const code = String(country || '').toUpperCase();
  const picked = (source.features || []).filter((f) => f.properties && f.properties.iso_a2 === code && f.properties.name);
  if (!picked.length) return null;
  const shift = antimeridianShift(picked);
  const features = [];
  for (const f of picked) {
    const geometry = geometryOf(f, shift);
    if (geometry) features.push({ type: 'Feature', properties: { name: f.properties.name, names: namesOf(f.properties) }, geometry });
  }
  if (!features.length) return null;
  const countryName = mostCommon(picked.map((f) => f.properties.admin)) || code;
  const type = plural(mostCommon(picked.map((f) => f.properties.type_en)));
  const insets = INSETS[code] && Object.fromEntries(Object.entries(INSETS[code]).filter(([name]) => features.some((f) => f.properties.name === name)));
  return {
    type: 'FeatureCollection',
    country: code,
    label: `${countryName} — ${type}`,
    features,
    ...(insets && Object.keys(insets).length ? { specialAreas: insets } : {}),
  };
}

module.exports = { buildSubdivisions, simplifyRing, plural };
