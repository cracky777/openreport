// One call shape over both wire protocols, so the agent loop never knows
// which provider the admin plugged in.
//
// Neutral messages:
//   { role: 'user', text }
//   { role: 'assistant', text, toolCalls: [{ id, name, args }] }
//   { role: 'tool', toolCallId, name, content, isError }
// Neutral tools: { name, description, parameters (JSON Schema) }.

const openaiCompat = require('./openaiCompat');
const anthropic = require('./anthropic');
const { blockListEnforced, hostIsBlocked, hostResolvesInternally } = require('../../ssrfGuard');

const ADAPTERS = { 'openai-compat': openaiCompat, anthropic };
const TIMEOUT_MS = 60_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

// What reaches the client and the logs. Built from the status and a short
// reason only: the upstream body can echo the request, key included.
class AiProviderError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'AiProviderError';
    this.status = status;
  }
}

function reasonForStatus(status) {
  if (status === 401 || status === 403) return 'The AI provider rejected the API key';
  if (status === 404) return 'The AI provider did not find this model or endpoint — check the base URL and the model name';
  if (status === 429) return 'The AI provider is rate-limiting this key';
  if (status >= 500) return 'The AI provider is unavailable';
  return `The AI provider refused the request (${status})`;
}

// An admin-supplied URL is an outbound target like a datasource host or a
// webhook, under the same policy gate. Off by default in OSS, where the
// provider is often an Ollama on localhost.
async function assertHostAllowed(url) {
  if (!blockListEnforced()) return;
  const host = new URL(url).hostname;
  if (hostIsBlocked(host) || await hostResolvesInternally(host)) {
    throw new AiProviderError(400, 'This AI provider host is not reachable from the server');
  }
}

// A 5xx or a 429 from a provider is weather, not a verdict: measured against a
// real one, the same request went through a second later. The author should
// not have to be the retry loop. Bounded and short — they are waiting — and
// never on a 4xx, which no amount of asking again will fix.
const RETRY_DELAYS_MS = [700, 1800];
const isTransient = (err) => err instanceof AiProviderError && (err.upstream === 429 || err.upstream >= 500);

async function chat(request, deps = {}) {
  const sleep = deps.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; ; attempt++) {
    try {
      return await chatOnce(request, deps);
    } catch (err) {
      if (!isTransient(err) || attempt >= RETRY_DELAYS_MS.length) throw err;
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
}

async function chatOnce({ config, system, messages, tools }, deps) {
  const adapter = ADAPTERS[config.provider];
  if (!adapter) throw new AiProviderError(400, 'Unknown AI provider');
  const doFetch = deps.fetch || fetch;
  const { url, headers, body } = adapter.buildRequest({ config, system, messages, tools });
  await assertHostAllowed(url);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs || TIMEOUT_MS);
  let res;
  let raw;
  try {
    res = await doFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
      redirect: 'error', // a redirect could carry the key to another host
    });
    raw = await res.text();
  } catch (e) {
    if (e instanceof AiProviderError) throw e;
    throw new AiProviderError(502, e.name === 'AbortError'
      ? 'The AI provider did not answer in time'
      : 'The AI provider could not be reached');
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const err = new AiProviderError(502, reasonForStatus(res.status));
    // The provider's own status, for the retry decision only: what the client
    // sees stays the 502 and the short reason.
    err.upstream = res.status;
    throw err;
  }
  if (raw.length > MAX_RESPONSE_BYTES) throw new AiProviderError(502, 'The AI provider answer was too large');
  try {
    return adapter.parseResponse(JSON.parse(raw));
  } catch {
    throw new AiProviderError(502, 'The AI provider returned an unreadable answer');
  }
}

module.exports = { chat, AiProviderError };
