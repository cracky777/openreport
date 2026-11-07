// Base maps added to the instance, beside the ones the client ships
// (client/public/geo): the subdivisions of a country, made when a user
// validates the card the assistant hands over (add_map) because a map was
// asked of places none of them draws. Stored in the data directory, one file
// per country, listed and served to every signed-in user — a base map holds
// shapes and names, never data.
//
// Beside them, the country's towns (towns.js): a column of town names is drawn
// as bubbles over the subdivisions, as French communes are over the départements.
//
// The sources are fixed (Natural Earth admin-1, public domain, the source of the
// world map already shipped; GeoNames cities500, CC BY 4.0): never a URL from
// the assistant or the browser.
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { buildSubdivisions } = require('./subdivisions');
const { buildTowns } = require('./towns');

const SOURCE_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson';
const SOURCE_MAX_BYTES = 80 * 1024 * 1024;
const TOWNS_URL = 'https://download.geonames.org/export/dump/cities500.zip';
const TOWNS_ENTRY = 'cities500.txt';
const TIMEOUT_MS = 120 * 1000;
// France has its own regions and départements (client/public/geo), finer than admin-1.
const SHIPPED = new Set(['FR']);
const CODE = /^[A-Z]{2}$/;

const dirOf = () => path.join(process.env.OPENREPORT_DATA_DIR || path.join(__dirname, '..', '..', 'data'), 'geo');
const idOf = (country) => `admin1-${country.toLowerCase()}`;
const townsIdOf = (country) => `towns-${country.toLowerCase()}`;
const fileOf = (id) => path.join(dirOf(), `${id}.json`);
const ID = /^(admin1|towns)-[a-z]{2}$/;
const countryOf = (label) => String(label).split(' — ')[0];

/**
 * @returns {{ value: string, label: string, country: string, towns: string|null }[]}
 *   the subdivisions added to this instance, each with the id of its towns when they were added too
 */
function listBaseMaps() {
  let files;
  try { files = fs.readdirSync(dirOf()); } catch { return []; /* none added yet */ }
  const maps = [];
  for (const file of files.filter((f) => /^admin1-[a-z]{2}\.json$/.test(f)).sort()) {
    try {
      // The label is in the file; read once per listing, the files are small and few.
      const { label, country } = JSON.parse(fs.readFileSync(path.join(dirOf(), file), 'utf8'));
      const towns = files.includes(`${townsIdOf(country)}.json`) ? townsIdOf(country) : null;
      maps.push({ value: file.replace(/\.json$/, ''), label, country, towns });
    } catch { /* a file being written, or broken: not listed */ }
  }
  return maps;
}

/** What the map widget lists: the subdivisions as areas, the towns as bubbles over them. */
function listMapLayers() {
  return listBaseMaps().flatMap((m) => [
    { value: m.value, label: m.label, kind: 'areas' },
    ...(m.towns ? [{ value: m.towns, label: `${countryOf(m.label)} — towns`, kind: 'points', base: m.value }] : []),
  ]);
}

/** @returns {string|null} the base map's JSON, by its id from the listing */
function readBaseMap(id) {
  if (!ID.test(String(id))) return null;
  try { return fs.readFileSync(fileOf(id), 'utf8'); } catch { return null; /* not added */ }
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

async function downloadTowns(fetchImpl) {
  const res = await fetchImpl(TOWNS_URL, { redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`The towns source answered ${res.status}`);
  const zip = Buffer.from(await res.arrayBuffer());
  if (zip.length > SOURCE_MAX_BYTES) throw new Error('The towns source is larger than expected');
  const entry = new AdmZip(zip).getEntry(TOWNS_ENTRY);
  if (!entry || entry.header.size > SOURCE_MAX_BYTES) throw new Error('The towns source is not what was expected');
  return entry.getData().toString('utf8');
}

// Written aside then renamed: a listing never reads half a file.
function store(id, json) {
  fs.mkdirSync(dirOf(), { recursive: true });
  const tmp = `${fileOf(id)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(json));
  fs.renameSync(tmp, fileOf(id));
}

// One download at a time: two cards validated together share it.
let pending = null;
let pendingTowns = null;

// The towns are a bonus to the map, not its condition: a source that fails
// leaves the subdivisions drawn, and a later card can add the towns.
async function installTowns(country, label, fetchImpl) {
  try {
    if (!pendingTowns) pendingTowns = downloadTowns(fetchImpl).finally(() => { pendingTowns = null; });
    const towns = buildTowns(await pendingTowns, country);
    if (!towns) return null;
    store(townsIdOf(country), { country, label: `${countryOf(label)} — towns`, towns });
    return townsIdOf(country);
  } catch {
    return null; /* the subdivisions stay; the towns can be added by a later card */
  }
}

/**
 * Downloads the sources, builds the country's subdivisions and towns and
 * stores them. What was already added is kept: a map added before its towns
 * existed only gets its towns.
 * @returns {Promise<{ value: string, label: string, country: string, towns: string|null }>}
 */
async function installBaseMap(rawCountry, { fetchImpl = fetch } = {}) {
  const country = normalizeCountry(rawCountry);
  const refusal = refusalOf(country);
  if (refusal) throw Object.assign(new Error(refusal), { status: 400 });
  const existing = listBaseMaps().find((m) => m.country === country);
  if (existing) {
    if (existing.towns) return existing;
    return { ...existing, towns: await installTowns(country, existing.label, fetchImpl) };
  }
  if (!pending) pending = downloadSource(fetchImpl).finally(() => { pending = null; });
  const source = await pending;
  const map = buildSubdivisions(source, country);
  if (!map) throw Object.assign(new Error(`The map source has no subdivisions for ${country}`), { status: 404 });
  store(idOf(country), map);
  return { value: idOf(country), label: map.label, country, towns: await installTowns(country, map.label, fetchImpl) };
}

module.exports = { listBaseMaps, listMapLayers, readBaseMap, installBaseMap, refusalOf, normalizeCountry, SOURCE_URL, TOWNS_URL };
