// A report the studio named from the assistant's card is saved under a free
// title: "Maison Gaspard – Tableau de bord S1" already existed, and Save was
// refused over a name nobody typed. A title the user typed keeps its 409.
const request = require('supertest');
const { buildApp, seedUser, seedDatasource, seedModel } = require('./helpers/testApp');

const app = buildApp();

test('autoTitle takes "(2)" where a typed title is refused, and keeps its own name on the next save', async () => {
  const owner = seedUser({ role: 'editor' });
  const modelId = seedModel({ userId: owner, datasourceId: seedDatasource({ userId: owner }) });
  const as = (r) => r.set('x-test-user', owner);
  const create = async (title) => (await as(request(app).post('/api/reports')).send({ title, modelId })).body.report.id;
  const first = await create('Bistrots');
  const second = await create('Brouillon');

  const typed = await as(request(app).put(`/api/reports/${second}`)).send({ title: 'Bistrots' });
  expect(typed.status).toBe(409);

  const given = await as(request(app).put(`/api/reports/${second}`)).send({ title: 'Bistrots', autoTitle: true });
  expect(given.status).toBe(200);
  expect(given.body.report.title).toBe('Bistrots (2)');
  // Saved again under the name it got: not "(3)".
  const again = await as(request(app).put(`/api/reports/${second}`)).send({ title: 'Bistrots (2)', autoTitle: true });
  expect(again.body.report.title).toBe('Bistrots (2)');
  expect((await as(request(app).get(`/api/reports/${first}`))).body.report.title).toBe('Bistrots');
});
