const { chat, AiProviderError } = require('../utils/ai/providers');

const TOOLS = [{ name: 'ping', description: 'd', parameters: { type: 'object', properties: {} } }];
const KEY = 'sk-secret-123';

function fakeFetch(status, json) {
  return jest.fn(async () => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(json) }));
}

describe('openai-compat adapter', () => {
  const config = { provider: 'openai-compat', baseUrl: 'http://llm.test/v1', model: 'm1', apiKey: KEY };

  test('maps the request and a tool-call answer', async () => {
    const fetch = fakeFetch(200, {
      choices: [{ message: { content: 'hi', tool_calls: [{ id: 'c1', function: { name: 'ping', arguments: '{"ok":true}' } }] } }],
      usage: { prompt_tokens: 3, completion_tokens: 4 },
    });
    const out = await chat({ config, system: 'SYS', messages: [{ role: 'user', text: 'yo' }], tools: TOOLS }, { fetch });

    const [url, init] = fetch.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(url).toBe('http://llm.test/v1/chat/completions');
    expect(init.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(init.redirect).toBe('error');
    expect(body.messages).toEqual([{ role: 'system', content: 'SYS' }, { role: 'user', content: 'yo' }]);
    expect(body.tools[0]).toEqual({ type: 'function', function: { name: 'ping', description: 'd', parameters: TOOLS[0].parameters } });
    expect(out).toEqual({
      text: 'hi',
      toolCalls: [{ id: 'c1', name: 'ping', args: { ok: true }, argsError: null }],
      usage: { inputTokens: 3, outputTokens: 4 },
    });
  });

  test('sends a tool round trip back in wire format', async () => {
    const fetch = fakeFetch(200, { choices: [{ message: { content: 'done' } }] });
    await chat({
      config,
      system: 'S',
      messages: [
        { role: 'user', text: 'q' },
        { role: 'assistant', text: '', toolCalls: [{ id: 'c1', name: 'ping', args: { ok: true } }] },
        { role: 'tool', toolCallId: 'c1', name: 'ping', content: '{"ok":true}' },
      ],
      tools: TOOLS,
    }, { fetch });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.messages[2].tool_calls[0]).toEqual({ id: 'c1', type: 'function', function: { name: 'ping', arguments: '{"ok":true}' } });
    expect(body.messages[3]).toEqual({ role: 'tool', tool_call_id: 'c1', content: '{"ok":true}' });
  });

  test('malformed tool arguments become an argsError, not a throw', async () => {
    const fetch = fakeFetch(200, { choices: [{ message: { content: null, tool_calls: [{ id: 'c1', function: { name: 'ping', arguments: '{oops' } }] } }] });
    const out = await chat({ config, system: 'S', messages: [{ role: 'user', text: 'q' }], tools: TOOLS }, { fetch });
    expect(out.toolCalls[0].args).toBeNull();
    expect(out.toolCalls[0].argsError).toMatch(/not valid JSON/);
  });

  test('no authorization header for a keyless local server', async () => {
    const fetch = fakeFetch(200, { choices: [{ message: { content: 'x' } }] });
    await chat({ config: { ...config, apiKey: '' }, system: 'S', messages: [{ role: 'user', text: 'q' }] }, { fetch });
    expect(fetch.mock.calls[0][1].headers.authorization).toBeUndefined();
  });
});

