// An install with no DATASOURCE_ENC_KEY must refuse an API key outright: the
// alternative is a provider secret sitting in clear in app_settings.
jest.mock('../utils/secretCrypto', () => ({
  ...jest.requireActual('../utils/secretCrypto'),
  encrypt: () => { throw new Error('DATASOURCE_ENC_KEY not configured'); },
}));

const { setAiConfig, publicAiConfig } = require('../utils/settingsHelper');
const db = require('../db');

test('saving a key without an encryption key fails and stores nothing', () => {
  expect(() => setAiConfig({ baseUrl: 'https://api.test', model: 'm', apiKey: 'sk-x' })).toThrow(/DATASOURCE_ENC_KEY/);
  expect(db.prepare("SELECT value FROM app_settings WHERE key = 'ai_config'").get()).toBeUndefined();
});

test('a keyless provider needs no encryption key', () => {
  setAiConfig({ baseUrl: 'http://localhost:11434/v1', model: 'llama3', enabled: true });
  expect(publicAiConfig()).toMatchObject({ enabled: true, hasApiKey: false });
});
