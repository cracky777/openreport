// Anthropic Messages API. Maps to and from the neutral message shape defined
// in ./index.js.

const API_VERSION = '2023-06-01';
const MAX_TOKENS = 8192;

function toWireMessages(messages) {
  const out = [];
  for (const m of messages) {
    if (m.role === 'tool') {
      const block = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content };
      if (m.isError) block.is_error = true;
      // Every result of one assistant turn belongs in a single user message:
      // the API rejects two user messages in a row.
      const last = out[out.length - 1];
      if (last && last.role === 'user' && Array.isArray(last.content) && last.content[0].type === 'tool_result') {
        last.content.push(block);
      } else {
        out.push({ role: 'user', content: [block] });
      }
    } else if (m.role === 'assistant') {
      const content = [];
      if (m.text) content.push({ type: 'text', text: m.text });
      for (const c of m.toolCalls || []) {
        content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args || {} });
      }
      out.push({ role: 'assistant', content });
    } else {
      out.push({ role: 'user', content: m.text || '' });
    }
  }
  return out;
}

function buildRequest({ config, system, messages, tools }) {
  const headers = {
    'content-type': 'application/json',
    'x-api-key': config.apiKey,
    'anthropic-version': API_VERSION,
  };
  const body = {
    model: config.model,
    max_tokens: MAX_TOKENS,
    system,
    messages: toWireMessages(messages),
  };
  if (tools && tools.length) {
    body.tools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  }
  return { url: `${config.baseUrl}/v1/messages`, headers, body };
}

function parseResponse(json) {
  if (!json || !Array.isArray(json.content)) throw new Error('The provider returned no message');
  const text = json.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const toolCalls = json.content
    .filter((b) => b.type === 'tool_use')
    .map((b) => ({ id: b.id, name: b.name, args: b.input || {}, argsError: null }));
  return {
    text,
    toolCalls,
    usage: json.usage
      ? { inputTokens: json.usage.input_tokens || 0, outputTokens: json.usage.output_tokens || 0 }
      : null,
  };
}

module.exports = { buildRequest, parseResponse };