describe('anthropic adapter', () => {
  const config = { provider: 'anthropic', baseUrl: 'https://api.anthropic.test', model: 'claude-x', apiKey: KEY };

  test('maps the request and a tool_use answer', async () => {
    const fetch = fakeFetch(200, {
      content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', id: 't1', name: 'ping', input: { ok: true } }],
      usage: { input_tokens: 5, output_tokens: 6 },
    });
    const out = await chat({ config, system: 'SYS', messages: [{ role: 'user', text: 'yo' }], tools: TOOLS }, { fetch });

    const [url, init] = fetch.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(url).toBe('https://api.anthropic.test/v1/messages');
    expect(init.headers['x-api-key']).toBe(KEY);
    expect(init.headers['anthropic-version']).toBe('2023-06-01');
    expect(body.system).toBe('SYS');
    expect(body.max_tokens).toBeGreaterThan(0);
    expect(body.tools[0]).toEqual({ name: 'ping', description: 'd', input_schema: TOOLS[0].parameters });
    expect(out.text).toBe('ok');
    expect(out.toolCalls).toEqual([{ id: 't1', name: 'ping', args: { ok: true }, argsError: null }]);
    expect(out.usage).toEqual({ inputTokens: 5, outputTokens: 6 });
  });

  test('groups the results of one turn into a single user message', async () => {
    const fetch = fakeFetch(200, { content: [{ type: 'text', text: 'done' }] });
    await chat({
      config,
      system: 'S',
      messages: [
        { role: 'user', text: 'q' },
        { role: 'assistant', text: 't', toolCalls: [{ id: 'a', name: 'ping', args: {} }, { id: 'b', name: 'ping', args: {} }] },
        { role: 'tool', toolCallId: 'a', name: 'ping', content: '1' },
        { role: 'tool', toolCallId: 'b', name: 'ping', content: '2', isError: true },
      ],
      tools: TOOLS,
    }, { fetch });
    const { messages } = JSON.parse(fetch.mock.calls[0][1].body);
    expect(messages).toHaveLength(3);
    expect(messages[2]).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'a', content: '1' },
        { type: 'tool_result', tool_use_id: 'b', content: '2', is_error: true },
      ],
    });
  });
});

describe('provider errors', () => {
  const config = { provider: 'openai-compat', baseUrl: 'http://llm.test/v1', model: 'm1', apiKey: KEY };
  const ask = (deps) => chat({ config, system: 'S', messages: [{ role: 'user', text: 'q' }] }, deps);

  test('an upstream error never carries the key or the upstream body', async () => {
    const fetch = fakeFetch(401, { error: { message: `Incorrect API key provided: ${KEY}` } });
    const err = await ask({ fetch }).catch((e) => e);
    expect(err).toBeInstanceOf(AiProviderError);
    expect(err.status).toBe(502);
    expect(err.message).toBe('The AI provider rejected the API key');
    expect(JSON.stringify({ ...err, message: err.message })).not.toContain(KEY);
  });

  // Seen against a real provider: a 5xx, and the same request fine a second later.
  describe('transient upstream errors are retried, the others are not', () => {
    const reply = (status, body) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });
    const good = reply(200, { choices: [{ message: { content: 'hi' } }] });

    test.each([503, 500, 429])('a %i, then an answer: the author never sees the error', async (status) => {
      const fetch = jest.fn().mockResolvedValueOnce(reply(status, {})).mockResolvedValueOnce(good);
      const sleep = jest.fn(async () => {});
      const out = await ask({ fetch, sleep });
      expect(out.text).toBe('hi');
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(sleep).toHaveBeenCalledTimes(1);
    });

    test('it gives up after three attempts, with the short reason', async () => {
      const fetch = jest.fn(async () => reply(503, {}));
      const sleep = jest.fn(async () => {});
      const err = await ask({ fetch, sleep }).catch((e) => e);
      expect(fetch).toHaveBeenCalledTimes(3);
      expect(err.status).toBe(502);
      expect(err.message).toBe('The AI provider is unavailable');
    });

    test.each([400, 401, 404])('a %i is a verdict, asked once', async (status) => {
      const fetch = jest.fn(async () => reply(status, {}));
      const sleep = jest.fn(async () => {});
      await ask({ fetch, sleep }).catch((e) => e);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    });
  });

  test('a timeout is reported as such', async () => {
    const fetch = jest.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));
    const err = await ask({ fetch, timeoutMs: 10 }).catch((e) => e);
    expect(err.message).toBe('The AI provider did not answer in time');
  });

  test('an unreadable answer is a 502, not a crash', async () => {
    const fetch = jest.fn(async () => ({ ok: true, status: 200, text: async () => '<html>' }));
    const err = await ask({ fetch }).catch((e) => e);
    expect(err).toBeInstanceOf(AiProviderError);
    expect(err.message).toMatch(/unreadable/);
  });

  test('an unknown provider is refused before any network call', async () => {
    const fetch = jest.fn();
    const err = await chat({ config: { ...config, provider: 'nope' }, system: 'S', messages: [] }, { fetch }).catch((e) => e);
    expect(err).toBeInstanceOf(AiProviderError);
    expect(fetch).not.toHaveBeenCalled();
  });

  test('with the block-list on, an internal provider host is refused', async () => {
    process.env.OPENREPORT_BLOCK_INTERNAL_HOSTS = '1';
    try {
      const fetch = jest.fn();
      const err = await chat({ config: { ...config, baseUrl: 'http://169.254.169.254/v1' }, system: 'S', messages: [] }, { fetch }).catch((e) => e);
      expect(err.message).toMatch(/not reachable/);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      delete process.env.OPENREPORT_BLOCK_INTERNAL_HOSTS;
    }
  });
});

