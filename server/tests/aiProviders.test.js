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
