// Writing a model's glossary through the API (scope `glossary`): a catalog
// keeps the vocabulary in sync both ways. Guarded here: the scope gates, the
// token's owner needs the browser's right to document the model, `replace`
// can remove synonyms where `add` only adds, roles never move, what is cut is
// said, and every path that writes a description or synonyms dates the field.
const request = require('supertest');
const { buildApp, seedUser, seedDatasource, seedModel, seedReport, db } = require('./helpers/testApp');
const apiToken = require('../utils/apiToken');
const settings = require('../utils/settingsHelper');

const app = buildApp();

const MEASURES = [
  { name: 'calls', table: 'items', column: 'id', aggregation: 'count', label: 'Calls', synonyms: ['appels', 'volume'], role: 'support.satisfaction', description: 'Calls received' },
  { name: 'lost', table: 'items', column: 'id', aggregation: 'count', label: 'Lost' },
];

let owner; let stranger; let model; let token; let strangerToken; let metadataToken;
const bearer = (t) => ({ Authorization: `Bearer ${t}` });
const put = (body, t = token, id = model) => request(app).put(`/api/v1/metadata/models/${id}/glossary`).set(bearer(t)).send(body);
const fieldsOf = (id = model) => {
  const row = db.prepare('SELECT measures, dimensions FROM models WHERE id = ?').get(id);
  return [...JSON.parse(row.dimensions), ...JSON.parse(row.measures)];
};
const field = (name, id) => fieldsOf(id).find((f) => f.name === name);

beforeAll(() => {
  settings.setApiEnabled(true);
  settings.setApiMinRole('viewer');
  owner = seedUser({ role: 'editor' });
  stranger = seedUser({ role: 'editor' });
  model = seedModel({ userId: owner, datasourceId: seedDatasource({ userId: owner }), measures: MEASURES });
  token = apiToken.create({ userId: owner, name: 'om-sync', scopes: ['glossary'] }).token;
  strangerToken = apiToken.create({ userId: stranger, name: 's', scopes: ['glossary'] }).token;
  metadataToken = apiToken.create({ userId: owner, name: 'm', scopes: ['metadata'] }).token;
});

test('the glossary scope gates the write; metadata stays read-only', async () => {
  expect((await put({ fields: { lost: { description: 'x' } } }, metadataToken)).status).toBe(403);
  expect(field('lost').description).toBeUndefined();
});

test('only a model the token\'s owner may document in the browser', async () => {
  const res = await put({ fields: { lost: { description: 'x' } } }, strangerToken);
  expect(res.status).toBe(404);
  expect(field('lost').description).toBeUndefined();
});

test('add keeps the synonyms the field had; replace sets them, so one can be removed', async () => {
  const added = await put({ fields: { calls: { synonyms: ['calls in'] } } });
  expect(added.status).toBe(200);
  expect(field('calls').synonyms).toEqual(['appels', 'volume', 'calls in']);

  const replaced = await put({ synonyms_mode: 'replace', fields: { calls: { synonyms: ['appels', 'appels reçus'] } } });
  expect(replaced.body.changed).toEqual([expect.objectContaining({ name: 'calls', kind: 'measure', synonyms: ['appels', 'appels reçus'] })]);
  expect(field('calls').synonyms).toEqual(['appels', 'appels reçus']);
  // Description untouched when not given.
  expect(field('calls').description).toBe('Calls received');
});

test('a role in the patch is ignored and said; the field keeps its own', async () => {
  const res = await put({ fields: { calls: { role: 'support.first_response_time', description: 'Inbound calls' } } });
  expect(field('calls').role).toBe('support.satisfaction');
  expect(field('calls').description).toBe('Inbound calls');
  expect(res.body.errors.join(' ')).toMatch(/role ignored/);
});

test('what does not fit is said, an unknown field too, and nothing is claimed for them', async () => {
  const res = await put({
    synonyms_mode: 'replace',
    fields: {
      lost: { description: 'L'.repeat(250), synonyms: ['a'.repeat(60), 'perdus'] },
      nope: { description: 'x' },
    },
  });
  const errors = res.body.errors.join(' | ');
  expect(errors).toMatch(/lost: description cut to 200/);
  expect(errors).toMatch(/cut to 40 characters/);
  expect(errors).toMatch(/nope: not a field of the model/);
  expect(field('lost').description).toHaveLength(200);
  expect(res.body.changed.map((c) => c.name)).toEqual(['lost']);
});

