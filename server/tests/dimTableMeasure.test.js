// A measure on a dimension table (utils/sqlBuilder/dimMeasure.js): a product's
// reorder threshold, in a visual grouped by the fact's fields. It used to be one
// scalar total over the whole table (Karim's 60.22 next to every product);
// summed through the fact join it would count the product once per movement.
// Each group reads the distinct dimension rows its fact rows reach. The SQL is
// run on DuckDB to check the figures, not only its shape.
const request = require('supertest');
const { buildApp, seedUser, seedDatasource, seedModel, seedReport } = require('./helpers/testApp');

const app = buildApp();
beforeAll(() => { jest.spyOn(console, 'warn').mockImplementation(() => {}); });
afterAll(() => { jest.restoreAllMocks(); });

const DIMENSIONS = [
  { name: 'moves.wh', table: 'moves', column: 'wh', type: 'string', label: 'Warehouse' },
  { name: 'moves.product', table: 'moves', column: 'product', type: 'string', label: 'Product' },
  { name: 'thresholds.family', table: 'thresholds', column: 'family', type: 'string', label: 'Family' },
];
const MEASURES = [
  { name: 'moves.qty_sum', table: 'moves', column: 'qty', aggregation: 'sum', label: 'Qty' },
  { name: 'thresholds.min_sum', table: 'thresholds', column: 'min_stock', aggregation: 'sum', label: 'Min (sum)' },
  { name: 'thresholds.min_avg', table: 'thresholds', column: 'min_stock', aggregation: 'avg', label: 'Min (avg)' },
  { name: 'thresholds.min_count', table: 'thresholds', column: 'min_stock', aggregation: 'count', label: 'Min (count)' },
  { name: 'gap', table: '', column: '', aggregation: 'custom', expression: '(${moves.qty_sum}) - (${thresholds.min_sum})', label: 'Gap' },
];
const JOINS = [{ from_table: 'moves', from_column: 'sku', to_table: 'thresholds', to_column: 'sku', cardinality: { from: '*', to: '1' } }];

// P1 (min 10) moves three times in A; P2 (min 30) once in A, once in B; P3 (min 50) and P4 (min 5, family F1) never move.
const MOVES = [['A', 'S1', 'P1', 1], ['A', 'S1', 'P1', 2], ['A', 'S1', 'P1', 3], ['A', 'S2', 'P2', 4], ['B', 'S2', 'P2', 5]];
const THRESHOLDS = [['S1', 'F1', 10], ['S2', 'F1', 30], ['S3', 'F2', 50], ['S4', 'F1', 5]];

let owner; let pgModel; let duckModel;
beforeAll(() => {
  owner = seedUser({ role: 'editor' });
  const shape = { selectedTables: ['moves', 'thresholds'], measures: MEASURES, dimensions: DIMENSIONS, joins: JOINS };
  pgModel = seedModel({ userId: owner, datasourceId: seedDatasource({ userId: owner, dbType: 'postgres' }), ...shape });
  duckModel = seedModel({ userId: owner, datasourceId: seedDatasource({ userId: owner, dbType: 'duckdb' }), ...shape });
});

async function sqlFor(model, body) {
  const res = await request(app).post(`/api/models/${model}/query`).set('x-test-user', owner).send({ ...body, sqlOnly: true });
  expect(res.status).toBe(200);
  return res.body.sql;
}

// Run on an in-memory DuckDB in a child process, as lastValueMeasure.test.js does.
function run(sql) {
  const script = `
    const duckdb = require(${JSON.stringify(require.resolve('duckdb-async'))});
    (async () => {
      const d = await duckdb.Database.create(':memory:');
      await d.run('CREATE TABLE moves (wh VARCHAR, sku VARCHAR, product VARCHAR, qty INTEGER)');
      await d.run('CREATE TABLE thresholds (sku VARCHAR, family VARCHAR, min_stock INTEGER)');
      for (const [w, s, p, q] of ${JSON.stringify(MOVES)}) await d.run(\`INSERT INTO moves VALUES ('\${w}', '\${s}', '\${p}', \${q})\`);
      for (const [s, f, m] of ${JSON.stringify(THRESHOLDS)}) await d.run(\`INSERT INTO thresholds VALUES ('\${s}', '\${f}', \${m})\`);
      const rows = await d.all(${JSON.stringify(sql)});
      process.stdout.write(JSON.stringify(rows, (k, v) => (typeof v === 'bigint' ? Number(v) : v)));
      await d.close();
    })();`;
  return JSON.parse(require('child_process').execFileSync(process.execPath, ['-e', script]).toString());
}
const figures = (rows, key, value) => Object.fromEntries(rows.map((r) => [r[key], Number(r[value])]));

