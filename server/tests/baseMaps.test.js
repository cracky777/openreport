// A map asked of places no base map draws (Jonathan, drilling the world map
// into the United States: "c'est l'IA de Let's Talk qui doit proposer de la
// créer"): the assistant hands over an add_map card instead of a chart; the
// user's click makes that country's states from a fixed public source, stored
// for the whole instance, and the request comes back to be drawn.
jest.mock('../utils/ai/providers', () => ({
  ...jest.requireActual('../utils/ai/providers'),
  chat: jest.fn(),
}));
jest.mock('../utils/ai/cardinality', () => ({ dimensionCardinality: jest.fn() }));

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const providers = require('../utils/ai/providers');
const { dimensionCardinality } = require('../utils/ai/cardinality');
const { setAiConfig } = require('../utils/settingsHelper');
const { buildSubdivisions } = require('../utils/geo/subdivisions');
const AdmZip = require('adm-zip');
const { listBaseMaps, SOURCE_URL, TOWNS_URL } = require('../utils/geo/baseMaps');
const { buildTowns } = require('../utils/geo/towns');
const { validateActionProposal, ACTIONS_FOR } = require('../utils/ai/actions');
const { buildApp, seedUser, seedDatasource, seedModel } = require('./helpers/testApp');

const square = (x, y, size = 2) => [[[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]]];
const feature = (props, coordinates, type = 'Polygon') => ({ type: 'Feature', properties: { iso_a2: 'US', admin: 'United States of America', type_en: 'State', ...props }, geometry: { type, coordinates } });
// Natural Earth's shape: California, Alaska across the antimeridian, Hawaii, and a Canadian province.
const SOURCE = {
  type: 'FeatureCollection',
  features: [
    feature({ name: 'California', name_fr: 'Californie', name_de: 'Kalifornien', postal: 'CA', iso_3166_2: 'US-CA', name_alt: 'CA|Calif.' }, square(-122, 34)),
    feature({ name: 'Alaska', postal: 'AK', iso_3166_2: 'US-AK' }, [square(-150, 60, 4), square(172, 52, 1)], 'MultiPolygon'),
    feature({ name: 'Hawaii', postal: 'HI', iso_3166_2: 'US-HI' }, square(-157, 20)),
    feature({ name: 'Quebec', iso_a2: 'CA', admin: 'Canada', type_en: 'Province', postal: 'QC' }, square(-72, 47)),
  ],
};

// GeoNames cities500: geonameid, name, asciiname, alternatenames, lat, lon, class, code, country, …, population (col 14).
const town = (name, alternates, lat, lon, country, population) => [1, name, name, alternates, lat, lon, 'P', 'PPL', country, '', '', '', '', '', population].join('\t');
const TOWNS = [
  town('Los Angeles', 'LA,Lungsod ng Los Angeles,Лос-Анджелес', 34.05, -118.24, 'US', 3971883),
  town('Springfield', '', 39.8, -89.64, 'US', 116250),
  town('Springfield', '', 42.1, -72.59, 'US', 155929),
  town('Montréal', 'Montreal', 45.5, -73.57, 'CA', 1600000),
].join('\n');
const townsZip = () => { const zip = new AdmZip(); zip.addFile('cities500.txt', Buffer.from(TOWNS)); return zip.toBuffer(); };
const sources = (url) => (url === TOWNS_URL
  ? { ok: true, status: 200, arrayBuffer: async () => townsZip() }
  : { ok: true, status: 200, text: async () => JSON.stringify(SOURCE) });

const longitudes = (map) => map.features.flatMap((f) => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates)).flatMap((p) => p[0].map(([x]) => x));

