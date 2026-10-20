// The Claude subscription (Pro / Max plans): the assistant runs on the Claude
// Agent SDK, paid by the plan's monthly Agent SDK credit, with the token the
// user made with `claude setup-token`. A PERSONAL provider only (access.js):
// a token is one person's plan, never an instance's or an organization's.
//
// The SDK runs the model's steps itself. It gets exactly what the HTTP engines
// get — our system prompt, our tools — and nothing of Claude Code: no built-in
// tool (no file, no shell, no web), no settings or CLAUDE.md read from the
// server's disk, no session written to it. Our tools reach it as in-process
// MCP tools whose handlers are the assistant's own `execute`, so every guard
// of a turn (cache-only reads, validation, readings) holds unchanged.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { z } = require('zod');
const { AiProviderError } = require('./error');

const PROVIDER = 'claude-subscription';
const SERVER = 'openreport';
// A whole turn, several model steps: longer than one HTTP call.
const TURN_TIMEOUT_MS = 180_000;
const MAX_REASON = 200;

// ESM-only package, loaded once, when first needed: an instance whose users
// never pick this provider never loads it. Looked up on the exports so a test
// can put a fake SDK in its place.
let sdkPromise = null;
function loadSdk() {
  sdkPromise = sdkPromise || import('@anthropic-ai/claude-agent-sdk');
  return sdkPromise;
}

