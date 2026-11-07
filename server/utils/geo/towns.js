// The towns of one country, as bubbles a map visual places by name: read from
// GeoNames' cities500 (every place of 500 inhabitants or more, CC BY 4.0).
// Pure: the download and the storage are in baseMaps.js.
//
// Made beside a country's subdivisions (add_map): a column of town names
// (Esch-sur-Alzette, Wiltz) matched against the districts drew three grey
// shapes and listed every town as "not on the map".

// cities500.txt columns (tab separated), https://download.geonames.org/export/dump/readme.txt
const NAME = 1;
const ASCII = 2;
const ALTERNATES = 3;
const LAT = 4;
const LON = 5;
const COUNTRY = 8;
const POPULATION = 14;

const MAX_ALTERNATES = 12;
const MAX_NAME = 40;
// Only the names a place column of a Latin-script report may hold: the other
// scripts would weigh the file for nothing.
const LATIN = /^[\p{Script=Latin}0-9 '’.()-]+$/u;
const keyOf = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const round = (n) => Math.round(n * 10000) / 10000;

/**
 * @param {string} text   cities500.txt
 * @param {string} country ISO 3166-1 alpha-2
 * @returns {Array<[string, string, number, number, number, string[]]>|null}
 *   [name, '', longitude, latitude, population, other names], most populated
 *   first; null when the source holds no town of that country
 */
function buildTowns(text, country) {
  const code = String(country || '').toUpperCase();
  const towns = [];
  for (const line of text.split('\n')) {
    const cols = line.split('\t');
    if (cols[COUNTRY] !== code) continue;
    const lon = Number(cols[LON]);
    const lat = Number(cols[LAT]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const name = cols[NAME];
    const seen = new Set([keyOf(name)]);
    const others = [];
    for (const n of [cols[ASCII], ...String(cols[ALTERNATES] || '').split(',')]) {
      const alt = String(n || '').trim();
      if (others.length >= MAX_ALTERNATES) break;
      if (!alt || alt.length > MAX_NAME || !LATIN.test(alt) || seen.has(keyOf(alt))) continue;
      seen.add(keyOf(alt));
      others.push(alt);
    }
    towns.push([name, '', round(lon), round(lat), Number(cols[POPULATION]) || 0, others]);
  }
  if (!towns.length) return null;
  return towns.sort((a, b) => b[4] - a[4]);
}

module.exports = { buildTowns };
