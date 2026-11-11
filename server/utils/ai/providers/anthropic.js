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
    } else if (m.images && m.images.length) {
      // A page shown to the model (the studio's review of an applied change).
      out.push({ role: 'user', content: [
        ...m.images.map((img) => ({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } })),
        { type: 'text', text: m.text || '' },
      ] });
    } else {
      out.push({ role: 'user', content: m.text || '' });
    }
  }
  return out;
}

// Prompt caching: a turn calls the model several times (a reading, then the
// card), each time with the same tools, consignes and schema — tens of
// thousands of tokens read again from scratch. Two markers: the end of the
// system prompt (tools + system, the same for every step of a turn) and the
// end of the conversation (each step reuses the previous one's prefix).
const CACHE = { type: 'ephemeral' };

function withCacheMark(wire) {
  const last = wire[wire.length - 1];
  if (!last) return wire;
  const blocks = typeof last.content === 'string' ? [{ type: 'text', text: last.content }] : last.content;
  // An empty text block cannot carry a marker (the API refuses it).
  if (!blocks.length || (blocks[blocks.length - 1].type === 'text' && !blocks[blocks.length - 1].text)) return wire;
  const marked = [...blocks.slice(0, -1), { ...blocks[blocks.length - 1], cache_control: CACHE }];
  return [...wire.slice(0, -1), { ...last, content: marked }];
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
    system: system ? [{ type: 'text', text: system, cache_control: CACHE }] : undefined,
    messages: withCacheMark(toWireMessages(messages)),
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
      ? {
        inputTokens: json.usage.input_tokens || 0,
        outputTokens: json.usage.output_tokens || 0,
        cacheReadTokens: json.usage.cache_read_input_tokens || 0,
        cacheWriteTokens: json.usage.cache_creation_input_tokens || 0,
      }
      : null,
  };
}

module.exports = { buildRequest, parseResponse };
