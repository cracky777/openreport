// Chat-completions wire format — the one OpenAI, Mistral, Ollama, LM Studio,
// Azure and OpenRouter share. Maps to and from the neutral message shape
// defined in ./index.js.

function toWireMessages(system, messages) {
  const out = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'tool') {
      out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
    } else if (m.role === 'assistant') {
      const msg = { role: 'assistant', content: m.text || null };
      if (m.toolCalls && m.toolCalls.length) {
        msg.tool_calls = m.toolCalls.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: JSON.stringify(c.args || {}) },
        }));
      }
      out.push(msg);
    } else {
      out.push({ role: 'user', content: m.text || '' });
    }
  }
  return out;
}

function buildRequest({ config, system, messages, tools }) {
  const headers = { 'content-type': 'application/json' };
  // Local servers (Ollama, LM Studio) take no key at all.
  if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;
  const body = { model: config.model, messages: toWireMessages(system, messages) };
  if (tools && tools.length) {
    body.tools = tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  }
  return { url: `${config.baseUrl}/chat/completions`, headers, body };
}

function parseResponse(json) {
  const msg = json && json.choices && json.choices[0] && json.choices[0].message;
  if (!msg) throw new Error('The provider returned no message');
  const toolCalls = (msg.tool_calls || []).map((c, i) => {
    const fn = c.function || {};
    let args = null;
    let argsError = null;
    // `arguments` is a JSON STRING here, and small models routinely break it.
    // Reported back to the model as a tool error rather than thrown, so it
    // gets one chance to repair its own call.
    try {
      args = fn.arguments ? JSON.parse(fn.arguments) : {};
    } catch {
      argsError = 'Tool arguments were not valid JSON';
    }
    return { id: c.id || `call_${i}`, name: fn.name, args, argsError };
  });
  return {
    text: typeof msg.content === 'string' ? msg.content : '',
    toolCalls,
    usage: json.usage
      ? { inputTokens: json.usage.prompt_tokens || 0, outputTokens: json.usage.completion_tokens || 0 }
      : null,
  };
}

module.exports = { buildRequest, parseResponse };
