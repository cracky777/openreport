process.env.DATASOURCE_ENC_KEY = process.env.DATASOURCE_ENC_KEY || 'a'.repeat(64);

jest.mock('../utils/ai/providers', () => ({
  ...jest.requireActual('../utils/ai/providers'),
  chat: jest.fn(),
}));

const request = require('supertest');
const providers = require('../utils/ai/providers');
const cloudHooks = require('../cloudHooks');
const { setAiConfig, patchAiConfig } = require('../utils/settingsHelper');
const { buildApp, seedUser, seedDatasource, seedModel, seedReport, db } = require('./helpers/testApp');

const app = buildApp();
const say = (text) => ({ text, toolCalls: [], usage: null });

// The cloud edition sets the assistant up per organization: it tells the
// access rules WHERE to read (cloudHooks.resolveAiScope), and the rules stay
// the same. The instance-wide settings then configure nothing, so the admin
// console stops offering them.
describe('an edition that sets the assistant up elsewhere than the instance', () => {
  let admin, alice, report;
  // A scope as the cloud would build it, from its own storage.
  let scope;

  beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    admin = seedUser({ role: 'admin' });
    alice = seedUser({ role: 'editor' });
    report = seedReport({ userId: alice, modelId: seedModel({ userId: alice, datasourceId: seedDatasource({ userId: alice }) }) });
    cloudHooks.resolveAiScope = () => scope;
  });
  afterAll(() => {
    cloudHooks.resolveAiScope = null;
    jest.restoreAllMocks();
  });
  beforeEach(() => {
    providers.chat.mockReset();
    db.prepare("DELETE FROM app_settings WHERE key = 'ai_config'").run();
    db.prepare('UPDATE users SET ai_denied = 0, ai_config = NULL').run();
    scope = { stored: patchAiConfig(null, { baseUrl: 'http://org.test/v1', model: 'org-model', dataSharing: 'schema+cache' }), denied: false };
  });

  const status = (uid) => request(app).get('/api/ai/status').set('x-test-user', uid);
  const chat = (uid) => request(app).post(`/api/ai/reports/${report}/chat`).set('x-test-user', uid)
    .send({ messages: [{ role: 'user', text: 'Sales?' }], pageContext: { widgets: [] } });

  test('the scope\'s provider serves the request, whatever the instance holds', async () => {
    setAiConfig({ enabled: false });
    providers.chat.mockResolvedValueOnce(say('ok'));
    expect((await chat(alice)).status).toBe(200);
    expect(providers.chat.mock.calls[0][0].config).toMatchObject({ baseUrl: 'http://org.test/v1', model: 'org-model' });
  });

  test('the scope\'s switch and refusal are the rules: off, then denied', async () => {
    scope.stored.enabled = false;
    expect((await status(alice)).body).toMatchObject({ enabled: false, reason: 'off' });
    scope = { ...scope, stored: { ...scope.stored, enabled: true }, denied: true };
    expect((await status(alice)).body).toMatchObject({ enabled: false, reason: 'denied' });
    expect(providers.chat).not.toHaveBeenCalled();
  });

  // Without a provider in the scope, a user may bring their own — and what is
  // sent stays the scope's decision, not theirs.
  test('no provider in the scope: the user\'s own, under the scope\'s data sharing', async () => {
    scope = { stored: patchAiConfig(null, { dataSharing: 'schema+cache' }), denied: false };
    expect((await status(alice)).body.reason).toBe('setup');
    await request(app).put('/api/ai/personal').set('x-test-user', alice)
      .send({ provider: 'openai-compat', baseUrl: 'http://mine.test/v1', model: 'my-model' }).expect(200);
    providers.chat.mockResolvedValueOnce(say('ok'));
    await chat(alice).expect(200);
    expect(providers.chat.mock.calls[0][0].config).toMatchObject({ baseUrl: 'http://mine.test/v1', dataSharing: 'schema+cache' });
  });

  test('the instance-wide AI settings are gone from the admin console', async () => {
    const settings = await request(app).get('/api/admin/settings').set('x-test-user', admin);
    expect(settings.body).toMatchObject({ ai: null, aiPerOrganization: true });
    for (const r of [
      request(app).put('/api/admin/settings/ai').send({ enabled: false }),
      request(app).post('/api/admin/settings/ai/test'),
      request(app).put(`/api/admin/users/${alice}/ai-access`).send({ denied: true }),
      request(app).get('/api/admin/ai/feedback'),
    ]) {
      expect((await r.set('x-test-user', admin)).status).toBe(404);
    }
    expect(db.prepare('SELECT ai_denied FROM users WHERE id = ?').get(alice).ai_denied).toBe(0);
  });
});
