// Report access contract (Option B de-fork): mutation goes through
// canWriteReport — owner or global admin in OSS. A stranger with no access
// gets 404 (existence hidden); a visible-but-not-writable report would be 403.
// The cloud edition replaces canWriteReport with its workspace/org rules.
const request = require('supertest');
const { buildApp, seedUser, seedDatasource, seedModel, seedReport, db } = require('./helpers/testApp');

const app = buildApp();

function setup() {
  const owner = seedUser({ role: 'editor' });
  const ds = seedDatasource({ userId: owner });
  const model = seedModel({ userId: owner, datasourceId: ds });
  const report = seedReport({ userId: owner, modelId: model });
  return { owner, model, report };
}

describe('Report write access (canWriteReport)', () => {
  test('the owner can rename their report', async () => {
    const { owner, report } = setup();
    const res = await request(app).put(`/api/reports/${report}`).set('x-test-user', owner).send({ title: 'Renamed' });
    expect(res.status).toBe(200);
  });

  test('a global admin can write any report', async () => {
    const { report } = setup();
    const admin = seedUser({ role: 'admin' });
    const res = await request(app).put(`/api/reports/${report}`).set('x-test-user', admin).send({ title: 'AdminEdit' });
    expect(res.status).toBe(200);
  });

  test('a stranger with no access gets 404 (existence hidden, private report)', async () => {
    const { report } = setup();
    const stranger = seedUser({ role: 'editor' });
    const res = await request(app).put(`/api/reports/${report}`).set('x-test-user', stranger).send({ title: 'PWNED' });
    expect(res.status).toBe(404);
    expect(db.prepare('SELECT title FROM reports WHERE id = ?').get(report).title).not.toBe('PWNED');
  });

  test('a non-owner cannot delete the report', async () => {
    const { report } = setup();
    const stranger = seedUser({ role: 'editor' });
    const res = await request(app).delete(`/api/reports/${report}`).set('x-test-user', stranger);
    expect([403, 404]).toContain(res.status);
    expect(db.prepare('SELECT 1 FROM reports WHERE id = ?').get(report)).toBeTruthy();
  });
});

describe('GET /reports/:id — widget data for non-owners', () => {
  test('query data is stripped but a text widget keeps its authored text', async () => {
    const owner = seedUser({ role: 'editor' });
    const reader = seedUser({ role: 'viewer' });
    const ds = seedDatasource({ userId: owner });
    const model = seedModel({ userId: owner, datasourceId: ds });
    const widgets = {
      t1: { type: 'text', dataBinding: {}, config: {}, data: { text: 'Quarterly review' } },
      s1: { type: 'scorecard', dataBinding: { selectedMeasures: ['items.amt_sum'] }, config: {}, data: { value: 42 } },
    };
    const report = seedReport({ userId: owner, modelId: model, isPublic: 1, widgets });
    const asReader = await request(app).get(`/api/reports/${report}`).set('x-test-user', reader);
    expect(asReader.status).toBe(200);
    expect(asReader.body.report.widgets.t1.data).toEqual({ text: 'Quarterly review' });
    expect(asReader.body.report.widgets.s1.data).toBeUndefined();
    const asOwner = await request(app).get(`/api/reports/${report}`).set('x-test-user', owner);
    expect(asOwner.body.report.widgets.s1.data).toEqual({ value: 42 });
  });
});
