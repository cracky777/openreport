// One call shape over both wire protocols, so the agent loop never knows
// which provider the admin plugged in.
//
// Neutral messages:
//   { role: 'user', text, images?: [{ mediaType, data }] }   images: base64, the turn's only (never replayed)
//   { role: 'assistant', text, toolCalls: [{ id, name, args }] }
//   { role: 'tool', toolCallId, name, content, isError }
// Neutral tools: { name, description, parameters (JSON Schema) }.

const openaiCompat = require('./openaiCompat');
const anthropic = require('./anthropic');
const { blockListEnforced, hostIsBlocked, hostResolvesInternally } = require('../../ssrfGuard');

const claudeSubscription = require('./claudeSubscription');
const { AiProviderError } = require('./error');

const ADAPTERS = { 'openai-compat': openaiCompat, anthropic };
const TIMEOUT_MS = 60_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

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

// Four attempts in all: at the failure rate measured below, an author sees the
// "empty answer" message about once in fifty requests instead of once in three.
const MAX_EMPTY_RETRIES = 3;

/**
 * One turn of an assistant: the model is asked until it answers in words or a
 * tool call ends the turn. One contract for every engine, so the three
 * assistants (report, model, help) write their tool handling once:
 *
 *   execute(call) → { result, end }   result: what the model reads back (JSON-able,
 *                                     `error` marks a refusal); end: this call
 *                                     answered the turn (a proposal was taken)
 *   onWords(text) → string | null     something to push back instead of ending on
 *                                     these words (a proposal written as prose)
 *
 * HTTP providers: the steps are taken here, one chat call each. The Claude
 * subscription: the SDK takes them, with our tools in its hands.
 *
 * @returns {{ ended: 'tool'|'words'|'empty'|'limit', text: string }}
 *   tool  → text = the words that came with the ending call, after those
 *           written once a tool had answered (what a read showed: Let's Talk
 *           wrote its figures beside a second read, then proposed with one
 *           line — the figures were lost). Words before any tool answered
 *           ("let me read the data") are not the answer.
 *   words → the model's answer
 *   empty → the provider sent nothing, even asked again
 *   limit → the step budget ran out; text = the last words seen
 */
async function runTurn({ config, system, messages, tools, maxSteps, execute, onWords }, deps = {}) {
  if (config.provider === claudeSubscription.PROVIDER) return claudeSubscription.runTurn({ config, system, messages, tools, maxSteps, execute }, deps);
  const ask = deps.chat || chat;
  const convo = messages.map((m) => ({ role: m.role, text: m.text, ...(m.images && m.images.length ? { images: m.images } : {}) }));
  let emptyRetries = 0;
  let lastText = '';
  const said = [];
  for (let i = 0; i < maxSteps; i++) {
    const turn = await ask({ config, system, messages: convo, tools }, deps);
    lastText = turn.text || lastText;
    if (!turn.toolCalls.length) {
      const pushBack = onWords ? onWords(turn.text || '') : null;
      if (pushBack) {
        convo.push({ role: 'assistant', text: turn.text });
        convo.push({ role: 'user', text: pushBack });
        continue;
      }
      // Neither words nor a call. Measured against Mistral (mistral-large, 20
      // real requests): between one in three and two in three come back HTTP
      // 200 with finish_reason "error" and zero tokens — their generation
      // failed, ours is fine. The same request sent again goes through, so
      // that is what happens: nothing is added to the conversation, the model
      // is not at fault. Shown as is, the panel would stay blank and the
      // author could not tell a failure from a slow answer.
      if (!(turn.text || '').trim()) {
        if (emptyRetries < MAX_EMPTY_RETRIES) {
          emptyRetries += 1;
          continue;
        }
        return { ended: 'empty', text: '' };
      }
      return { ended: 'words', text: turn.text || '' };
    }
    convo.push({ role: 'assistant', text: turn.text, toolCalls: turn.toolCalls });
    let ended = false;
    for (const call of turn.toolCalls) {
      const { result, end } = await execute(call);
      ended = ended || !!end;
      convo.push({ role: 'tool', toolCallId: call.id, name: call.name, content: JSON.stringify(result), isError: !!(result && result.error) });
    }
    if ((i > 0 || ended) && (turn.text || '').trim()) said.push(turn.text.trim());
    if (ended) return { ended: 'tool', text: said.join('\n\n') };
  }
  return { ended: 'limit', text: lastText };
}

module.exports = { chat, runTurn, AiProviderError };