describe('the turn runner (HTTP engines)', () => {
  const { runTurn } = require('../utils/ai/providers');
  const config = { provider: 'openai-compat', baseUrl: 'http://llm.test/v1', model: 'm1', apiKey: KEY };
  const base = { config, system: 's', messages: [{ role: 'user', text: 'q' }], tools: TOOLS };
  const calls = (...names) => ({ text: '', toolCalls: names.map((n, i) => ({ id: `c${i}`, name: n, args: {}, argsError: null })), usage: null });

  test('a call that ends the turn ends it; the others get their result and the model goes on', async () => {
    const chat = jest.fn()
      .mockResolvedValueOnce(calls('read'))
      .mockResolvedValueOnce({ text: 'Here.', toolCalls: [{ id: 'c9', name: 'propose', args: {}, argsError: null }], usage: null });
    const execute = jest.fn((call) => (call.name === 'propose' ? { result: { ok: true }, end: true } : { result: { rows: [] } }));
    expect(await runTurn({ ...base, maxSteps: 5, execute }, { chat })).toEqual({ ended: 'tool', text: 'Here.' });
    expect(execute).toHaveBeenCalledTimes(2);
    // The second step carries the first call's result back, in the neutral shape
    // (the conversation is one array, grown in place: read it by position).
    expect(chat.mock.calls[1][0].messages[2]).toEqual({ role: 'tool', toolCallId: 'c0', name: 'read', content: '{"rows":[]}', isError: false });
  });

  test('words end it, the step budget bounds it, an empty answer is asked again then reported', async () => {
    const words = jest.fn().mockResolvedValue({ text: 'Done.', toolCalls: [], usage: null });
    expect(await runTurn({ ...base, maxSteps: 3, execute: () => ({ result: {} }) }, { chat: words })).toEqual({ ended: 'words', text: 'Done.' });
    const forever = jest.fn().mockResolvedValue(calls('read'));
    expect(await runTurn({ ...base, maxSteps: 2, execute: () => ({ result: {} }) }, { chat: forever })).toEqual({ ended: 'limit', text: '' });
    expect(forever).toHaveBeenCalledTimes(2);
    const empty = jest.fn().mockResolvedValue({ text: '', toolCalls: [], usage: null });
    expect(await runTurn({ ...base, maxSteps: 6, execute: () => ({ result: {} }) }, { chat: empty })).toEqual({ ended: 'empty', text: '' });
    expect(empty).toHaveBeenCalledTimes(4);
  });

  // Let's Talk wrote its figures beside a second read, then proposed with one
  // line: the figures were lost. Words before any tool answered are not kept.
  test('the answer is the words written once a tool answered, with those of the ending call', async () => {
    const chat = jest.fn()
      .mockResolvedValueOnce({ ...calls('read'), text: 'Let me read the data.' })
      .mockResolvedValueOnce({ ...calls('read'), text: 'No product is above 70 %: Auto 56.7 %, Home 56.5 %.' })
      .mockResolvedValueOnce({ text: 'The chart compares them.', toolCalls: [{ id: 'c9', name: 'propose', args: {}, argsError: null }], usage: null });
    const execute = (call) => (call.name === 'propose' ? { result: { ok: true }, end: true } : { result: { rows: [] } });
    expect(await runTurn({ ...base, maxSteps: 5, execute }, { chat })).toEqual({ ended: 'tool', text: 'No product is above 70 %: Auto 56.7 %, Home 56.5 %.\n\nThe chart compares them.' });
  });

  test('onWords pushes back instead of ending, and the push-back joins the conversation', async () => {
    const chat = jest.fn()
      .mockResolvedValueOnce({ text: '{"widgets": []}', toolCalls: [], usage: null })
      .mockResolvedValueOnce({ text: 'ok', toolCalls: [], usage: null });
    let nudged = false;
    const onWords = (t) => { if (nudged || !t.includes('widgets')) return null; nudged = true; return 'Call the tool.'; };
    expect(await runTurn({ ...base, maxSteps: 3, execute: () => ({ result: {} }), onWords }, { chat })).toEqual({ ended: 'words', text: 'ok' });
    expect(chat.mock.calls[1][0].messages.slice(-2)).toEqual([{ role: 'assistant', text: '{"widgets": []}' }, { role: 'user', text: 'Call the tool.' }]);
  });
});