describe('the subdivisions of a country, as a base map', () => {
  test('one country, every name a place column may hold, named after the country and its kind', () => {
    const us = buildSubdivisions(SOURCE, 'us');
    expect(us.label).toBe('United States of America — states');
    expect(us.features.map((f) => f.properties.name)).toEqual(['California', 'Alaska', 'Hawaii']);
    expect(us.features[0].properties.names).toEqual(expect.arrayContaining(['California', 'Californie', 'Kalifornien', 'CA', 'US-CA', 'Calif.']));
    expect(buildSubdivisions(SOURCE, 'CA').label).toBe('Canada — provinces');
    expect(buildSubdivisions(SOURCE, 'DE')).toBeNull();
  });

  test('the Aleutians are brought back across the antimeridian, Alaska and Hawaii moved beside the mainland', () => {
    const us = buildSubdivisions(SOURCE, 'US');
    const xs = longitudes(us);
    // Otherwise the map spans the whole globe and the states are drawn tiny.
    expect(Math.max(...xs)).toBeLessThan(0);
    expect(Math.min(...xs)).toBeCloseTo(-188, 0);
    expect(Object.keys(us.specialAreas)).toEqual(['Alaska', 'Hawaii']);
    expect(buildSubdivisions(SOURCE, 'CA').specialAreas).toBeUndefined();
  });
});

describe('the towns of a country, as bubbles', () => {
  test('one country, most populated first, with the names a place column may hold in a Latin script', () => {
    const us = buildTowns(TOWNS, 'us');
    expect(us.map((t) => t[0])).toEqual(['Los Angeles', 'Springfield', 'Springfield']);
    expect(us[0]).toEqual(['Los Angeles', '', -118.24, 34.05, 3971883, ['LA', 'Lungsod ng Los Angeles']]);
    expect(us[1][4]).toBe(155929);
    expect(buildTowns(TOWNS, 'CA')[0][5]).toEqual([]);
    expect(buildTowns(TOWNS, 'DE')).toBeNull();
  });
});

describe('the add_map card', () => {
  test('offered without being asked to do anything (it does nothing until clicked), for a country by its ISO code', () => {
    const { action, errors } = validateActionProposal({ action: 'add_map', country: 'us', userAsked: 'how', summary: 'A map of the states', request: 'Revenue by state on a map' }, { allowed: ACTIONS_FOR.ask });
    expect(errors).toEqual([]);
    expect(action).toEqual({ action: 'add_map', country: 'US', summary: 'A map of the states', request: 'Revenue by state on a map' });
    expect(ACTIONS_FOR.editor).toContain('add_map');
  });

  test('never for France, which ships its own, a code that is not one, or a map already added', () => {
    const allowed = ACTIONS_FOR.ask;
    expect(validateActionProposal({ action: 'add_map', country: 'FR' }, { allowed }).action).toBeNull();
    expect(validateActionProposal({ action: 'add_map', country: 'USA' }, { allowed }).action).toBeNull();
    const added = validateActionProposal({ action: 'add_map', country: 'US' }, { allowed, baseMaps: [{ value: 'admin1-us', label: 'United States of America — states', country: 'US', towns: 'towns-us' }] });
    expect(added.action).toBeNull();
    expect(added.errors[0]).toMatch(/already there/);
  });

  test('offered again for a map added before its towns existed: the card adds them', () => {
    // Luxembourg's districts drew three grey shapes for a column of towns.
    const { action } = validateActionProposal({ action: 'add_map', country: 'US' }, { allowed: ACTIONS_FOR.ask, baseMaps: [{ value: 'admin1-us', label: 'United States of America — states', country: 'US', towns: null }] });
    expect(action).toMatchObject({ action: 'add_map', country: 'US' });
  });
});

