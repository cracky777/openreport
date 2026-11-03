// Base maps added to the instance, beside the ones the client ships
// (client/public/geo): the subdivisions of a country, made when a user
// validates the card the assistant hands over (add_map) because a map was
// asked of places none of them draws. Stored in the data directory, one file
// per country, listed and served to every signed-in user — a base map holds
// shapes and names, never data.
//
// The source is fixed (Natural Earth admin-1, public domain, the source of the
// world map already shipped): never a URL from the assistant or the browser.
const fs = require('fs');
const path = require('path');
const { buildSubdivisions } = require('./subdivisions');

const SOURCE_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson';
const SOURCE_MAX_BYTES = 80 * 1024 * 1024;
const TIMEOUT_MS = 120 * 1000;
// France has its own regions and départements (client/public/geo), finer than admin-1.
const SHIPPED = new Set(['FR']);
const CODE = /^[A-Z]{2}$/;

const dirOf = () => path.join(process.env.OPENREPORT_DATA_DIR || path.join(__dirname, '..', '..', 'data'), 'geo');
const idOf = (country) => `admin1-${country.toLowerCase()}`;
const fileOf = (country) => path.join(dirOf(), `${idOf(country)}.json`);

/** @returns {{ value: string, label: string, country: string }[]} the base maps added to this instance */
function listBaseMaps() {
  let files;
  try { files = fs.readdirSync(dirOf()); } catch { return []; /* none added yet */ }
  const maps = [];
  for (const file of files.filter((f) => /^admin1-[a-z]{2}\.json$/.test(f)).sort()) {
    try {
      // The label is in the file; read once per listing, the files are small and few.
      const { label, country } = JSON.parse(fs.readFileSync(path.join(dirOf(), file), 'utf8'));
      maps.push({ value: file.replace(/\.json$/, ''), label, country });
    } catch { /* a file being written, or broken: not listed */ }
  }
  return maps;
}

/** @returns {string|null} the base map's JSON, by its id from the listing */
function readBaseMap(id) {
  if (!/^admin1-[a-z]{2}$/.test(String(id))) return null;
  try { return fs.readFileSync(path.join(dirOf(), `${id}.json`), 'utf8'); } catch { return null; /* not added */ }
}

const normalizeCountry = (country) => String(country || '').trim().toUpperCase();

/** Why a country cannot be added, or null. */
function refusalOf(country) {
  if (!CODE.test(country)) return 'country must be an ISO 3166-1 alpha-2 code (US, CA, DE…)';
  if (SHIPPED.has(country)) return 'France already has its regions, départements and towns';
  return null;
}

async function downloadSource(fetchImpl) {
  const res = await fetchImpl(SOURCE_URL, { redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`The map source answered ${res.status}`);
  const text = await res.text();
  if (text.length > SOURCE_MAX_BYTES) throw new Error('The map source is larger than expected');
  return JSON.parse(text);
}

// One download at a time: two cards validated together share it.
let pending = null;

/**
 * Downloads the source, builds the country's map and stores it. A map already
 * added is returned as is.
 * @returns {Promise<{ value: string, label: string, country: string }>}
 */
async function installBaseMap(rawCountry, { fetchImpl = fetch } = {}) {
  const country = normalizeCountry(rawCountry);
  const refusal = refusalOf(country);
  if (refusal) throw Object.assign(new Error(refusal), { status: 400 });
  const existing = listBaseMaps().find((m) => m.country === country);
  if (existing) return existing;
  if (!pending) pending = downloadSource(fetchImpl).finally(() => { pending = null; });
  const source = await pending;
  const map = buildSubdivisions(source, country);
  if (!map) throw Object.assign(new Error(`The map source has no subdivisions for ${country}`), { status: 404 });
  fs.mkdirSync(dirOf(), { recursive: true });
  // Written aside then renamed: a listing never reads half a file.
  const tmp = `${fileOf(country)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(map));
  fs.renameSync(tmp, fileOf(country));
  return { value: idOf(country), label: map.label, country };
}

module.exports = { listBaseMaps, readBaseMap, installBaseMap, refusalOf, normalizeCountry, SOURCE_URL };
