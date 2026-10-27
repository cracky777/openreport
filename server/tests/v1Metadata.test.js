// The metadata API (/api/v1/metadata, scope `metadata`): what describes reports
// and their models for a catalog such as OpenMetadata.
//
// Guarded here: the scope gates; the caller sees the workspaces they are a
// member of, narrowed by ?workspace=; no credential and no RLS rule ever goes
// out; a measure's lineage reaches its physical columns through its
// references; and its compiled SQL is the SQL /query itself writes.
const request = require('supertest');
const { buildApp, seedUser, seedDatasource, seedModel, seedReport, seedWorkspace, db } = require('./helpers/testApp');
const apiToken = require('../utils/apiToken');
const settings = require('../utils/settingsHelper');
const { encrypt } = require('../utils/secretCrypto');
const compile = require('../utils/metadata/compile');
const { resolveIntervalColumns } = require('../utils/columnTypeResolver');

const app = buildApp();

const TABLES = ['sales.customers', 'sales.orders', 'sales.returns'];
const JOINS = [
  { from_table: 'sales.customers', from_column: 'id', to_table: 'sales.orders', to_column: 'customer_id', cardinality: { from: '1', to: '*' } },
  { from_table: 'sales.customers', from_column: 'id', to_table: 'sales.returns', to_column: 'customer_id', cardinality: { from: '1', to: '*' } },
];
const DIMENSIONS = [
  { name: 'sales.customers.country', table: 'sales.customers', column: 'country', type: 'string', label: 'Country' },
  { name: 'sales.orders.status', table: 'sales.orders', column: 'status', type: 'string', label: 'Status' },
];
const MEASURES = [
  { name: 'orders_amount', table: 'sales.orders', column: 'amount', aggregation: 'sum', label: 'Revenue', description: 'Order amounts' },
  { name: 'orders_count', table: 'sales.orders', column: 'id', aggregation: 'count', label: 'Orders' },
  { name: '_calc.paid', table: 'sales.orders', column: 'amount', aggregation: 'sum', label: 'Paid revenue',
    filterRules: [{ field: 'sales.orders.status', isMeasure: false, op: 'in', value: '', values: ['paid'] }] },
  { name: '_calc.avg_ticket', table: '', column: '', aggregation: 'custom', label: 'Average ticket',
    expression: '${orders_amount} / NULLIF(${orders_count}, 0)' },
  { name: 'returns_amount', table: 'sales.returns', column: 'amount', aggregation: 'sum', label: 'Returns' },
  { name: '_calc.net', table: '', column: '', aggregation: 'custom', label: 'Net revenue', expression: '${orders_amount} - ${returns_amount}' },
];

let owner; let om; let viewer; let wsA; let wsB; let ds; let model; let modelB; let rlsModel; let report; let draft;
let token; let viewerToken; let readToken;

const bearer = (t) => ({ Authorization: `Bearer ${t}` });
const get = (path, t = token) => request(app).get(`/api/v1/metadata${path}`).set(bearer(t));
const sqlOf = async (modelId, measure, extra = {}) => (await request(app).post(`/api/models/${modelId}/query`)
  .set('x-test-user', owner).send({ dimensionNames: [], measureNames: [measure], sqlOnly: true, ...extra })).body.sql;