describe('from the card to the map', () => {
  const app = buildApp();
  let user, model;
  beforeAll(() => {
    user = seedUser({ role: 'editor' });
    model = seedModel({ userId: user, datasourceId: seedDatasource({ userId: user }) });
  });
  beforeEach(() => {
    providers.chat.mockReset();
    dimensionCardinality.mockResolvedValue({});
    setAiConfig({ provider: 'openai-compat', baseUrl: 'http://llm.test/v1', model: 'm', enabled: true, dataSharing: 'schema+cache' });
  });
  afterEach(() => jest.restoreAllMocks());

  test("the assistant hands over the card; the click downloads the fixed source once, and the map is listed and served to everyone", async () => {
    providers.chat.mockResolvedValueOnce({ text: 'Open Report has no map of the US states yet.', toolCalls: [{ id: 'c1', name: 'propose_action', args: { userAsked: 'do', action: 'add_map', country: 'US', summary: 'Create a map of the US states', request: 'Revenue by US state on a map' } }], usage: null });
    const chat = await request(app).post(`/api/ai/models/${model}/chat`).set('x-test-user', user)
      .send({ messages: [{ role: 'user', text: 'Drill into the United States by state' }], talk: true });
    expect(chat.body.proposals[0]).toMatchObject({ kind: 'action', action: 'add_map', country: 'US' });
    // The tool and the prompt both tell the assistant about the card.
    const [{ tools, system }] = providers.chat.mock.calls[0];
    expect(tools.find((t) => t.name === 'propose_action').parameters.properties.action.enum).toContain('add_map');
    expect(system).toContain('Base maps the map visual draws: world — countries; France');

    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (url) => sources(url));
    const made = await request(app).post('/api/ai/maps').set('x-test-user', user).send({ country: 'us' });
    expect(made.status).toBe(200);
    expect(made.body.map).toEqual({ value: 'admin1-us', label: 'United States of America — states', country: 'US', towns: 'towns-us' });
    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([SOURCE_URL, TOWNS_URL]);

    // Added again: nothing downloaded.
    await request(app).post('/api/ai/maps').set('x-test-user', user).send({ country: 'US' });
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    const viewer = seedUser({ role: 'viewer' });
    expect((await request(app).get('/api/geo/maps').set('x-test-user', viewer)).body.maps).toEqual([
      { value: 'admin1-us', label: 'United States of America — states', kind: 'areas' },
      { value: 'towns-us', label: 'United States of America — towns', kind: 'points', base: 'admin1-us' },
    ]);
    const served = await request(app).get('/api/geo/maps/admin1-us').set('x-test-user', viewer);
    expect(JSON.parse(served.text).features).toHaveLength(3);
    const towns = await request(app).get('/api/geo/maps/towns-us').set('x-test-user', viewer);
    expect(JSON.parse(towns.text).towns).toHaveLength(3);
    expect((await request(app).get('/api/geo/maps/..%2Fopen-report.db').set('x-test-user', viewer)).status).toBe(404);

    // The next turn knows it: the prompt lists it, a second card is refused.
    providers.chat.mockResolvedValueOnce({ text: 'Here it is.', toolCalls: [], usage: null });
    await request(app).post(`/api/ai/models/${model}/chat`).set('x-test-user', user)
      .send({ messages: [{ role: 'user', text: 'Go on' }], talk: true });
    expect(providers.chat.mock.calls[1][0].system).toContain('United States of America — states, towns');

    // A map added before its towns existed gets them from the next card, the subdivisions kept.
    fs.rmSync(path.join(process.env.OPENREPORT_DATA_DIR, 'geo', 'towns-us.json'));
    expect(listBaseMaps()[0].towns).toBeNull();
    const again = await request(app).post('/api/ai/maps').set('x-test-user', user).send({ country: 'US' });
    expect(again.body.map.towns).toBe('towns-us');
    expect(fetchSpy.mock.calls.slice(2).map(([url]) => url)).toEqual([TOWNS_URL]);

    fs.rmSync(path.join(process.env.OPENREPORT_DATA_DIR, 'geo'), { recursive: true, force: true });
    expect(listBaseMaps()).toEqual([]);
  });

  test('only for whoever the assistant answers; a source that fails says so without its details', async () => {
    const user2 = seedUser({ role: 'editor' });
    setAiConfig({ enabled: false });
    expect((await request(app).post('/api/ai/maps').set('x-test-user', user2).send({ country: 'DE' })).status).toBe(403);
    setAiConfig({ provider: 'openai-compat', baseUrl: 'http://llm.test/v1', model: 'm', enabled: true, dataSharing: 'schema+cache' });
    expect((await request(app).post('/api/ai/maps').set('x-test-user', user2).send({ country: 'FR' })).status).toBe(400);
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 503, text: async () => '' });
    const failed = await request(app).post('/api/ai/maps').set('x-test-user', user2).send({ country: 'DE' });
    expect(failed.status).toBe(502);
    expect(failed.body.error).toBe('The map could not be downloaded. Try again later.');
  });
});
