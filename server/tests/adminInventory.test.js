// Admin › Resources: every datasource, model and report of the instance, with
// who created it, where it lives and where it is shared. Metadata only.
const request = require('supertest');
const { buildApp, seedUser, seedDatasource, seedModel, seedReport, seedWorkspace, db } = require('./helpers/testApp');

const app = buildApp();

test('an admin sees every resource, its creator, its workspace and its shares; nobody else does', async () => {
  const admin = seedUser({ role: 'admin' });
  const maker = seedUser({ role: 'editor', email: 'maker@inv.io' });
  const home = seedWorkspace({ ownerId: maker, name: 'Finance' });
  const other = seedWorkspace({ ownerId: maker, name: 'Sales' });
  const ds = seedDatasource({ userId: maker });
  const model = seedModel({ userId: maker, datasourceId: ds });
  db.prepare('UPDATE datasources SET workspace_id = ? WHERE id = ?').run(home, ds);
  db.prepare('UPDATE models SET workspace_id = ? WHERE id = ?').run(home, model);
  db.prepare('INSERT INTO workspace_models (workspace_id, model_id) VALUES (?, ?)').run(other, model);
  const report = seedReport({ userId: maker, modelId: model, workspaceId: home });
  db.prepare('INSERT INTO workspace_reports (workspace_id, report_id) VALUES (?, ?)').run(other, report);

  expect((await request(app).get('/api/admin/inventory').set('x-test-user', maker)).status).toBe(403);
  const res = await request(app).get('/api/admin/inventory').set('x-test-user', admin);
  expect(res.status).toBe(200);
  const d = res.body.datasources.find((x) => x.id === ds);
  expect(d).toMatchObject({ creator: { email: 'maker@inv.io' }, workspace: { name: 'Finance' }, sharedIn: [], modelCount: 1 });
  expect(d).not.toHaveProperty('db_password');
  expect(res.body.models.find((x) => x.id === model)).toMatchObject({ workspace: { name: 'Finance' }, sharedIn: [{ name: 'Sales' }], reportCount: 1 });
  expect(res.body.reports.find((x) => x.id === report)).toMatchObject({ workspace: { name: 'Finance' }, sharedIn: [{ name: 'Sales' }] });
});

test('the global admin deletes anything, leaves first: a model under a report and a source under a model stay', async () => {
  const admin = seedUser({ role: 'admin' });
  const maker = seedUser({ role: 'editor' });
  const home = seedWorkspace({ ownerId: maker, name: 'Ops' });
  const ds = seedDatasource({ userId: maker });
  const model = seedModel({ userId: maker, datasourceId: ds });
  db.prepare('UPDATE datasources SET workspace_id = ? WHERE id = ?').run(home, ds);
  db.prepare('UPDATE models SET workspace_id = ? WHERE id = ?').run(home, model);
  const report = seedReport({ userId: maker, modelId: model, workspaceId: home });
  const del = (path) => request(app).delete(path).set('x-test-user', admin);

  expect((await del(`/api/datasources/${ds}`)).status).toBe(409);
  expect((await del(`/api/models/${model}`)).status).toBe(409);
  expect((await del(`/api/reports/${report}`)).status).toBe(200);
  expect((await del(`/api/models/${model}`)).status).toBe(200);
  expect((await del(`/api/datasources/${ds}`)).status).toBe(200);
  expect(db.prepare('SELECT COUNT(*) AS n FROM datasources WHERE id = ?').get(ds).n).toBe(0);
});

test('a file a model links counts as used, and the model lists every source it reads', async () => {
  const admin = seedUser({ role: 'admin' });
  const maker = seedUser({ role: 'editor' });
  const own = seedDatasource({ userId: maker });
  const linked = seedDatasource({ userId: maker });
  db.prepare("UPDATE datasources SET name = 'orders' WHERE id = ?").run(own);
  db.prepare("UPDATE datasources SET name = 'customers' WHERE id = ?").run(linked);
  const model = seedModel({ userId: maker, datasourceId: own });
  db.prepare("INSERT INTO model_datasources (model_id, datasource_id, alias) VALUES (?, ?, 'customers')").run(model, linked);

  const res = await request(app).get('/api/admin/inventory').set('x-test-user', admin);
  expect(res.body.datasources.find((x) => x.id === linked).modelCount).toBe(1);
  expect(res.body.models.find((x) => x.id === model).datasourceName).toBe('orders + customers');
});