beforeAll(() => {
  settings.setApiEnabled(true);
  settings.setApiMinRole('viewer');
  // /query is reached in-process here, as the token's owner (in the server: loopback).
  compile.transport.fire = async ({ user, modelId, body }) => {
    const res = await request(app).post(`/api/models/${modelId}/query`).set('x-test-user', user.id).send(body);
    if (res.status !== 200) throw new Error(res.body.error || `status ${res.status}`);
    return res.body;
  };

  owner = seedUser({ role: 'editor', email: 'owner@corp.io' });
  om = seedUser({ role: 'viewer', email: 'openmetadata@corp.io' });
  viewer = seedUser({ role: 'viewer', email: 'reader@corp.io' });
  wsA = seedWorkspace({ ownerId: owner, name: 'Sales' });
  wsB = seedWorkspace({ ownerId: owner, name: 'Finance' });
  const member = db.prepare('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?,?,?)');
  // The catalog account: editor of Sales only (it compiles the report's SQL
  // measures), its token read-only whatever its role.
  member.run(wsA, om, 'editor');
  member.run(wsA, viewer, 'viewer');

  ds = seedDatasource({ userId: owner, dbType: 'postgres' });
  db.prepare('UPDATE datasources SET host = ?, port = ?, db_name = ?, db_user = ?, db_password = ?, extra_config = ?, workspace_id = ? WHERE id = ?')
    .run('db.internal', 5432, 'warehouse', 'svc_reader', encrypt('S3cret-pw'), JSON.stringify({
      schema: 'sales', credentials: encrypt('{"private_key":"KEY-123"}'), connectString: 'svc/pw@host', keyFilename: '/etc/keys/k.json',
    }), wsA, ds);

  model = seedModel({ userId: owner, datasourceId: ds, selectedTables: TABLES, joins: JOINS, dimensions: DIMENSIONS, measures: MEASURES });
  modelB = seedModel({ userId: owner, datasourceId: ds });
  rlsModel = seedModel({ userId: owner, datasourceId: ds, rls: { enabled: true, table: 'items', primaryKey: 'label', rules: { north: ['boss@corp.io', 'group:Managers'] } } });
  db.prepare('UPDATE models SET workspace_id = ? WHERE id IN (?, ?)').run(wsA, model, rlsModel);
  db.prepare('UPDATE models SET workspace_id = ? WHERE id = ?').run(wsB, modelB);

  report = seedReport({
    userId: owner,
    modelId: model,
    workspaceId: wsA,
    settings: {
      extraMeasures: [{ name: '_calc.margin', table: '', column: '', aggregation: 'custom', label: 'Margin', expression: '${orders_amount} * 0.3' }],
      pages: [{
        id: 'p1',
        name: 'Overview',
        widgets: {
          w1: { type: 'bar', config: { title: 'Revenue by country' }, dataBinding: { selectedDimensions: ['sales.customers.country'], selectedMeasures: ['orders_amount', '_calc.margin'], widgetFilters: [{ field: 'sales.orders.status', op: 'in', values: ['paid'] }] } },
          w2: { type: 'text', data: { text: '#country_max' }, dataBinding: { selectedMeasures: ['sales.customers.country@@agg:max'] } },
          w3: { type: 'shape', config: {} },
        },
      }],
    },
  });
  draft = seedReport({ userId: owner, modelId: model, workspaceId: wsA });
  db.prepare('UPDATE reports SET draft = 1 WHERE id = ?').run(draft);

  token = apiToken.create({ userId: om, name: 'catalog', scopes: ['metadata'] }).token;
  viewerToken = apiToken.create({ userId: viewer, name: 'v', scopes: ['metadata'] }).token;
  readToken = apiToken.create({ userId: om, name: 'r', scopes: ['read'] }).token;
});

describe('access', () => {
  test('the metadata scope gates every route, read does not stand in for it', async () => {
    expect((await get('/models', readToken)).status).toBe(403);
    const res = await get('/models');
    expect(res.status).toBe(200);
    expect(res.body.metadata_format).toBe(1);
  });

  test('only the workspaces the account is a member of, narrowed by ?workspace=', async () => {
    const all = await get('/workspaces');
    const names = all.body.workspaces.map((w) => w.name);
    expect(names).toContain('Sales');
    expect(names).not.toContain('Finance');

    const models = (await get('/models')).body.models.map((m) => m.id);
    expect(models).toEqual(expect.arrayContaining([model, rlsModel]));
    expect(models).not.toContain(modelB);

    // A workspace the account is not in stays out, even when asked for.
    expect((await get('/models?workspace=Finance')).body.models).toEqual([]);
    expect((await get(`/models?workspace=${wsA}`)).body.models.map((m) => m.id)).toEqual(expect.arrayContaining([model]));
    expect((await get(`/models/${modelB}`)).status).toBe(404);
  });

  test('pagination is stable and cursor-based', async () => {
    const first = await get('/models?limit=1');
    expect(first.body.models).toHaveLength(1);
    expect(first.body.next).toBe(first.body.models[0].id);
    const second = await get(`/models?limit=1&after=${first.body.next}`);
    expect(second.body.models[0].id > first.body.models[0].id).toBe(true);
  });
});

