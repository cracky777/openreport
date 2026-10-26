// A file dropped again is reused only when it is the same file: same name,
// same size, same workspace. A clients.csv of an older test, in another
// workspace, stood in for a new one, and the model could not link it.
const request = require('supertest');

jest.setTimeout(60000);
const { buildApp, seedUser, seedWorkspace, db } = require('./helpers/testApp');

const app = buildApp();
const as = (uid) => (r) => r.set('x-test-user', uid);
const upload = (uid, content, { workspaceId } = {}) => {
  const r = request(app).post('/api/upload').use(as(uid)).field('name', `clients-${Math.random()}`);
  if (workspaceId) r.field('workspaceId', workspaceId);
  return r.attach('file', Buffer.from(content), 'clients.csv');
};

const CLIENTS = 'client_id,nom\nC1,Martin\nC2,Durand\n';

describe('A file dropped again', () => {
  test('the same file is reused', async () => {
    const u = seedUser({ role: 'editor' });
    const first = await upload(u, CLIENTS);
    expect(first.status).toBe(201);
    const again = await upload(u, CLIENTS);
    expect(again.body.reused).toBe(true);
    expect(again.body.datasource.id).toBe(first.body.datasource.id);
  });

  test('another file of the same name is imported', async () => {
    const u = seedUser({ role: 'editor' });
    const first = await upload(u, CLIENTS);
    const other = await upload(u, `${CLIENTS}C3,Petit\n`);
    expect(other.status).toBe(201);
    expect(other.body.datasource.id).not.toBe(first.body.datasource.id);
  });

  test('the same file dropped in another workspace is imported there', async () => {
    const u = seedUser({ role: 'editor' });
    const ws = seedWorkspace({ ownerId: u });
    db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'admin')").run(ws, u);
    const first = await upload(u, CLIENTS);
    const there = await upload(u, CLIENTS, { workspaceId: ws });
    expect(there.status).toBe(201);
    expect(there.body.datasource.id).not.toBe(first.body.datasource.id);
  });
});
