const request = require('supertest');
const { buildApp, seedUser, seedDatasource, seedModel, seedReport } = require('./helpers/testApp');

const app = buildApp();

// Two guarantees around report portability:
//  1. GET /reports/:id strips the owner's pre-baked widget `data` for anyone
//     but the owner — otherwise a public report would hand out rows that never
//     passed through the viewer's RLS re-query. (Config is kept.)
//  2. /import validates the bundle + enforces that you own the target model,
//     so an import can't silently bind to someone else's model.
describe('GET /reports/:id strips baked widget data for non-owners', () => {
  let owner, report;
  const WIDGETS = { w1: { type: 'bar', config: { title: 'x' }, data: { rows: [[1, 2]], _fetchedBinding: 'k' } } };
  beforeAll(() => {
    owner = seedUser({ role: 'editor', email: 'owner@exp.io' });
    const model = seedModel({ userId: owner, datasourceId: seedDatasource({ userId: owner }) });
    report = seedReport({ userId: owner, modelId: model, isPublic: 1, widgets: WIDGETS });
  });

  test('the owner keeps the baked data (fast Editor open)', async () => {
    const res = await request(app).get(`/api/reports/${report}`).set('x-test-user', owner);
    expect(res.status).toBe(200);
    expect(res.body.report.widgets.w1.data).toBeDefined();
  });

  test('a non-owner (via the public report) never receives the data — RLS-safe', async () => {
    const other = seedUser({ role: 'viewer', email: 'other@exp.io' });
    const res = await request(app).get(`/api/reports/${report}`).set('x-test-user', other);
    expect(res.status).toBe(200);
    expect(res.body.report.widgets.w1.data).toBeUndefined();
    expect(res.body.report.widgets.w1.config).toBeDefined(); // config survives
  });

  test('anonymous (via the public report) also gets stripped widgets', async () => {
    const res = await request(app).get(`/api/reports/${report}`);
    expect(res.status).toBe(200);
    expect(res.body.report.widgets.w1.data).toBeUndefined();
  });
});

describe('POST /reports/import — validation & ownership', () => {
  let user, model;
  beforeAll(() => {
    user = seedUser({ role: 'editor', email: 'imp@exp.io' });
    model = seedModel({ userId: user, datasourceId: seedDatasource({ userId: user }) });
  });
  const imp = (body) => request(app).post('/api/reports/import').set('x-test-user', user).send(body);

  test('an unsupported bundle format is rejected (400)', async () => {
    const res = await imp({ bundle: { format: 'bogus.v9', report: {} }, modelId: model });
    expect(res.status).toBe(400);
  });

  test('a missing target modelId is rejected (400)', async () => {
    const res = await imp({ bundle: { format: 'open-report.report.v1', report: { title: 't' } } });
    expect(res.status).toBe(400);
  });

  test('importing onto a model you do not own is refused (403)', async () => {
    const stranger = seedUser({ role: 'editor', email: 'stranger@exp.io' });
    const theirModel = seedModel({ userId: stranger, datasourceId: seedDatasource({ userId: stranger }) });
    const res = await imp({ bundle: { format: 'open-report.report.v1', report: { title: 't' } }, modelId: theirModel });
    expect(res.status).toBe(403);
  });
});
