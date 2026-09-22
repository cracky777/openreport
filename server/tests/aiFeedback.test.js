const request = require('supertest');
const { setAiConfig } = require('../utils/settingsHelper');
const { buildApp, seedUser, seedDatasource, seedModel, seedReport, db } = require('./helpers/testApp');

const app = buildApp();

describe('👍 / 👎 on the assistant', () => {
  let owner, admin, reader, model;

  beforeAll(() => {
    owner = seedUser({ role: 'editor' });
    admin = seedUser({ role: 'admin' });
    reader = seedUser({ role: 'viewer' });
    model = seedModel({ userId: owner, datasourceId: seedDatasource({ userId: owner }) });
    seedReport({ userId: owner, modelId: model, isPublic: 1 });
    setAiConfig({ provider: 'openai-compat', baseUrl: 'http://llm.test/v1', model: 'mistral-large', enabled: true });
  });

  const rate = (uid, body) => {
    const r = request(app).post('/api/ai/feedback');
    if (uid) r.set('x-test-user', uid);
    return r.send({ modelId: model, ...body });
  };
  const rows = () => db.prepare('SELECT * FROM ai_feedback WHERE model_id = ?').all(model);

  test('access and shape: 401, 404, 403 for who may not ask about the model, 400 without a rating', async () => {
    expect((await rate(null, { answerId: 'a', rating: 'up' })).status).toBe(401);
    expect((await rate(owner, { modelId: 'nope', answerId: 'a', rating: 'up' })).status).toBe(404);
    expect((await rate(reader, { answerId: 'a', rating: 'up' })).status).toBe(403);
    expect((await rate(owner, { answerId: 'a', rating: 'meh' })).status).toBe(400);
    expect((await rate(owner, { rating: 'up' })).status).toBe(400);
    expect(rows()).toEqual([]);
  });

  test('only the question and the shape of the proposal are kept', async () => {
    const res = await rate(owner, {
      answerId: 'a1',
      rating: 'down',
      question: 'q'.repeat(900),
      reply: 'Paris has 2 102 650 inhabitants',
      visuals: [{
        type: 'bar',
        config: { title: 'Sales', subType: 'stacked', bundleUrl: 'x' },
        dataBinding: { selectedDimensions: ['items.label', 'DROP TABLE'], selectedMeasures: ['items.amt_sum'] },
        data: { rows: [{ secret: 1 }] },
      }],
    });
    expect(res.status).toBe(200);
    const [row] = rows();
    expect(row.rating).toBe(-1);
    expect(row.question).toHaveLength(500);
    expect(JSON.parse(row.visuals)).toEqual([{ type: 'bar', subType: 'stacked', title: 'Sales', fields: ['items.label', 'items.amt_sum'] }]);
    expect(row.provider_model).toBe('mistral-large');
    expect(row.provider_source).toBe('instance');
    expect(JSON.stringify(row)).not.toMatch(/2 102 650|secret|DROP|bundleUrl/);
  });

  test('rating the same answer again changes the rating, it does not add one', async () => {
    await rate(owner, { answerId: 'a1', rating: 'up' });
    expect(rows().map((r) => r.rating)).toEqual([1]);
  });

  test('the summary is for admins', async () => {
    const get = (uid) => request(app).get('/api/admin/ai/feedback?days=7').set('x-test-user', uid);
    expect((await get(owner)).status).toBe(403);
    const res = await get(admin);
    expect(res.status).toBe(200);
    expect(res.body.totals).toEqual({ up: 1, down: 0 });
    expect(res.body.byModel).toEqual([expect.objectContaining({ modelId: model, up: 1, down: 0 })]);
    expect(res.body.recent[0]).toEqual(expect.objectContaining({ rating: 'up', surface: 'ask', visuals: expect.any(Array) }));
  });
});
