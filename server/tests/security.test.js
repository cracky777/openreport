const request = require('supertest');
const { quoteIdent } = require('../utils/sqlDialect');
const { buildApp, seedUser, seedDatasource, seedModel, seedReport } = require('./helpers/testApp');

const app = buildApp();

// The compiler probes column types against the (fake) datasource and warns when
// that connection fails — expected here since we only compile (sqlOnly).
beforeAll(() => { jest.spyOn(console, 'warn').mockImplementation(() => {}); });
afterAll(() => { jest.restoreAllMocks(); });

// Compile a widget query without executing it (sqlOnly) and return the SQL.
async function compile(userId, modelId, body) {
  const res = await request(app)
    .post(`/api/models/${modelId}/query`)
    .set('x-test-user', userId)
    .send({ dimensionNames: ['items.label'], measureNames: ['items.amt_sum'], sqlOnly: true, ...body });
  return res;
}

describe('LOT 1.1 — offset/limit injection is coerced', () => {
  let owner, model;
  beforeAll(() => {
    owner = seedUser({ role: 'editor' });
    model = seedModel({ userId: owner, datasourceId: seedDatasource({ userId: owner, dbType: 'postgres' }) });
  });

  test('malicious offset is parsed to an int, injection dropped', async () => {
    const res = await compile(owner, model, { offset: '5; DROP TABLE users; --' });
    expect(res.status).toBe(200);
    expect(res.body.sql).toContain('OFFSET 5');
    expect(res.body.sql).not.toMatch(/DROP TABLE/i);
  });

  test('non-numeric offset yields no OFFSET clause', async () => {
    const res = await compile(owner, model, { offset: '0 OR 1=1' });
    expect(res.status).toBe(200);
    expect(res.body.sql).not.toMatch(/OFFSET/i);
    expect(res.body.sql).not.toMatch(/1=1/);
  });

  test('legit offset is preserved', async () => {
    const res = await compile(owner, model, { offset: 12 });
    expect(res.body.sql).toContain('OFFSET 12');
  });

  test('limit is coerced to a bounded int', async () => {
    const res = await compile(owner, model, { limit: '10; DROP TABLE x' });
    expect(res.body.sql).toMatch(/LIMIT 10\b/);
    expect(res.body.sql).not.toMatch(/DROP TABLE/i);
  });
});

describe('LOT 1.2 — measure label goes through quoteIdent', () => {
  test('poisoned label is escaped, not raw', async () => {
    const owner = seedUser({ role: 'editor' });
    const ds = seedDatasource({ userId: owner, dbType: 'postgres' });
    const poison = 'a"; DROP TABLE users; --';
    const model = seedModel({
      userId: owner,
      datasourceId: ds,
      measures: [{ name: 'items.amt_sum', table: 'items', column: 'amt', aggregation: 'sum', label: poison }],
    });
    const res = await compile(owner, model, {});
    expect(res.status).toBe(200);
    // The alias is the quoteIdent-escaped label (doubled quotes), never the raw poison.
    expect(res.body.sql).toContain(quoteIdent(poison, 'postgres'));
    expect(res.body.sql).not.toContain(`AS "${poison}"`);
  });
});

describe('LOT 1.1 — mssql OFFSET/FETCH stays parameterised', () => {
  test('mssql malicious offset coerced', async () => {
    const owner = seedUser({ role: 'editor' });
    const model = seedModel({ userId: owner, datasourceId: seedDatasource({ userId: owner, dbType: 'mssql' }) });
    const res = await compile(owner, model, { offset: '3); DROP TABLE x --', limit: 50 });
    expect(res.status).toBe(200);
    expect(res.body.sql).toMatch(/OFFSET 3 ROWS/);
    expect(res.body.sql).not.toMatch(/DROP TABLE/i);
  });
});

describe('LOT 1.3 — access control on /models/:id/query', () => {
  let owner, otherUser, model;
  beforeAll(() => {
    owner = seedUser({ role: 'editor' });
    otherUser = seedUser({ role: 'viewer' });
    model = seedModel({ userId: owner, datasourceId: seedDatasource({ userId: owner }) });
  });

  test('owner can query own model', async () => {
    const res = await compile(owner, model, {});
    expect(res.status).toBe(200);
  });

  test('unrelated user is refused (no shared/public report)', async () => {
    const res = await compile(otherUser, model, {});
    expect(res.status).toBe(404);
  });

  test('anonymous is refused a private model', async () => {
    const res = await request(app)
      .post(`/api/models/${model}/query`)
      .send({ dimensionNames: ['items.label'], measureNames: ['items.amt_sum'], sqlOnly: true });
    expect(res.status).toBe(404);
  });

  test('anonymous can reach a model exposed via a PUBLIC report', async () => {
    seedReport({ userId: owner, modelId: model, isPublic: 1 });
    const res = await request(app)
      .post(`/api/models/${model}/query`)
      .send({ dimensionNames: ['items.label'], measureNames: ['items.amt_sum'], sqlOnly: true });
    expect(res.status).toBe(200);
  });
});

describe('LOT 1.3a — report creation authorises the model', () => {
  test('a user cannot create a report on a model they cannot access', async () => {
    const owner = seedUser({ role: 'editor' });
    const attacker = seedUser({ role: 'editor' });
    const privateModel = seedModel({ userId: owner, datasourceId: seedDatasource({ userId: owner }) });
    const res = await request(app)
      .post('/api/reports')
      .set('x-test-user', attacker)
      .send({ title: 'x', modelId: privateModel });
    expect(res.status).toBe(403);
  });

  test('the model owner can create a report on it', async () => {
    const owner = seedUser({ role: 'editor' });
    const model = seedModel({ userId: owner, datasourceId: seedDatasource({ userId: owner }) });
    const res = await request(app)
      .post('/api/reports')
      .set('x-test-user', owner)
      .send({ title: 'x', modelId: model });
    expect(res.status).toBe(201);
  });
});