// The conversation as one prompt: the SDK takes a user message, not a
// history. Earlier turns are quoted; the assistant's lines are its own digests
// (a proposal shown, a question asked), exactly what the HTTP engines replay.
function transcript(messages) {
  const last = messages[messages.length - 1];
  const before = messages.slice(0, -1);
  if (!before.length) return last.text;
  const lines = before.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`);
  return `Conversation so far (your own lines are digests of your earlier answers, not to be repeated):\n${lines.join('\n')}\n\nUser: ${last.text}`;
}

// The prompt as the SDK takes it: a string, or — when the last message shows
// the model a page (the studio's review of an applied change) — one user
// message of content blocks, the images with the words.
function promptOf(messages) {
  const last = messages[messages.length - 1];
  const text = transcript(messages);
  if (!last.images || !last.images.length) return text;
  const content = [
    ...last.images.map((img) => ({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } })),
    { type: 'text', text },
  ];
  return (async function* one() {
    yield { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null };
  }());
}

// Where the CLI runs. Nothing is read from it (settingSources: []) and nothing
// written (persistSession: false); it only has to exist, away from the server's code.
let workDir = null;
function cwd() {
  if (!workDir) {
    workDir = path.join(os.tmpdir(), 'openreport-claude');
    fs.mkdirSync(workDir, { recursive: true });
  }
  return workDir;
}

// The subprocess environment. The user's token is the only credential: the
// server's own keys, if any, never pay for a user's turn. (An env given to the
// SDK replaces the subprocess's entirely, hence the copy of process.env.)
function environment(token) {
  const env = { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: 'openreport', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' };
  for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX']) delete env[k];
  if (token) env.CLAUDE_CODE_OAUTH_TOKEN = token;
  return env;
}

// The CLI's own words — from the result it ended on, or from the exception the
// SDK threw (an auth failure ends that way) — cut short and with any
// token-looking string removed, behind a reason the user can act on.
function reasonOf({ errors = [], subtype = '' }) {
  const raw = [...errors, subtype].filter(Boolean).join('; ').replace(/sk-ant-[\w-]+/g, '…').slice(0, MAX_REASON);
  if (subtype === 'error_max_budget_usd') return 'Claude stopped: the turn went over its budget';
  if (/credential|authenticat|unauthori|oauth|401|403/i.test(raw)) return 'Claude refused the subscription token: make a new one with `claude setup-token` and save it again';
  if (/credit|usage limit|rate.?limit|429|quota/i.test(raw)) return 'Your Claude plan has no Agent SDK credit left, or Claude is rate-limiting it';
  if (/spawn|ENOENT|not found|executable|binary/i.test(raw)) return 'Claude could not be started on this server';
  return `Claude stopped: ${raw || 'no reason given'}`;
}

/**
 * One turn on the SDK — same contract as providers.runTurn.
 * @param deps.sdk  a fake SDK (tests); deps.timeoutMs
 */
const LAUNCH_RETRY_MS = 1500;
const LAUNCH_ATTEMPTS = 3;

// One claude.exe at a time per token: a review turn right after a card and
// the next question typed would start two 260 MB binaries at once, and on a
// busy machine the second spawn is the one the OS refuses (seen by Jonathan
// while test suites ran beside the app). Turns of one user wait their turn;
// other users' tokens are other queues.
const queues = new Map();
async function runTurn(args, deps = {}) {
  const key = args.config.apiKey || '';
  const ahead = queues.get(key) || Promise.resolve();
  const mine = ahead.catch(() => {}).then(() => runTurnNow(args, deps));
  queues.set(key, mine);
  try {
    return await mine;
  } finally {
    if (queues.get(key) === mine) queues.delete(key);
  }
}

async function runTurnNow({ config, system, messages, tools, maxSteps, execute }, deps = {}) {
  const sdk = deps.sdk || await module.exports.loadSdk();
  let ended = false;
  const mcpTools = tools.map((t) => sdk.tool(t.name, t.description, z.fromJSONSchema(t.parameters).shape, async (args) => {
    const { result, end } = await execute({ id: '', name: t.name, args: args && typeof args === 'object' ? args : {}, argsError: null });
    if (end) ended = true;
    return { content: [{ type: 'text', text: JSON.stringify(result) }], ...(result && result.error ? { isError: true } : {}) };
  }));
  const ours = new Set(tools.map((t) => `mcp__${SERVER}__${t.name}`));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs || TURN_TIMEOUT_MS);
  let words = '';
  let outcome = null;
  // The binary failed to start: a spawn error of the OS, not of the binary
  // (on Windows an antivirus holding the 260 MB file, or no room for one more
  // process while imports and builds run) — once more after a moment.
  const launchFailed = (err) => /failed to launch|^spawn /i.test(String((err && err.message) || ''));
  const attempt = async () => {
    const run = sdk.query({
      prompt: promptOf(messages),
      options: {
        systemPrompt: system,
        tools: [],
        mcpServers: { [SERVER]: sdk.createSdkMcpServer({ name: SERVER, version: '1.0.0', tools: mcpTools }) },
        permissionMode: 'default',
        // The one gate (an allowedTools list would bypass it): ours, nothing else, whatever is asked.
        canUseTool: async (name) => (ours.has(name) ? { behavior: 'allow' } : { behavior: 'deny', message: 'Not available here' }),
        settingSources: [],
        persistSession: false,
        // One more than the HTTP engines take: after the call that ends the turn,
        // the SDK still needs a step to close (they return at the call).
        maxTurns: maxSteps + 1,
        cwd: cwd(),
        env: environment(config.apiKey),
        abortController: controller,
        ...(config.model ? { model: config.model } : {}),
      },
    });
    for await (const m of run) {
      if (m.type === 'assistant' && !m.parent_tool_use_id) {
        const text = ((m.message && m.message.content) || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
        if (text.trim()) words = text;
      } else if (m.type === 'result') {
        outcome = m;
      }
    }
  };
  try {
    // A refused spawn is weather: again after a moment, the wait doubling.
    for (let n = 1; ; n++) {
      try {
        await attempt();
        break;
      } catch (err) {
        if (!launchFailed(err) || controller.signal.aborted || n >= LAUNCH_ATTEMPTS) throw err;
        console.error(`[ai claude-subscription] launch failed (${n}/${LAUNCH_ATTEMPTS}), again in a moment:`, err.message);
        await new Promise((r) => setTimeout(r, (deps.launchRetryMs ?? LAUNCH_RETRY_MS) * 2 ** (n - 1)));
      }
    }
  } catch (err) {
    if (err instanceof AiProviderError) throw err;
    // Out of steps: thrown by this SDK rather than ended on an error result.
    if (/maximum number of turns/i.test(String(err.message || ''))) return { ended: ended ? 'tool' : 'limit', text: words };
    console.error('[ai claude-subscription]', err.message);
    throw new AiProviderError(502, controller.signal.aborted ? 'Claude did not answer in time' : reasonOf({ errors: [String(err.message || '')] }));
  } finally {
    clearTimeout(timer);
  }
  if (!outcome) throw new AiProviderError(502, 'Claude returned no answer');
  if (outcome.subtype === 'error_max_turns') return { ended: ended ? 'tool' : 'limit', text: words };
  if (outcome.subtype !== 'success' || outcome.is_error) throw new AiProviderError(502, reasonOf(outcome));
  if (ended) return { ended: 'tool', text: words };
  const text = typeof outcome.result === 'string' && outcome.result.trim() ? outcome.result : words;
  return { ended: text.trim() ? 'words' : 'empty', text };
}

module.exports = { PROVIDER, runTurn, loadSdk, transcript, promptOf, environment, reasonOf };
