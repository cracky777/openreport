const request = require('supertest');
const { v4: uuid } = require('uuid');
const { buildApp, seedUser, seedDatasource, seedModel, db } = require('./helpers/testApp');
const rollupBuilder = require('../utils/rollupBuilder');

const app = buildApp();
beforeAll(() => { jest.spyOn(console, 'warn').mockImplementation(() => {}); });
afterAll(() => { jest.restoreAllMocks(); });

// Editing a model's logical shape (dims / measures / RLS / formats) must drop
// every materialised rollup for it — otherwise the next visual could be served
// pre-aggregated rows built against the OLD shape (wrong numbers). We exercise
// the manifest side (no live DuckDB needed): dropAllRollups clears the rollups
// rows, and PUT /models/:id wires it in.
function seedRollupRow(modelId) {
  db.prepare(`INSERT INTO rollups (id, model_id, storage_mode, grain_hash, grain_dims, measures, table_name)
              VALUES (?,?,?,?,?,?,?)`)
    .run(uuid(), modelId, 'duckdb', `h-${uuid().slice(0, 8)}`, '[]', '{}', `rollups_${modelId.slice(0, 6)}_g1`);
}
const rollupCount = (modelId) => db.prepare('SELECT COUNT(*) c FROM rollups WHERE model_id = ?').get(modelId).c;

describe('rollup invalidation on model change', () => {
  test('dropAllRollups clears every manifest row for the model', async () => {
    const owner = seedUser({ role: 'editor' });
    const model = seedModel({ userId: owner, datasourceId: seedDatasource({ userId: owner }) });
    seedRollupRow(model); seedRollupRow(model);
    expect(rollupCount(model)).toBe(2);

    const r = await rollupBuilder.dropAllRollups({ modelId: model, orgId: null });
    expect(rollupCount(model)).toBe(0);
    expect(r.droppedCount).toBe(2);
  });

  test("another model's rollups are left untouched", async () => {
    const owner = seedUser({ role: 'editor' });
    const ds = seedDatasource({ userId: owner });
    const a = seedModel({ userId: owner, datasourceId: ds });
    const b = seedModel({ userId: owner, datasourceId: ds });
    seedRollupRow(a); seedRollupRow(b);

    await rollupBuilder.dropAllRollups({ modelId: a, orgId: null });
    expect(rollupCount(a)).toBe(0);
    expect(rollupCount(b)).toBe(1);
  });

  test('PUT /models/:id invalidates the model rollups', async () => {
    const owner = seedUser({ role: 'editor' });
    const model = seedModel({ userId: owner, datasourceId: seedDatasource({ userId: owner }) });
    seedRollupRow(model);
    expect(rollupCount(model)).toBe(1);

    const res = await request(app).put(`/api/models/${model}`).set('x-test-user', owner).send({ name: 'renamed' });
    expect(res.status).toBe(200);

    // The invalidation is fire-and-forget (manifest DELETE + DuckDB drop run in
    // the background) — poll briefly until the manifest is cleared.
    for (let i = 0; i < 50 && rollupCount(model) > 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(rollupCount(model)).toBe(0);
  });
});
