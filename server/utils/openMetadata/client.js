// Reading OpenMetadata, never writing it: its MCP server (JSON-RPC over HTTP,
// stateless) for the three read tools the assistant relays, its REST API for
// the lineage (the MCP leaves the SQL of an edge out).
//
// Called with the bot's Bearer token directly: OpenMetadata 2.0.5 announces an
// OAuth discovery with relative addresses that generic MCP clients choke on.
// The token is in a header and nowhere else — not in an error, a log or a
// result: what fails is said by its HTTP status.

const { hostIsBlocked, hostResolvesInternally } = require('../ssrfGuard');

const TIMEOUT_MS = 30 * 1000;
const MAX_BYTES = 4 * 1024 * 1024;

// The only MCP tools relayed. Writing ones (patch_entity, create_entity,
// create_lineage, create_test_case…) are refused here, whatever the token allows.
const READ_TOOLS = new Set(['search_metadata', 'get_entity_details', 'get_entity_lineage', 'get_user_context']);

class OpenMetadataError extends Error {}

// The cloud refuses an internal address, as for a datasource or an AI provider
// (ssrfGuard); a self-hosted instance reaches its catalog on localhost.
async function checkHost(base) {
  const host = new URL(base).hostname;
  if (hostIsBlocked(host) || await hostResolvesInternally(host)) throw new OpenMetadataError('This OpenMetadata address is not allowed');
}

async function readCapped(res) {
  if (!res.body || !res.body.getReader) return res.text();
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BYTES) {
      try { await reader.cancel(); } catch { /* already closed: the answer is refused either way */ }
      throw new OpenMetadataError('OpenMetadata answered with more than the assistant reads');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

async function send(om, path, init, fetchImpl = fetch) {
  await checkHost(om.url);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    // A redirect would carry the token to wherever it points: refused.
    res = await fetchImpl(`${om.url}${path}`, { ...init, headers: { ...init.headers, Authorization: `Bearer ${om.token}` }, redirect: 'manual', signal: ctrl.signal });
  } catch (err) {
    clearTimeout(timer);
    throw new OpenMetadataError(err && err.name === 'AbortError' ? 'OpenMetadata did not answer in time' : 'OpenMetadata cannot be reached');
  }
  try {
    const text = await readCapped(res);
    if (res.status === 401 || res.status === 403) throw new OpenMetadataError(`OpenMetadata refused the token (${res.status})`);
    if (res.status === 404) return { status: 404, text };
    if (res.status < 200 || res.status >= 300) throw new OpenMetadataError(`OpenMetadata answered ${res.status}`);
    return { status: res.status, text, type: res.headers.get('content-type') || '' };
  } finally {
    clearTimeout(timer);
  }
}

/** GET on the REST API; null when the entity does not exist. */
async function restGet(om, path, deps = {}) {
  const { status, text } = await send(om, `/api/v1${path}`, { method: 'GET', headers: { Accept: 'application/json' } }, deps.fetch);
  if (status === 404) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new OpenMetadataError('OpenMetadata answered something that is not JSON');
  }
}

// The answer of a JSON-RPC call, sent back as JSON or as Server-Sent Events
// (`data: {...}` lines): the message carrying our id.
function rpcAnswer(text, id) {
  const candidates = [];
  try {
    candidates.push(JSON.parse(text));
  } catch {
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue;
      try { candidates.push(JSON.parse(line.slice(5).trim())); } catch { /* a keep-alive or a partial line */ }
    }
  }
  const all = candidates.flatMap((c) => (Array.isArray(c) ? c : [c]));
  return all.find((m) => m && m.id === id) || all.find((m) => m && (m.result || m.error)) || null;
}

let nextId = 1;
async function rpc(om, method, params, deps = {}) {
  const id = nextId++;
  const { status, text } = await send(om, '/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }),
  }, deps.fetch);
  if (status === 404) throw new OpenMetadataError('This OpenMetadata has no MCP server at /mcp');
  const msg = rpcAnswer(text, id);
  if (!msg) throw new OpenMetadataError('OpenMetadata answered something that is not JSON-RPC');
  if (msg.error) throw new OpenMetadataError(`OpenMetadata: ${String(msg.error.message || 'error').slice(0, 200)}`);
  return msg.result;
}

/** One MCP tool, read tools only; its JSON result parsed when it is JSON. */
async function callTool(om, name, args, deps = {}) {
  if (!READ_TOOLS.has(name)) throw new OpenMetadataError(`${String(name).slice(0, 60)} is not a read tool of OpenMetadata`);
  const result = await rpc(om, 'tools/call', { name, arguments: args && typeof args === 'object' ? args : {} }, deps);
  const text = result && Array.isArray(result.content) ? result.content.filter((c) => c && c.type === 'text').map((c) => c.text).join('\n') : '';
  if (result && result.isError) throw new OpenMetadataError(`OpenMetadata: ${text.slice(0, 300) || 'the tool failed'}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// The schemas OpenMetadata gives its read tools, kept a few minutes per
// catalog: the assistant is offered them as OpenMetadata describes them.
const TOOL_LIST_TTL_MS = 10 * 60 * 1000;
const toolLists = new Map();
async function readToolSchemas(om, deps = {}) {
  const key = om.url;
  const hit = toolLists.get(key);
  if (hit && hit.at > Date.now() - TOOL_LIST_TTL_MS) return hit.tools;
  const result = await rpc(om, 'tools/list', {}, deps);
  const tools = (result && Array.isArray(result.tools) ? result.tools : [])
    .filter((t) => t && READ_TOOLS.has(t.name) && t.name !== 'get_user_context')
    .map((t) => ({ name: t.name, description: String(t.description || '').slice(0, 1000), parameters: t.inputSchema && typeof t.inputSchema === 'object' ? t.inputSchema : { type: 'object', properties: {} } }));
  toolLists.set(key, { at: Date.now(), tools });
  return tools;
}

/** The admin's test: who the token is, and whether it could write. */
async function testConnection(om, deps = {}) {
  try {
    await rpc(om, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'open-report', version: '1' } }, deps);
    const who = await callTool(om, 'get_user_context', {}, deps);
    const u = who && typeof who === 'object' ? (who.user || who) : {};
    const name = u.displayName || u.name || u.email || null;
    const isAdmin = !!(u.isAdmin || who.isAdmin);
    return { ok: true, account: name ? String(name).slice(0, 120) : null, isAdmin };
  } catch (err) {
    if (err instanceof OpenMetadataError) return { ok: false, error: err.message };
    console.error('[openmetadata test]', err && err.message);
    return { ok: false, error: 'The test failed' };
  }
}

module.exports = { restGet, callTool, readToolSchemas, testConnection, rpcAnswer, OpenMetadataError, READ_TOOLS };
