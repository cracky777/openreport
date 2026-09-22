const request = require('supertest');
const { buildApp, seedUser, db } = require('./helpers/testApp');
const { getAiConfig } = require('../utils/settingsHelper');

const app = buildApp();
const KEY = 'sk-very-secret';
const VALID = { provider: 'anthropic', baseUrl: 'https://api.anthropic.test/', model: 'claude-x', apiKey: KEY, enabled: true };

describe('admin AI settings', () => {
  let admin, editor;
  beforeAll(() => {
    admin = seedUser({ role: 'admin' });
    editor = seedUser({ role: 'editor' });
  });
  beforeEach(() => { db.prepare("DELETE FROM app_settings WHERE key = 'ai_config'").run(); });

  const put = (uid, body) => request(app).put('/api/admin/settings/ai').set('x-test-user', uid).send(body);
  const stored = () => JSON.parse(db.prepare("SELECT value FROM app_settings WHERE key = 'ai_config'").get().value);

  test('a non-admin can neither read nor write it', async () => {
    expect((await put(editor, VALID)).status).toBe(403);
    expect((await request(app).post('/api/admin/settings/ai/test').set('x-test-user', editor)).status).toBe(403);
  });

  test('the key is encrypted at rest and never returned', async () => {
    const res = await put(admin, VALID);
    expect(res.status).toBe(200);
    expect(res.body.ai).toEqual({
      enabled: true, active: true, provider: 'anthropic', baseUrl: 'https://api.anthropic.test', model: 'claude-x', dataSharing: 'schema', hasApiKey: true,
    });
    expect(JSON.stringify(res.body)).not.toContain(KEY);
    expect(stored().apiKey).toMatch(/^enc:v1:/);
    expect(getAiConfig().apiKey).toBe(KEY);

    const read = await request(app).get('/api/admin/settings').set('x-test-user', admin);
    expect(read.body.ai.hasApiKey).toBe(true);
    expect(JSON.stringify(read.body)).not.toContain(KEY);
    expect(JSON.stringify(read.body)).not.toContain('enc:v1:');
  });

  // The switch is on from the start: configuring a provider IS the decision to
  // use the assistant. But on is not active — with nobody to talk to, the
  // editor must not offer a panel that can only fail.
  describe('enabled by default', () => {
    const status = () => request(app).get('/api/ai/status').set('x-test-user', admin);

    test('a fresh instance: switch on, assistant not offered', async () => {
      const read = await request(app).get('/api/admin/settings').set('x-test-user', admin);
      expect(read.body.ai).toMatchObject({ enabled: true, active: false, baseUrl: '', model: '' });
      expect(getAiConfig().enabled).toBe(false);
      expect((await status()).body.enabled).toBe(false);
    });

    test('configuring the provider is enough — no second "enable" step', async () => {
      const { enabled: _omit, ...provider } = VALID;
      const res = await put(admin, provider);
      expect(res.body.ai).toMatchObject({ enabled: true, active: true });
      expect((await status()).body.enabled).toBe(true);
    });

    test('saving the provider field by field is not an error on a fresh instance', async () => {
      expect((await put(admin, { provider: 'anthropic' })).status).toBe(200);
      expect((await put(admin, { baseUrl: 'https://api.anthropic.test' })).status).toBe(200);
      expect(getAiConfig().enabled).toBe(false);
      expect((await put(admin, { model: 'claude-x' })).body.ai.active).toBe(true);
    });

    test('on without a provider is a state, not an error: it is when users bring their own', async () => {
      expect((await put(admin, { enabled: false })).status).toBe(200);
      const res = await put(admin, { enabled: true });
      expect(res.status).toBe(200);
      expect(res.body.ai).toMatchObject({ enabled: true, active: false });
    });

    test('an admin who turns it off keeps it off', async () => {
      await put(admin, VALID);
      expect((await put(admin, { enabled: false })).body.ai).toMatchObject({ enabled: false, active: false });
      expect((await status()).body.enabled).toBe(false);
      // Editing the provider afterwards does not switch it back on.
      expect((await put(admin, { model: 'claude-y' })).body.ai.enabled).toBe(false);
    });
  });

  test('an empty key keeps the stored one; clearApiKey removes it', async () => {
    await put(admin, VALID);
    await put(admin, { model: 'claude-y', apiKey: '' });
    expect(getAiConfig().apiKey).toBe(KEY);
    expect(getAiConfig().model).toBe('claude-y');

    const res = await put(admin, { clearApiKey: true });
    expect(res.body.ai.hasApiKey).toBe(false);
  });

  test('data sharing defaults to schema only and is whitelisted', async () => {
    await put(admin, VALID);
    expect(getAiConfig().dataSharing).toBe('schema');
    expect((await put(admin, { dataSharing: 'everything' })).status).toBe(400);
    expect((await put(admin, { dataSharing: 'schema+cache' })).body.ai.dataSharing).toBe('schema+cache');
  });

  test.each([
    ['an unknown provider', { provider: 'skynet' }],
    ['a non-http URL', { baseUrl: 'file:///etc/passwd' }],
    ['a URL with credentials', { baseUrl: 'https://user:pw@host.test' }],
    ['an empty model', { model: '  ' }],
  ])('%s is a 400', async (_what, patch) => {
    const res = await put(admin, patch);
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  test('an undecryptable key disables the assistant instead of throwing', async () => {
    await put(admin, VALID);
    const cfg = stored();
    db.prepare("UPDATE app_settings SET value = ? WHERE key = 'ai_config'")
      .run(JSON.stringify({ ...cfg, apiKey: 'enc:v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }));
    const live = getAiConfig();
    expect(live.enabled).toBe(false);
    expect(live.keyError).toBeTruthy();
  });
});
