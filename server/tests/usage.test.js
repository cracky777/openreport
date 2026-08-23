// Usage & observability: events are written on report reads, /query calls
// and cache builds, never break the request that emits them, age out after
// the retention window, and roll up into the admin summary.
const request = require('supertest');
const { buildApp, seedUser, seedDatasource, seedModel, seedReport, db } = require('./helpers/testApp');
const usage = require('../utils/usage');

const app = buildApp();
beforeAll(() => { jest.spyOn(console, 'warn').mockImplementation(() => {}); });
afterAll(() => { jest.restoreAllMocks(); });

const events = (kind) => db.prepare('SELECT * FROM usage_events WHERE kind = ? ORDER BY id').all(kind);

describe('report views', () => {
  test('only a Viewer open (?view=1) counts; editor/API reads and print renders do not', async () => {
    const owner = seedUser({ role: 'editor' });
    const ds = seedDatasource({ userId: owner });
    const model = seedModel({ userId: owner, datasourceId: ds });
    const report = seedReport({ userId: owner, modelId: model });
    const before = events('report_view').length;

    await request(app).get(`/api/reports/${report}`).set('x-test-user', owner);
    expect(events('report_view')).toHaveLength(before);
    await request(app).get(`/api/reports/${report}?view=1`).set('x-test-user', owner);
    const after = events('report_view');
    expect(after).toHaveLength(before + 1);
    expect(after[after.length - 1]).toMatchObject({ report_id: report, model_id: model, user_id: owner });
  });

  test('an anonymous public read is recorded without a user', async () => {
    const owner = seedUser({ role: 'editor' });
    const ds = seedDatasource({ userId: owner });
    const model = seedModel({ userId: owner, datasourceId: ds });
    const report = seedReport({ userId: owner, modelId: model, isPublic: 1 });
    const res = await request(app).get(`/api/reports/${report}?view=1`);
    expect(res.status).toBe(200);
    const ev = events('report_view').filter((e) => e.report_id === report);
    expect(ev).toHaveLength(1);
    expect(ev[0].user_id).toBeNull();
    expect(ev[0].detail).toBe('anonymous');
  });
});

describe('/query events', () => {
  test('a failing live query is recorded as error with its duration; sqlOnly previews are not traffic', async () => {
    const owner = seedUser({ role: 'editor' });
    const ds = seedDatasource({ userId: owner, dbType: 'postgres' }); // unreachable → error path
    const model = seedModel({ userId: owner, datasourceId: ds });
    const report = seedReport({ userId: owner, modelId: model });
    const before = events('query').length;

    const preview = await request(app).post(`/api/models/${model}/query`).set('x-test-user', owner)
      .send({ dimensionNames: ['items.label'], measureNames: ['items.amt_sum'], sqlOnly: true });
    expect(preview.status).toBe(200);
    expect(events('query')).toHaveLength(before);

    const live = await request(app).post(`/api/models/${model}/query`).set('x-test-user', owner)
      .send({ dimensionNames: ['items.label'], measureNames: ['items.amt_sum'], reportId: report, bypassCache: true });
    expect(live.status).toBeGreaterThanOrEqual(500);
    const ev = events('query');
    expect(ev).toHaveLength(before + 1);
    expect(ev[ev.length - 1]).toMatchObject({ model_id: model, report_id: report, user_id: owner, served: 'error' });
    expect(ev[ev.length - 1].duration_ms).toBeGreaterThanOrEqual(0);
    expect(ev[ev.length - 1].status).toBe(live.status);
  });
});

describe('record / prune / summary', () => {
  test('record never throws and prune drops rows past the retention window', () => {
    usage.record({ kind: 'query', modelId: 'm-x', durationMs: 12.6, served: 'live', rows: 3, status: 200 });
    const last = db.prepare('SELECT * FROM usage_events ORDER BY id DESC LIMIT 1').get();
    expect(last).toMatchObject({ kind: 'query', duration_ms: 13, served: 'live', rows: 3 });
    // an old row
    db.prepare(`INSERT INTO usage_events (ts, kind, model_id) VALUES (?, 'query', 'old')`)
      .run(new Date(Date.now() - (usage.RETENTION_DAYS + 1) * 86400e3).toISOString());
    usage._resetPruneClock();
    expect(usage.prune()).toBeGreaterThanOrEqual(1);
    expect(db.prepare("SELECT COUNT(*) AS n FROM usage_events WHERE model_id = 'old'").get().n).toBe(0);
    // a bad row must not throw
    expect(() => usage.record({ kind: null })).not.toThrow();
  });

  test('the admin summary aggregates views, served breakdown, slow queries and freshness', async () => {
    const admin = seedUser({ role: 'admin' });
    const owner = seedUser({ role: 'editor' });
    const ds = seedDatasource({ userId: owner });
    const model = seedModel({ userId: owner, datasourceId: ds });
    const report = seedReport({ userId: owner, modelId: model });
    db.prepare("UPDATE reports SET title = 'Ventes', cache_built_at = '2026-08-01T00:00:00Z' WHERE id = ?").run(report);
    for (let i = 0; i < 3; i++) usage.record({ kind: 'report_view', reportId: report, modelId: model, userId: owner });
    usage.record({ kind: 'query', reportId: report, modelId: model, userId: owner, durationMs: 50, served: 'rollup', rows: 10, status: 200 });
    usage.record({ kind: 'query', reportId: report, modelId: model, userId: owner, durationMs: 5000, served: 'live', rows: 10, status: 200 });
    usage.record({ kind: 'cache_build', modelId: model, durationMs: 800, rows: 4, status: 200, detail: '4 built' });

    const denied = await request(app).get('/api/admin/usage').set('x-test-user', owner);
    expect(denied.status).toBe(403);

    const res = await request(app).get('/api/admin/usage?days=7').set('x-test-user', admin);
    expect(res.status).toBe(200);
    const s = res.body;
    expect(s.days).toBe(7);
    expect(s.totals.views).toBeGreaterThanOrEqual(3);
    expect(s.totals.slow).toBeGreaterThanOrEqual(1);
    const top = s.topReports.find((r) => r.reportId === report);
    expect(top).toMatchObject({ title: 'Ventes', views: 3, viewers: 1 });
    expect(s.slowQueries[0].durationMs).toBeGreaterThanOrEqual(5000);
    expect(s.slowQueries[0]).toMatchObject({ served: 'live', reportTitle: 'Ventes' });
    const bm = s.byModel.find((m) => m.modelId === model);
    expect(bm).toMatchObject({ queries: 2, fromRollup: 1, live: 1 });
    expect(s.builds.find((b) => b.modelId === model)).toMatchObject({ built: 4, status: 200 });
    const fr = s.freshness.find((f) => f.reportId === report);
    expect(fr).toMatchObject({ title: 'Ventes', cacheBuiltAt: '2026-08-01T00:00:00Z', views: 3 });
    expect(fr.lastViewedAt).toBeTruthy();
  });
});
