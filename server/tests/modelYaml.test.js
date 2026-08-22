// Models-as-code: YAML export/import of the semantic layer. The export is
// a faithful round-trip (import(export(m)) reproduces every semantic
// field); import validates structure, resolves the datasource by explicit
// id or by name among the caller's usable sources, and refuses name
// collisions instead of overwriting.
const request = require('supertest');
const { buildApp, seedUser, seedDatasource, seedModel, db } = require('./helpers/testApp');
const { modelToYaml, yamlToModelFields } = require('../utils/modelYaml');
const { parseModel } = require('../db/modelRow');

const app = buildApp();

const DIMS = [
  { name: 'items.label', table: 'items', column: 'label', type: 'string', label: 'Label' },
  { name: 'items.d', table: 'items', column: 'd', type: 'date', label: 'Date' },
];
const MEASURES = [
  { name: 'items.amt_sum', table: 'items', column: 'amt', aggregation: 'sum', label: 'total' },
  { name: 'calc.pct', aggregation: 'custom', expression: 'SUM("public"."items"."amt") / 100', label: 'pct' },
];
const JOINS = [
  { from_table: 'dim', from_column: 'k', to_table: 'items', to_column: 'k', cardinality: { from: '1', to: '*' } },
];
const RLS = { enabled: true, table: 'items', primaryKey: 'k', rules: { FR: ['user@x.test', 'group:sales'] } };

function seedFull() {
  const owner = seedUser({ role: 'editor' });
  const ds = seedDatasource({ userId: owner });
  const model = seedModel({
    userId: owner, datasourceId: ds,
    dimensions: DIMS, measures: MEASURES, joins: JOINS, rls: RLS,
    selectedTables: ['items', 'dim'],
  });
  db.prepare("UPDATE models SET date_column = 'items.d', incremental_months = 3, column_types = ? WHERE id = ?")
    .run(JSON.stringify({ 'items.d': { type: 'date', format: 'DD/MM/YYYY' } }), model);
  return { owner, ds, model };
}

describe('modelYaml — pure round-trip', () => {
  test('import(export(m)) reproduces every semantic field', () => {
    const { model } = seedFull();
    const parsed = parseModel(db.prepare('SELECT * FROM models WHERE id = ?').get(model));
    const text = modelToYaml(parsed, 'source-name');
    const fields = yamlToModelFields(text);
    expect(fields.name).toBe(parsed.name);
    expect(fields.datasourceName).toBe('source-name');
    expect(fields.selected_tables).toEqual(parsed.selected_tables);
    expect(fields.dimensions).toEqual(parsed.dimensions);
    expect(fields.measures).toEqual(parsed.measures);
    expect(fields.joins).toEqual(parsed.joins);
    expect(fields.rls).toEqual(parsed.rls);
    expect(fields.column_types).toEqual(parsed.column_types);
    expect(fields.date_column).toBe('items.d');
    expect(fields.incremental_months).toBe(3);
  });

  test('structural validation rejects malformed documents', () => {
    expect(() => yamlToModelFields('')).toThrow(/Empty/);
    expect(() => yamlToModelFields('- just\n- a list\n')).toThrow(/mapping/);
    expect(() => yamlToModelFields('name: x\n')).toThrow(/openreport_model/);
    expect(() => yamlToModelFields('openreport_model: 1\n')).toThrow(/"name"/);
    expect(() => yamlToModelFields('openreport_model: 1\nname: x\ndimensions: [nope]\n')).toThrow(/dimensions/);
    expect(() => yamlToModelFields('openreport_model: 1\nname: x\ndimensions:\n  - table: t\n')).toThrow(/needs a "name"/);
    expect(() => yamlToModelFields('openreport_model: 1\nname: x\nincremental_months: 99\n')).toThrow(/between 1 and 60/);
  });
});

describe('GET /api/models/:id/export', () => {
  test('exports YAML with the datasource name, write access required', async () => {
    const { owner, model } = seedFull();
    const res = await request(app).get(`/api/models/${model}/export`).set('x-test-user', owner);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('yaml');
    expect(res.headers['content-disposition']).toContain('.model.yaml');
    expect(res.text).toContain('openreport_model: 1');
    expect(res.text).toContain('items.amt_sum');

    const viewer = seedUser({ role: 'viewer' });
    const denied = await request(app).get(`/api/models/${model}/export`).set('x-test-user', viewer);
    expect([401, 403]).toContain(denied.status);
  });
});

describe('POST /api/models/import', () => {
  test('imports by datasource name and round-trips through the API', async () => {
    const { owner, model } = seedFull();
    const exp = await request(app).get(`/api/models/${model}/export`).set('x-test-user', owner);
    // Same file, new name (name collision is refused), datasource resolved
    // by the name embedded in the document.
    const text = exp.text.replace(/^name: .*$/m, 'name: reimported');
    const res = await request(app).post('/api/models/import')
      .set('x-test-user', owner).send({ yaml: text });
    expect(res.status).toBe(201);
    const m = res.body.model;
    expect(m.name).toBe('reimported');
    expect(m.dimensions).toEqual(DIMS);
    expect(m.measures).toEqual(MEASURES);
    expect(m.joins).toEqual(JOINS);
    expect(m.rls).toEqual(RLS);
    expect(m.date_column).toBe('items.d');
    expect(m.incremental_months).toBe(3);
  });

  test('name collision 409s instead of overwriting', async () => {
    const { owner, model } = seedFull();
    const exp = await request(app).get(`/api/models/${model}/export`).set('x-test-user', owner);
    const res = await request(app).post('/api/models/import')
      .set('x-test-user', owner).send({ yaml: exp.text });
    expect(res.status).toBe(409);
  });

  test('unknown datasource name asks for an explicit pick; explicit id wins', async () => {
    const { owner, ds, model } = seedFull();
    const exp = await request(app).get(`/api/models/${model}/export`).set('x-test-user', owner);
    const text = exp.text
      .replace(/^name: .*$/m, 'name: imported-2')
      .replace(/^datasource: .*$/m, 'datasource: does-not-exist');
    const noDs = await request(app).post('/api/models/import')
      .set('x-test-user', owner).send({ yaml: text });
    expect(noDs.status).toBe(400);
    expect(noDs.body.needsDatasource).toBe(true);

    const withId = await request(app).post('/api/models/import')
      .set('x-test-user', owner).send({ yaml: text, datasourceId: ds });
    expect(withId.status).toBe(201);
  });

  test("a datasource the caller can't use is rejected", async () => {
    const { owner, model } = seedFull();
    const stranger = seedUser({ role: 'editor' });
    const strangerDs = seedDatasource({ userId: stranger });
    const exp = await request(app).get(`/api/models/${model}/export`).set('x-test-user', owner);
    const text = exp.text.replace(/^name: .*$/m, 'name: smuggled');
    const res = await request(app).post('/api/models/import')
      .set('x-test-user', owner).send({ yaml: text, datasourceId: strangerDs });
    expect(res.status).toBe(404);
  });

  test('incremental window without a date column is normalised away', async () => {
    const { owner, ds } = seedFull();
    const text = [
      'openreport_model: 1',
      'name: windowless',
      'tables: [items]',
      'incremental_months: 6',
    ].join('\n');
    const res = await request(app).post('/api/models/import')
      .set('x-test-user', owner).send({ yaml: text, datasourceId: ds });
    expect(res.status).toBe(201);
    expect(res.body.model.incremental_months).toBeNull();
  });
});
