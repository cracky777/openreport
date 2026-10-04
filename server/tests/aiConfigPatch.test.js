const { patchAiConfig } = require('../utils/settingsHelper');

// The Admin form sends back every field of the AI settings, changed or not.
// Only a changed field is checked: a config switched on before its provider was
// filled in (empty base URL and model) has to be switchable off again.
describe('patching the AI settings', () => {
  const onWithoutProvider = patchAiConfig(null, { enabled: true, dataSharing: 'schema' });

  test('switched off with the empty provider fields sent back as they are', () => {
    const next = patchAiConfig(onWithoutProvider, { enabled: false, provider: 'openai-compat', baseUrl: '', model: '', dataSharing: 'schema' });
    expect(next.enabled).toBe(false);
    expect(next.baseUrl).toBe('');
  });

  test('a changed field is still checked', () => {
    expect(() => patchAiConfig(onWithoutProvider, { baseUrl: 'not a url' })).toThrow(/Base URL must be a valid/);
    const configured = patchAiConfig(null, { baseUrl: 'http://llm.test/v1', model: 'm' });
    expect(() => patchAiConfig(configured, { model: '' })).toThrow(/Model must be 1 to 200/);
    expect(() => patchAiConfig(configured, { baseUrl: 'ftp://llm.test' })).toThrow(/Base URL must be a valid/);
    // Sent back unchanged, a valid URL passes as it is.
    expect(patchAiConfig(configured, { baseUrl: 'http://llm.test/v1', model: 'm', enabled: false }).enabled).toBe(false);
  });
});