describe('datasources', () => {
  test('where the source is, never how to log in', async () => {
    const res = await get('/datasources');
    const src = res.body.datasources.find((d) => d.id === ds);
    expect(src).toMatchObject({ type: 'database', db_type: 'postgres', host: 'db.internal', port: 5432, db_name: 'warehouse', default_schema: 'sales' });
    const text = JSON.stringify(res.body);
    for (const secret of ['S3cret-pw', 'svc_reader', 'KEY-123', 'private_key', 'svc/pw@host', '/etc/keys/k.json', 'db_password', 'db_user', 'credentials', 'connectString', 'keyFilename', 'extra_config']) {
      expect(text).not.toContain(secret);
    }
    expect(src.hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('models', () => {
  let full;
  beforeAll(async () => { full = (await get(`/models/${model}`)).body.model; });

  test('the summary carries the same hash as the full model', async () => {
    const summary = (await get('/models')).body.models.find((m) => m.id === model);
    expect(summary.hash).toBe(full.hash);
    expect(summary.measures).toBeUndefined();
    const all = (await get('/models?include=all')).body.models.find((m) => m.id === model);
    expect(all.measures).toHaveLength(MEASURES.length);
  });

  test('tables, joins and dimensions resolved to the source', async () => {
    expect(full.datasources).toEqual([{ datasource_id: ds, alias: null, primary: true }]);
    const orders = full.tables.find((t) => t.alias_in_model === 'sales.orders');
    expect(orders).toMatchObject({ datasource_id: ds, schema: 'sales', table: 'orders' });
    expect(orders.columns.map((c) => c.name)).toEqual(expect.arrayContaining(['amount', 'id', 'status', 'customer_id']));
    expect(orders.columns.find((c) => c.name === 'status').type).toBe('string');
    expect(full.joins[0]).toMatchObject({ from_table: 'sales.customers', to_table: 'sales.orders', cardinality: { from: '1', to: '*' } });
    expect(full.dimensions.find((d) => d.name === 'sales.customers.country')).toMatchObject({ label: 'Country', table: 'sales.customers', column: 'country' });
  });

  test('a measure built on others: references and physical columns', async () => {
    const avg = full.measures.find((m) => m.name === '_calc.avg_ticket');
    expect(avg.expression).toBe('${orders_amount} / NULLIF(${orders_count}, 0)');
    expect(avg.depends_on).toEqual(['orders_amount', 'orders_count']);
    expect(avg.source_columns).toEqual(expect.arrayContaining([
      { datasource_id: ds, schema: 'sales', table: 'orders', column: 'amount' },
      { datasource_id: ds, schema: 'sales', table: 'orders', column: 'id' },
    ]));
    // A filtered measure reads the column it filters on too.
    const paid = full.measures.find((m) => m.name === '_calc.paid');
    expect(paid.filters).toEqual([{ field: 'sales.orders.status', op: 'in', values: ['paid'] }]);
    expect(paid.source_columns).toEqual(expect.arrayContaining([{ datasource_id: ds, schema: 'sales', table: 'orders', column: 'status' }]));
  });

  test('compiled_sql is the expression /query writes, for a simple, a filtered and a referencing measure', async () => {
    for (const name of ['orders_amount', '_calc.paid', '_calc.avg_ticket']) {
      const m = full.measures.find((x) => x.name === name);
      expect(m.compiled_sql_scope).toBe('standalone');
      const sql = await sqlOf(model, name);
      expect(m.compiled_query).toBe(sql);
      // A custom expression comes parenthesised in the SELECT; compiled_sql drops that pair.
      expect([`${m.compiled_sql} AS "${m.label}"`, `(${m.compiled_sql}) AS "${m.label}"`].some((x) => sql.includes(x))).toBe(true);
    }
    expect(full.measures.find((x) => x.name === '_calc.avg_ticket').compiled_sql).toMatch(/SUM\(.*"amount".*\/ NULLIF\(.*COUNT\(.*"id"/);
  });

  test('a measure across two facts keeps the statement and says why', async () => {
    const net = full.measures.find((x) => x.name === '_calc.net');
    expect(net.compiled_sql).toBeNull();
    expect(net.compiled_sql_scope).toBe('multi_fact');
    expect(net.compiled_query).toBe(await sqlOf(model, '_calc.net'));
    expect(net.source_columns.map((c) => c.table).sort()).toEqual(['orders', 'returns']);
  });

  test('RLS: whether it applies, never its rules', async () => {
    const res = await get(`/models/${rlsModel}`);
    expect(res.body.model.rls).toEqual({ has_rls: true });
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('boss@corp.io');
    expect(text).not.toContain('Managers');
    expect(text).not.toContain('primaryKey');
    // Its readers' keys would be in the statement: it stays home.
    expect(res.body.model.measures[0].compiled_query).toBeUndefined();
  });
});

describe('reports', () => {
  test('widgets with their fields, the report\'s own measures compiled, drafts left out', async () => {
    const res = await get('/reports');
    expect(res.body.reports.map((r) => r.id)).toContain(report);
    expect(res.body.reports.map((r) => r.id)).not.toContain(draft);
    const r = res.body.reports.find((x) => x.id === report);
    expect(r).toMatchObject({ workspace_id: wsA, model_id: model, owner: 'owner@corp.io' });
    expect(r.url).toMatch(new RegExp(`/view/${report}$`));
    const widgets = r.pages[0].widgets;
    expect(widgets.map((w) => w.widget_id)).toEqual(['w1', 'w2']);
    expect(widgets[0]).toEqual({
      id: `${report}:w1`, widget_id: 'w1', title: 'Revenue by country', type: 'bar',
      measures: ['orders_amount', '_calc.margin'], dimensions: ['sales.customers.country'],
      filters: [{ field: 'sales.orders.status', op: 'in', values: ['paid'] }],
    });
    // A dimension read as a measure is still that dimension.
    expect(widgets[1].dimensions).toEqual(['sales.customers.country']);
    const margin = r.measures.find((m) => m.name === '_calc.margin');
    expect(margin.depends_on).toEqual(['orders_amount']);
    expect(margin.compiled_sql_scope).toBe('standalone');
    expect(margin.compiled_sql).toMatch(/SUM\(.*"amount".*\* 0\.3/);
  });

  test('a copy of a report keeps its widget ids, its charts are its own in a catalog', async () => {
    const src = db.prepare('SELECT * FROM reports WHERE id = ?').get(report);
    const copy = seedReport({ userId: owner, modelId: model, workspaceId: wsA, settings: JSON.parse(src.settings) });
    const ids = (id) => get(`/reports/${id}`).then((r) => r.body.report.pages[0].widgets.map((w) => w.id));
    const [a, b] = [await ids(report), await ids(copy)];
    expect(a.filter((id) => b.includes(id))).toEqual([]);
  });

  test('a reader who cannot write the model: the report\'s SQL measures are not compiled for them', async () => {
    const r = (await get(`/reports/${report}`, viewerToken)).body.report;
    const margin = r.measures.find((m) => m.name === '_calc.margin');
    expect(margin.compiled_sql).toBeNull();
    expect(margin.compiled_sql_scope).toBe('needs_model_editor');
  });
});

describe('explain', () => {
  test('the tree down to the columns, the SQL, the filters', async () => {
    const res = await get(`/models/${model}/measures/${encodeURIComponent('_calc.avg_ticket')}/explain`);
    expect(res.status).toBe(200);
    expect(res.body.tree.references.map((x) => x.name)).toEqual(['orders_amount', 'orders_count']);
    expect(res.body.tree.references[0].column).toEqual({ datasource_id: ds, schema: 'sales', table: 'orders', column: 'amount' });
    expect(res.body.measure.compiled_sql).toBeTruthy();
    expect(res.body.rls).toEqual({ has_rls: false });
    expect(res.body.summary).toMatch(/Average ticket/);

    const paid = await get(`/models/${model}/measures/${encodeURIComponent('Paid revenue')}/explain`);
    expect(paid.body.filters_applied).toEqual([{ measure: '_calc.paid', field: 'sales.orders.status', op: 'in', values: ['paid'] }]);
  });

  test('a report measure, through its report', async () => {
    const res = await get(`/reports/${report}/measures/${encodeURIComponent('_calc.margin')}/explain`);
    expect(res.status).toBe(200);
    expect(res.body.tree.defined_in).toBe('report');
    expect(res.body.tree.references[0].name).toBe('orders_amount');
    expect((await get(`/models/${model}/measures/nope/explain`)).status).toBe(404);
  });
});

describe('the measure cut out of the statement', () => {
  test('by its alias in the quoting of each dialect, commas inside quotes and calls kept', () => {
    expect(compile.measureExpression('SELECT SUM(x) AS `Average_ticket____`, MAX(y) AS `b` FROM t', 'Average ticket (€)', 'bigquery')).toBe('SUM(x)');
    expect(compile.measureExpression("SELECT COALESCE(a, ',') AS [Name, full], 1 AS [x] FROM t", 'Name, full', 'mssql')).toBe("COALESCE(a, ',')");
    expect(compile.measureExpression('SELECT (a / NULLIF(b, 0)) AS "r" FROM t', 'r', 'postgres')).toBe('a / NULLIF(b, 0)');
    // Two groups side by side are not one parenthesised expression.
    expect(compile.measureExpression('SELECT (a) - (b) AS "r" FROM t', 'r', 'postgres')).toBe('(a) - (b)');
  });

  test('a statement over a sub-query is not cut', () => {
    expect(compile.measureExpression('SELECT COALESCE(__m1, 0) AS "r" FROM (SELECT 1) f', 'r', 'postgres')).toBeNull();
    expect(compile.measureExpression('WITH a AS (SELECT 1) SELECT 1 AS "r" FROM a', 'r', 'postgres')).toBeNull();
  });
});

describe('no connection to the source', () => {
  test('the interval probe reads its cache only when compiling metadata', async () => {
    const connect = jest.fn(() => { throw new Error('connected'); });
    await resolveIntervalColumns({ id: 'x', db_type: 'postgres' }, [{ table: 't', column: 'c' }], { connect, cachedOnly: true });
    expect(connect).not.toHaveBeenCalled();
  });
});