describe('a dimension-table measure grouped by the fact', () => {
  test('each product reads its own threshold, not the average of the file', async () => {
    const rows = run(await sqlFor(duckModel, { dimensionNames: ['moves.product'], measureNames: ['thresholds.min_avg', 'moves.qty_sum'] }));
    expect(figures(rows, 'Product', 'Min (avg)')).toEqual({ P1: 10, P2: 30 });
    expect(figures(rows, 'Product', 'Qty')).toEqual({ P1: 6, P2: 9 });
  });

  test('a warehouse sums each product it carries once, however often it moved', async () => {
    const rows = run(await sqlFor(duckModel, { dimensionNames: ['moves.wh'], measureNames: ['thresholds.min_sum', 'thresholds.min_count'] }));
    expect(figures(rows, 'Warehouse', 'Min (sum)')).toEqual({ A: 40, B: 30 });
    expect(figures(rows, 'Warehouse', 'Min (count)')).toEqual({ A: 2, B: 1 });
  });

  test('the visual\'s filters choose the rows the groups reach', async () => {
    const rows = run(await sqlFor(duckModel, {
      dimensionNames: ['thresholds.family'], measureNames: ['thresholds.min_sum'],
      widgetFilters: [{ field: 'moves.wh', op: 'eq', value: 'B', values: ['B'] }],
    }));
    expect(figures(rows, 'Family', 'Min (sum)')).toEqual({ F1: 30 });
  });

  test('referenced from an expression, each product still reads its own threshold once', async () => {
    // Through the join the threshold was counted once per movement (Karim: −5 919 instead of 1 389).
    const rows = run(await sqlFor(duckModel, { dimensionNames: ['moves.product'], measureNames: ['gap'] }));
    expect(figures(rows, 'Product', 'Gap')).toEqual({ P1: -4, P2: -21 });
    // Without a grouping, the table's total, as the measure alone reads it:
    // P3 and P4 never moved and are under their threshold all the same (it read 15 − 40).
    const total = run(await sqlFor(duckModel, { dimensionNames: [], measureNames: ['gap', 'moves.qty_sum'] }));
    expect(Number(total[0].Gap)).toBe(15 - 95);
    // Filtered on a fact's field, the products are those the facts reach.
    const inB = run(await sqlFor(duckModel, { dimensionNames: [], measureNames: ['gap'], widgetFilters: [{ field: 'moves.wh', op: 'eq', value: 'B', values: ['B'] }] }));
    expect(Number(inB[0].Gap)).toBe(5 - 30);
  });

  test('grouped by the fields of its own table, it reads every row of the group, not only those the facts reach', async () => {
    // An insurer's premiums by product: every contract's, not only the contracts with a claim.
    const rows = run(await sqlFor(duckModel, { dimensionNames: ['thresholds.family'], measureNames: ['gap', 'thresholds.min_sum'] }));
    // F1 counts P4, which never moved; F2 had no movement at all, so no row.
    expect(figures(rows, 'Family', 'Min (sum)')).toEqual({ F1: 45 });
    expect(figures(rows, 'Family', 'Gap')).toEqual({ F1: 15 - 45 });
  });

  test('without a grouping it stays the total of the table', async () => {
    const sql = await sqlFor(pgModel, { dimensionNames: [], measureNames: ['thresholds.min_sum'] });
    expect(sql).toMatch(/^SELECT \(SELECT SUM\("thresholds"\."min_stock"\) FROM "thresholds"\)/);
    expect(figures(run(await sqlFor(duckModel, { dimensionNames: [], measureNames: ['thresholds.min_sum'] })), 'Min (sum)', 'Min (sum)')).toEqual({ 95: 95 });
  });

  test('the per-group read is a join of the main query, one row per group', async () => {
    const sql = await sqlFor(pgModel, { dimensionNames: ['moves.wh'], measureNames: ['thresholds.min_sum'] });
    expect(sql).toMatch(/LEFT JOIN \(SELECT "__g0", SUM\("__v"\) AS "__v" FROM \(SELECT DISTINCT "moves"\."wh" AS "__g0", "thresholds"\."sku" AS "__k0"/);
    expect(sql).toMatch(/MAX\("__dm\d+"\."__v"\) AS "Min \(sum\)"/);
    expect(sql).not.toMatch(/\(SELECT SUM\("thresholds"\."min_stock"\) FROM "thresholds"\)/);
  });
});

// A reader under row-level security: the table's total ignored their rule (a
// leak), the join path counted each threshold once per movement. They get the
// distinct rows their own query reaches — same FROM, same WHERE, RLS clause
// included — grouped or not.
describe('a dimension-table measure under row-level security', () => {
  let viewer; let secured; let unreachable;
  const RLS = { enabled: true, table: 'moves', primaryKey: 'wh', rules: { A: ['v@dim.io'] } };
  beforeAll(() => {
    viewer = seedUser({ role: 'viewer', email: 'v@dim.io' });
    const ds = seedDatasource({ userId: owner, dbType: 'duckdb' });
    secured = seedModel({
      userId: owner, datasourceId: ds, selectedTables: ['moves', 'thresholds'], dimensions: DIMENSIONS, joins: JOINS, rls: RLS,
      measures: [...MEASURES, { name: 'thresholds.calc', table: '', column: '', aggregation: 'custom', label: 'Calc', expression: 'SUM("thresholds"."min_stock")' }],
    });
    seedReport({ userId: owner, modelId: secured, isPublic: 1 });
    // The rule sits on a table the thresholds cannot be reached from.
    unreachable = seedModel({
      userId: owner, datasourceId: ds, selectedTables: ['moves', 'thresholds', 'zones'], dimensions: DIMENSIONS, joins: JOINS, measures: MEASURES,
      rls: { enabled: true, table: 'zones', primaryKey: 'z', rules: { A: ['v@dim.io'] } },
    });
    seedReport({ userId: owner, modelId: unreachable, isPublic: 1 });
  });
  const viewerSql = async (model, body) => {
    const res = await request(app).post(`/api/models/${model}/query`).set('x-test-user', viewer).send({ ...body, sqlOnly: true });
    expect(res.status).toBe(200);
    return res.body.sql;
  };

  test('grouped, each product of their warehouse reads its own threshold once', async () => {
    const sql = await viewerSql(secured, { dimensionNames: ['moves.product'], measureNames: ['thresholds.min_sum'] });
    expect(sql).toContain("'A'");
    expect(figures(run(sql), 'Product', 'Min (sum)')).toEqual({ P1: 10, P2: 30 });
  });

  test('ungrouped, the thresholds their rule reaches — never the table\'s total', async () => {
    const sql = await viewerSql(secured, { dimensionNames: [], measureNames: ['thresholds.min_sum'] });
    expect(sql).not.toMatch(/\(SELECT SUM\("thresholds"\."min_stock"\) FROM "thresholds"\)/);
    expect(run(sql)[0]['Min (sum)']).toBe(40);
  });

  test('a measure that cannot be read on distinct rows stays on the filtered join', async () => {
    const sql = await viewerSql(secured, { dimensionNames: ['moves.product'], measureNames: ['thresholds.calc'] });
    expect(sql).not.toMatch(/FROM "thresholds"\)/);
    expect(sql).toContain("'A'");
  });

  test('a measure table the rule cannot reach denies every row', async () => {
    const sql = await viewerSql(unreachable, { dimensionNames: ['moves.product'], measureNames: ['thresholds.min_sum'] });
    expect(sql).toMatch(/1 = 0/);
  });
});