describe('the Claude subscription engine (Agent SDK)', () => {
  const { runTurn } = require('../utils/ai/providers');
  const TOKEN = 'sk-ant-oat01-my-plan-token';
  const config = { provider: 'claude-subscription', baseUrl: '', model: '', apiKey: TOKEN };
  const PING = { name: 'ping', description: 'd', parameters: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] } };
  const messages = [{ role: 'user', text: 'first' }, { role: 'assistant', text: '[Asked the user: which?]' }, { role: 'user', text: 'now this' }];
  const last = messages.slice(-1);

  // A scripted SDK: `steps` are what the model does — a tool call (our handler
  // runs, as the SDK would run it) or words — then the result it ends on.
  function fakeSdk(steps, result = { subtype: 'success', result: '' }) {
    const seen = { handled: [] };
    return {
      seen,
      tool: (name, description, inputSchema, handler) => ({ name, description, inputSchema, handler }),
      createSdkMcpServer: (o) => ({ type: 'sdk', name: o.name, instance: { tools: o.tools } }),
      query({ prompt, options }) {
        Object.assign(seen, { prompt, options });
        const tools = options.mcpServers.openreport.instance.tools;
        return (async function* run() {
          for (const step of steps) {
            if (step.call) {
              yield { type: 'assistant', parent_tool_use_id: null, message: { content: [...(step.text ? [{ type: 'text', text: step.text }] : []), { type: 'tool_use', name: `mcp__openreport__${step.call}`, input: step.args }] } };
              seen.handled.push(await tools.find((t) => t.name === step.call).handler(step.args, {}));
            } else {
              yield { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: step.text }] } };
            }
          }
          yield { type: 'result', errors: [], ...result };
        }());
      },
    };
  }

  beforeAll(() => { jest.spyOn(console, 'error').mockImplementation(() => {}); });
  afterAll(() => { jest.restoreAllMocks(); });

  test('words after a read are kept, the closing step too, words before any read are not', async () => {
    const sdk = fakeSdk([
      { call: 'read', args: { ok: true }, text: 'Let me read the data.' },
      { text: 'No product is above 70 %.' },
      { call: 'ping', args: { ok: true } },
      { text: 'The chart above compares them.' },
    ]);
    const READ = { ...PING, name: 'read' };
    const execute = (call) => (call.name === 'ping' ? { result: { ok: true }, end: true } : { result: { rows: [] } });
    const turn = await runTurn({ config, system: 's', messages: last, tools: [READ, PING], maxSteps: 4, execute }, { sdk });
    // Read, then the proposal with no words, then the answer in the closing step: the announcement is still left out.
    const quiet = fakeSdk([{ call: 'read', args: { ok: true }, text: 'Let me read the data.' }, { call: 'ping', args: { ok: true } }, { text: 'None is above 70 %.' }]);
    expect((await runTurn({ config, system: 's', messages: last, tools: [READ, PING], maxSteps: 4, execute }, { sdk: quiet })).text).toBe('None is above 70 %.');
    expect(turn.text.split(/\s+/).join(' ')).toBe('No product is above 70 %. The chart above compares them.');
  });

  test('our tools run in the SDK, our prompt with them — and nothing of Claude Code', async () => {
    const sdk = fakeSdk([{ call: 'ping', args: { ok: true }, text: 'Pinging.' }, { text: 'Done.' }]);
    const execute = jest.fn(() => ({ result: { ok: true }, end: true }));
    process.env.ANTHROPIC_API_KEY = 'sk-instance-key';
    const turn = await runTurn({ config, system: 'SYSTEM', messages, tools: [PING], maxSteps: 4, execute }, { sdk });
    delete process.env.ANTHROPIC_API_KEY;
    // The words of the ending call, and those of the step the SDK takes to close after it.
    expect(turn.ended).toBe('tool');
    expect(turn.text.split(/\s+/).join(' ')).toBe('Pinging. Done.');
    expect(execute).toHaveBeenCalledWith({ id: '', name: 'ping', args: { ok: true }, argsError: null });
    expect(sdk.seen.handled[0]).toEqual({ content: [{ type: 'text', text: '{"ok":true}' }] });
    const { options, prompt } = sdk.seen;
    expect(options).toMatchObject({ systemPrompt: 'SYSTEM', tools: [], settingSources: [], persistSession: false, maxTurns: 5, permissionMode: 'default' });
    expect(options.allowedTools).toBeUndefined();
    expect(options.model).toBeUndefined();
    expect(options.env.CLAUDE_CODE_OAUTH_TOKEN).toBe(TOKEN);
    expect(options.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(await options.canUseTool('Bash', {}, {})).toMatchObject({ behavior: 'deny' });
    expect(await options.canUseTool('mcp__openreport__ping', {}, {})).toEqual({ behavior: 'allow' });
    // The whole conversation travels as one prompt, the last message last.
    expect(prompt).toMatch(/User: first\nAssistant: \[Asked the user: which\?\]\n\nUser: now this$/);
    // The MCP tool carries the JSON Schema of ours, as a zod shape.
    expect(Object.keys(options.mcpServers.openreport.instance.tools[0].inputSchema)).toEqual(['ok']);
  });

  test('a refusal is an error the model reads; words alone end in words; a named model is passed on', async () => {
    const sdk = fakeSdk([{ call: 'ping', args: { ok: false } }, { text: 'Sorry.' }], { subtype: 'success', result: 'Sorry.' });
    const turn = await runTurn({ config: { ...config, model: 'opus' }, system: 's', messages: last, tools: [PING], maxSteps: 2, execute: () => ({ result: { error: 'no' } }) }, { sdk });
    expect(turn).toEqual({ ended: 'words', text: 'Sorry.' });
    expect(sdk.seen.handled[0]).toEqual({ content: [{ type: 'text', text: '{"error":"no"}' }], isError: true });
    expect(sdk.seen.options.model).toBe('opus');
    expect(sdk.seen.prompt).toBe('now this');
  });

  test('the SDK\'s failures are provider errors — short, and never with the token', async () => {
    const failing = (result) => runTurn({ config, system: 's', messages: last, tools: [PING], maxSteps: 2, execute: () => ({ result: {} }) }, { sdk: fakeSdk([], result) }).catch((e) => e);
    const refused = await failing({ subtype: 'error_during_execution', errors: [`invalid credential ${TOKEN}`] });
    expect(refused).toBeInstanceOf(AiProviderError);
    expect(refused).toMatchObject({ status: 502, message: expect.stringMatching(/claude setup-token/) });
    expect(refused.message).not.toContain(TOKEN);
    expect((await failing({ subtype: 'error_during_execution', errors: ['usage limit reached'] })).message).toMatch(/credit/);
    expect((await failing({ subtype: 'error_max_budget_usd', errors: [] })).message).toMatch(/budget/);
    expect(await failing({ subtype: 'error_max_turns' })).toEqual({ ended: 'limit', text: '' });
    // This SDK throws when the steps run out; a call that already ended the turn still counts.
    const outOfSteps = { ...fakeSdk([]), query: () => ({ [Symbol.asyncIterator]: () => ({ next: async () => { throw new Error('Claude Code returned an error result: Reached maximum number of turns (1)'); } }) }) };
    expect(await runTurn({ config, system: 's', messages: last, tools: [PING], maxSteps: 1, execute: () => ({ result: {} }) }, { sdk: outOfSteps })).toEqual({ ended: 'limit', text: '' });
    const throwing = (message) => runTurn({ config, system: 's', messages: last, tools: [PING], maxSteps: 2, execute: () => ({ result: {} }) }, { sdk: { ...fakeSdk([]), query() { throw new Error(message); } } }).catch((e) => e);
    expect(await throwing('spawn ENOENT')).toMatchObject({ status: 502, message: 'Claude could not be started on this server' });
    // A spawn that fails (the OS, not the binary) is tried three times in all; the third failure is the end.
    const LAUNCH = 'Claude Code native binary at C:/x/claude.exe exists but failed to launch. This usually means the binary does not match this system libc';
    const flaky = (failures) => { const ok = fakeSdk([{ text: 'Up.' }]); let n = 0; return { ...ok, calls: () => n, query(q) { n += 1; if (n <= failures) throw new Error(LAUNCH); return ok.query(q); } }; };
    const twice = flaky(2);
    expect(await runTurn({ config, system: 's', messages: last, tools: [PING], maxSteps: 2, execute: () => ({ result: {} }) }, { sdk: twice, launchRetryMs: 0 })).toEqual({ ended: 'words', text: 'Up.' });
    expect(twice.calls()).toBe(3);
    const thrice = flaky(3);
    expect(await runTurn({ config, system: 's', messages: last, tools: [PING], maxSteps: 2, execute: () => ({ result: {} }) }, { sdk: thrice, launchRetryMs: 0 }).catch((e) => e)).toMatchObject({ status: 502, message: 'Claude could not be started on this server' });
    expect(thrice.calls()).toBe(3);
    // The SDK throws on an auth failure instead of ending on an error result: same reason for the user.
    expect(await throwing(`Claude Code returned an error result: Failed to authenticate. API Error: 401 OAuth access token is invalid. ${TOKEN}`)).toMatchObject({ status: 502, message: expect.stringMatching(/refused the subscription token/) });
  });

  test('one binary at a time per token: a second turn waits for the first, another token does not', async () => {
    let running = 0;
    let peak = 0;
    const slow = { ...fakeSdk([]), query() { running += 1; peak = Math.max(peak, running); return { [Symbol.asyncIterator]: async function* it() { await new Promise((r) => setTimeout(r, 30)); running -= 1; yield { type: 'result', subtype: 'success', result: 'ok' }; } }; } };
    const go = (apiKey) => runTurn({ config: { ...config, apiKey }, system: 's', messages: last, tools: [PING], maxSteps: 2, execute: () => ({ result: {} }) }, { sdk: slow });
    await Promise.all([go('tok-a'), go('tok-a'), go('tok-a')]);
    expect(peak).toBe(1);
    await Promise.all([go('tok-a'), go('tok-b')]);
    expect(peak).toBe(2);
  });
});
