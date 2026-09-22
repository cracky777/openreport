process.env.DATASOURCE_ENC_KEY = process.env.DATASOURCE_ENC_KEY || 'a'.repeat(64);

jest.mock('../utils/ai/providers', () => ({
  ...jest.requireActual('../utils/ai/providers'),
  chat: jest.fn(),
}));

const request = require('supertest');
const providers = require('../utils/ai/providers');
const { setAiConfig } = require('../utils/settingsHelper');
const { buildApp, seedUser, seedDatasource, seedModel, seedReport, seedRollup, db } = require('./helpers/testApp');

const app = buildApp();
const INSTANCE = { provider: 'openai-compat', baseUrl: 'http://instance.test/v1', model: 'instance-model', apiKey: 'sk-instance-key' };
const OWN = { provider: 'openai-compat', baseUrl: 'http://mine.test/v1', model: 'my-model', apiKey: 'sk-my-own-secret-key' };
const say = (text) => ({ text, toolCalls: [], usage: null });

// Who gets the assistant, and on whose provider (utils/ai/access.js): the
// admin's switch, then the admin's per-account refusal, then the instance's
// provider, then — only when it has none — the user's own.
describe('AI assistant access', () => {
  let admin, alice, bob, report;
  const as = (uid) => ({
    status: () => request(app).get('/api/ai/status').set('x-test-user', uid),
    save: (body) => request(app).put('/api/ai/personal').set('x-test-user', uid).send(body),
    forget: () => request(app).delete('/api/ai/personal').set('x-test-user', uid),
    chat: (id = report) => request(app).post(`/api/ai/reports/${id}/chat`).set('x-test-user', uid)
      .send({ messages: [{ role: 'user', text: 'Sales?' }], pageContext: { widgets: [] } }),
  });
  const deny = (uid, denied) => request(app).put(`/api/admin/users/${uid}/ai-access`).set('x-test-user', admin).send({ denied });

  beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    admin = seedUser({ role: 'admin' });
    alice = seedUser({ role: 'editor' });
    bob = seedUser({ role: 'editor' });
    const model = seedModel({ userId: alice, datasourceId: seedDatasource({ userId: alice }) });
    seedRollup({ modelId: model });
    report = seedReport({ userId: alice, modelId: model });
  });
  afterAll(() => { jest.restoreAllMocks(); });
  beforeEach(() => {
    providers.chat.mockReset();
    db.prepare("DELETE FROM app_settings WHERE key = 'ai_config'").run();
    db.prepare('UPDATE users SET ai_denied = 0, ai_config = NULL').run();
  });

  describe('the instance has no provider: a user brings their own', () => {
    test('the panel can open on a setup form: status says so, and nothing else is on', async () => {
      const res = await as(alice).status();
      expect(res.body).toEqual({
        enabled: false, dataSharing: 'schema', source: null, reason: 'setup',
        personal: { provider: 'openai-compat', baseUrl: '', model: '', hasApiKey: false, keyError: null },
      });
      expect((await as(alice).chat()).status).toBe(409);
    });

    test('their provider serves their requests — and only theirs', async () => {
      expect((await as(alice).save(OWN)).status).toBe(200);
      expect((await as(alice).status()).body).toMatchObject({ enabled: true, source: 'personal' });
      // Bob set nothing up: Alice's key is not an instance-wide assistant.
      expect((await as(bob).status()).body).toMatchObject({ enabled: false, reason: 'setup' });

      providers.chat.mockResolvedValueOnce(say('ok'));
      expect((await as(alice).chat()).status).toBe(200);
      expect(providers.chat.mock.calls[0][0].config).toMatchObject({ baseUrl: OWN.baseUrl, model: OWN.model, apiKey: OWN.apiKey });
    });

    test('the key is encrypted at rest and readable by no one — not its owner, not an admin', async () => {
      const saved = await as(alice).save(OWN);
      expect(saved.body.personal).toEqual({ provider: 'openai-compat', baseUrl: OWN.baseUrl, model: OWN.model, hasApiKey: true, keyError: null });
      const row = db.prepare('SELECT ai_config FROM users WHERE id = ?').get(alice).ai_config;
      expect(row).not.toContain(OWN.apiKey);
      expect(JSON.parse(row).apiKey).toMatch(/^enc:v1:/);

      const everywhere = [
        saved, await as(alice).status(),
        await request(app).get('/api/admin/users').set('x-test-user', admin),
        await request(app).get('/api/admin/settings').set('x-test-user', admin),
      ].map((r) => JSON.stringify(r.body)).join(' ');
      expect(everywhere).not.toContain(OWN.apiKey);
      expect(everywhere).not.toContain('enc:v1:');
    });

    test('where the prompt goes is theirs to choose; WHAT goes stays the admin\'s decision', async () => {
      await as(alice).save({ ...OWN, dataSharing: 'schema+cache' });
      expect((await as(alice).status()).body.dataSharing).toBe('schema');
      setAiConfig({ dataSharing: 'schema+cache' });
      expect((await as(alice).status()).body.dataSharing).toBe('schema+cache');
    });

    test('it is validated like the instance\'s, and can be forgotten', async () => {
      expect((await as(alice).save({ baseUrl: 'file:///etc/passwd', model: 'm' })).status).toBe(400);
      expect((await as(alice).save({ baseUrl: 'https://user:pw@host.test', model: 'm' })).status).toBe(400);
      expect((await as(alice).save({ baseUrl: 'http://mine.test/v1' })).status).toBe(400);
      await as(alice).save(OWN);
      await as(alice).forget();
      expect((await as(alice).status()).body).toMatchObject({ enabled: false, reason: 'setup', personal: { hasApiKey: false } });
    });
  });

  describe('the instance has a provider: everyone has it, except whom the admin refuses', () => {
    beforeEach(() => { setAiConfig(INSTANCE); });

    test('no list to maintain: a new editor simply has the assistant', async () => {
      expect((await as(bob).status()).body).toMatchObject({ enabled: true, source: 'instance', personal: null });
      // The instance provides it: a personal provider has nothing to add.
      expect((await as(bob).save(OWN)).status).toBe(403);
    });

    test('a refused account has no assistant at all — a key of its own changes nothing', async () => {
      db.prepare('UPDATE users SET ai_config = ? WHERE id = ?').run(JSON.stringify({ ...OWN, apiKey: '' }), alice);
      expect((await deny(alice, true)).body).toEqual({ id: alice, aiDenied: true });

      expect((await as(alice).status()).body).toEqual({ enabled: false, dataSharing: 'schema', source: null, reason: 'denied', personal: null });
      expect((await as(alice).chat()).status).toBe(403);
      expect((await as(alice).save(OWN)).status).toBe(403);
      expect(providers.chat).not.toHaveBeenCalled();
      // Everyone else is untouched, and the admin sees who is refused.
      expect((await as(bob).status()).body.enabled).toBe(true);
      const users = (await request(app).get('/api/admin/users').set('x-test-user', admin)).body.users;
      expect(users.find((u) => u.id === alice).aiDenied).toBe(true);
      expect(users.find((u) => u.id === bob).aiDenied).toBe(false);

      await deny(alice, false);
      expect((await as(alice).status()).body.enabled).toBe(true);
    });

    test('refused stays refused when the instance has no provider either', async () => {
      await deny(alice, true);
      db.prepare("DELETE FROM app_settings WHERE key = 'ai_config'").run();
      expect((await as(alice).status()).body).toMatchObject({ enabled: false, reason: 'denied', personal: null });
      expect((await as(alice).save(OWN)).status).toBe(403);
    });

    test('an admin can remove the instance provider: users are back to bringing their own', async () => {
      setAiConfig({ dataSharing: 'schema+cache' });
      const res = await request(app).put('/api/admin/settings/ai').set('x-test-user', admin).send({ removeProvider: true });
      expect(res.body.ai).toMatchObject({ enabled: true, active: false, baseUrl: '', model: '', hasApiKey: false, dataSharing: 'schema+cache' });
      expect((await as(alice).status()).body).toMatchObject({ enabled: false, reason: 'setup' });
    });

    test('only an admin decides who is refused', async () => {
      const res = await request(app).put(`/api/admin/users/${alice}/ai-access`).set('x-test-user', bob).send({ denied: true });
      expect(res.status).toBe(403);
      expect((await deny('nobody', true)).status).toBe(404);
      expect((await deny(alice, 'yes')).status).toBe(400);
    });
  });

  test('the admin\'s switch off is "no AI here": no instance provider, no personal one', async () => {
    await as(alice).save(OWN);
    setAiConfig({ ...INSTANCE, enabled: false });
    for (const user of [alice, bob]) {
      expect((await as(user).status()).body).toMatchObject({ enabled: false, reason: 'off', personal: null });
    }
    expect((await as(alice).chat()).status).toBe(409);
    expect((await as(alice).save(OWN)).status).toBe(403);
    expect(providers.chat).not.toHaveBeenCalled();
  });
});