test('null clears description and synonyms, never the role', async () => {
  await put({ fields: { calls: null } });
  const f = field('calls');
  expect(f.description).toBeUndefined();
  expect(f.synonyms).toBeUndefined();
  expect(f.role).toBe('support.satisfaction');
});

describe('glossary_updated_at', () => {
  const ISO = /^\d{4}-\d{2}-\d{2}T/;

  test('set by the API, unchanged when the text does not change', async () => {
    await put({ fields: { lost: { description: 'Lost calls' } } });
    const at = field('lost').glossaryUpdatedAt;
    expect(at).toMatch(ISO);
    const again = await put({ fields: { lost: { description: 'Lost calls' } } });
    expect(again.body.changed).toEqual([]);
    expect(field('lost').glossaryUpdatedAt).toBe(at);
  });

  test('exposed on /metadata/models, null for a field never documented', async () => {
    const m2 = seedModel({ userId: owner, datasourceId: seedDatasource({ userId: owner }) });
    const res = await request(app).get(`/api/v1/metadata/models/${m2}`).set(bearer(metadataToken));
    expect(res.body.model.measures[0].glossary_updated_at).toBeNull();
    const full = await request(app).get(`/api/v1/metadata/models/${model}`).set(bearer(metadataToken));
    expect(full.body.model.measures.find((m) => m.name === 'lost').glossary_updated_at).toMatch(ISO);
  });

  test('set by the browser\'s glossary patch (Let\'s Talk, the assistant)', async () => {
    const m = seedModel({ userId: owner, datasourceId: seedDatasource({ userId: owner }) });
    await request(app).put(`/api/models/${m}/glossary`).set('x-test-user', owner).send({ fields: { 'items.amt_sum': { synonyms: ['revenue'] } } });
    expect(field('items.amt_sum', m).glossaryUpdatedAt).toMatch(ISO);
  });

  test('set by the model editor when, and only when, the text changes — never taken from the request', async () => {
    const m = seedModel({ userId: owner, datasourceId: seedDatasource({ userId: owner }) });
    const save = (meas) => request(app).put(`/api/models/${m}`).set('x-test-user', owner).send({ measures: meas });
    const base = { name: 'items.amt_sum', table: 'items', column: 'amt', aggregation: 'sum', label: 'amt' };
    await save([{ ...base, glossaryUpdatedAt: '1999-01-01T00:00:00.000Z' }]);
    expect(field('items.amt_sum', m).glossaryUpdatedAt).toBeUndefined();
    await save([{ ...base, description: 'Amount sold' }]);
    const at = field('items.amt_sum', m).glossaryUpdatedAt;
    expect(at).toMatch(ISO);
    // A save that changes something else keeps the date.
    await save([{ ...field('items.amt_sum', m), label: 'Amount' }]);
    expect(field('items.amt_sum', m).glossaryUpdatedAt).toBe(at);
  });

  test('set by a YAML import and by a report migrated onto the model', async () => {
    const ds = seedDatasource({ userId: owner });
    const src = seedModel({ userId: owner, datasourceId: ds });
    db.prepare('UPDATE models SET dimensions = ? WHERE id = ?')
      .run(JSON.stringify([{ name: 'items.label', table: 'items', column: 'label', type: 'string', label: 'label', description: 'The label' }]), src);
    const exported = await request(app).get(`/api/models/${src}/export`).set('x-test-user', owner);
    const yaml = exported.text.replace(/^name: .*$/m, 'name: glossary-import');
    const imported = await request(app).post('/api/models/import').set('x-test-user', owner).send({ yaml, datasourceId: ds });
    expect(imported.status).toBe(201);
    expect(field('items.label', imported.body.model.id).glossaryUpdatedAt).toMatch(ISO);
    expect(field('items.amt_sum', imported.body.model.id).glossaryUpdatedAt).toBeUndefined();

    const m = seedModel({ userId: owner, datasourceId: ds });
    const report = seedReport({ userId: owner, modelId: m, settings: { extraMeasures: [{ name: '_calc.x', table: 'items', column: 'amt', aggregation: 'sum', label: 'X', description: 'From the report' }] } });
    await request(app).post(`/api/reports/${report}/move-fields-to-model`).set('x-test-user', owner);
    expect(field('_calc.x', m).glossaryUpdatedAt).toMatch(ISO);
  });
});
