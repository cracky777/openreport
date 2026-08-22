// Per-measure time variants: measureNames may carry "<base>@@tp:<preset>"
// entries, resolved by the request's `timeVariants` map into a date dim +
// concrete window. The server compiles each valid variant as a filtered
// copy of its base (CASE WHEN window) and 400s on anything unresolvable —
// never silently serving the unwindowed base under the variant's name.
const request = require('supertest');
const { buildApp, seedUser, seedDatasource, seedModel } = require('./helpers/testApp');

const app = buildApp();

const DIMS = [
  { name: 'items.label', table: 'items', column: 'label', type: 'string', label: 'label' },
  { name: 'items.d', table: 'items', column: 'd', type: 'date', label: 'Date' },
];
const MEASURES = [
  { name: 'items.amt_sum', table: 'items', column: 'amt', aggregation: 'sum', label: 'total' },
];
const V = 'items.amt_sum@@tp:ytd';
const RANGE = ['2026-01-01', '2026-08-22'];

function seed() {
  const owner = seedUser({ role: 'editor' });
  const ds = seedDatasource({ userId: owner, dbType: 'postgres' });
  const model = seedModel({ userId: owner, datasourceId: ds, dimensions: DIMS, measures: MEASURES });
  return { owner, model };
}

const q = (owner, model, body) => request(app)
  .post(`/api/models/${model}/query`)
  .set('x-test-user', owner)
  .send({ dimensionNames: ['items.label'], sqlOnly: true, ...body });

describe('time-variant measures', () => {
  test('variant compiles as a windowed CASE WHEN next to its base', async () => {
    const { owner, model } = seed();
    const res = await q(owner, model, {
      measureNames: ['items.amt_sum', V],
      timeVariants: { [V]: { dim: 'items.d', range: RANGE, label: 'total (YTD)' } },
    });
    expect(res.status).toBe(200);
    const sql = res.body.sql;
    expect(sql).toContain('CASE WHEN');
    expect(sql).toContain(`'${RANGE[0]}'`);
    expect(sql).toContain(`'${RANGE[1]}'`);
    expect(sql).toContain('"total (YTD)"');
    expect(sql).toContain('"total"'); // the unwindowed base stays alongside
  });

  test('variant on a custom-expression measure gets the window inside the wrap', async () => {
    const { owner, model } = seed();
    const ds = { name: 'items.calc', table: '', column: '', aggregation: 'custom', expression: 'SUM("public"."items"."amt") * 2', label: 'calc' };
    const owner2 = owner; // custom expressions must come from the model itself
    const model2 = seedModel({
      userId: owner2,
      datasourceId: require('./helpers/testApp').db.prepare('SELECT datasource_id FROM models WHERE id = ?').get(model).datasource_id,
      dimensions: DIMS,
      measures: [...MEASURES, ds],
    });
    const vc = 'items.calc@@tp:mtd';
    const res = await q(owner2, model2, {
      measureNames: [vc],
      timeVariants: { [vc]: { dim: 'items.d', range: RANGE, label: 'calc (MTD)' } },
    });
    expect(res.status).toBe(200);
    expect(res.body.sql).toContain('CASE WHEN');
    expect(res.body.sql).toContain('"calc (MTD)"');
  });

  test('variant without its timeVariants entry 400s as a missing measure', async () => {
    const { owner, model } = seed();
    const res = await q(owner, model, { measureNames: [V] });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain(V);
  });

  test('variant pointing at an unknown dim 400s instead of running unwindowed', async () => {
    const { owner, model } = seed();
    const res = await q(owner, model, {
      measureNames: [V],
      timeVariants: { [V]: { dim: 'items.nope', range: RANGE } },
    });
    expect(res.status).toBe(400);
  });

  test('malformed range (wrong arity / non-scalars / oversized) is rejected', async () => {
    const { owner, model } = seed();
    for (const range of [['2026-01-01'], [{}, {}], ['a'.repeat(65), '2026-08-22']]) {
      const res = await q(owner, model, {
        measureNames: [V],
        timeVariants: { [V]: { dim: 'items.d', range } },
      });
      expect(res.status).toBe(400);
    }
  });

  test('window bounds are quoted, not interpolated raw', async () => {
    const { owner, model } = seed();
    const evil = "2026-01-01' OR '1'='1";
    const res = await q(owner, model, {
      measureNames: [V],
      timeVariants: { [V]: { dim: 'items.d', range: [evil, '2026-08-22'] } },
    });
    // Either rejected by date parsing or emitted with the quote escaped —
    // never a raw `' OR '` breakout in the SQL.
    if (res.status === 200) {
      expect(res.body.sql).not.toContain("2026-01-01' OR '1'='1");
    }
  });
});
