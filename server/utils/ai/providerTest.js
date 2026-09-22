// Tries a SAVED provider config with a one-tool round trip. Reaching the
// provider is half the answer — a small local model that answers but cannot
// call tools would leave the assistant unable to propose anything, so that is
// reported too. Shared by the instance's settings and the cloud's organization
// settings.

const providers = require('./providers');
const tools = require('./tools');

async function testProvider(config) {
  if (config.keyError) return { ok: false, toolCalling: false, error: config.keyError };
  if (!config.baseUrl || !config.model) return { ok: false, toolCalling: false, error: 'Save a base URL and a model first' };
  try {
    const turn = await providers.chat({
      config,
      system: 'This is a connectivity check. Call the `ping` tool with ok=true.',
      messages: [{ role: 'user', text: 'ping' }],
      tools: [tools.PING],
    });
    return { ok: true, toolCalling: turn.toolCalls.some((c) => c.name === 'ping') };
  } catch (err) {
    const known = err instanceof providers.AiProviderError;
    if (!known) console.error('[ai test]', err);
    return { ok: false, toolCalling: false, error: known ? err.message : 'The test failed' };
  }
}

module.exports = { testProvider };
