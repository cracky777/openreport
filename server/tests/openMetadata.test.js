// "Where does this number come from?": the assistant reads OpenMetadata, never
// writes it. Guarded here, against a simulated catalog: the FQNs of the
// connector, the walk from a field's column to the sources (beyond the depth
// of 3 OpenMetadata allows per call, and across an edge with no column
// lineage), MCP answers in JSON and in SSE, the closed list of relayed tools,
// nothing offered while the link is off, and the token kept out of every
// answer, log and prompt.
process.env.DATASOURCE_ENC_KEY = process.env.DATASOURCE_ENC_KEY || 'a'.repeat(64);

jest.mock('../utils/ai/providers', () => ({
  ...jest.requireActual('../utils/ai/providers'),
  chat: jest.fn(),
}));

const request = require('supertest');
const providers = require('../utils/ai/providers');
const { setAiConfig } = require('../utils/settingsHelper');
const { buildApp, seedUser, seedDatasource, seedModel, seedReport } = require('./helpers/testApp');
const { explainField, modelFqn, columnFqn, _cache } = require('../utils/openMetadata/explain');
const { callTool, rpcAnswer } = require('../utils/openMetadata/client');
const { openMetadataKit } = require('../utils/ai/openMetadataTools');

const TOKEN = 'eyJ.secret-bot-token.sig';
const OM = { url: 'http://om.test', token: TOKEN, service: 'openreport' };
const say = (text) => ({ text, toolCalls: [], usage: null });
const call = (name, args) => ({ text: '', toolCalls: [{ id: `c_${name}`, name, args, argsError: null }], usage: null });

// A catalog: the data model ← fact ← staging ← raw ← API export.
// The fact → model edge and staging → fact carry column lineage; raw → staging
// does not; the API sits 4 levels up, out of reach of the first read.
const ID = { dm: 'dm', fact: 'fact', stg: 'stg', raw: 'raw', api: 'api' };
const FQN = {
  dm: 'openreport.model.m1',
  fact: 'dwh.nyukom.public.f_appel',
  stg: 'dwh.nyukom.staging.stg_3cx',
  raw: 's3.raw.calls_csv',
  api: 'threecx.api.calllog',
};
const node = (k, type) => ({ id: ID[k], type, name: k, fullyQualifiedName: FQN[k] });
const NODES = { dm: node('dm', 'dashboardDataModel'), fact: node('fact', 'table'), stg: node('stg', 'table'), raw: node('raw', 'container'), api: node('api', 'apiEndpoint') };
const PIPE = { id: 'p', type: 'pipeline', name: '3cx_source_to_raw', fullyQualifiedName: 'airflow.nyukom_pipeline_p1' };
const COL = '"_calc.lost"';
const EDGES = [
  { fromEntity: 'fact', toEntity: 'dm', lineageDetails: { columnsLineage: [{ fromColumns: [`${FQN.fact}.statut`], toColumn: `${FQN.dm}.${COL}`, function: 'count where statut = Perdu' }] } },
  { fromEntity: 'stg', toEntity: 'fact', lineageDetails: { sqlQuery: `SELECT ${'x, '.repeat(1000)}`, columnsLineage: [{ fromColumns: [`${FQN.stg}.status`], toColumn: `${FQN.fact}.statut`, function: 'Unanswered or voicemail → Perdu' }] } },
  { fromEntity: 'raw', toEntity: 'stg', lineageDetails: { pipeline: PIPE, description: 'dedup of the 3CX export' } },
  { fromEntity: 'api', toEntity: 'raw', lineageDetails: { pipeline: PIPE } },
];
const lineageOf = (rootKey, keys, edges) => ({ entity: NODES[rootKey], nodes: keys.map((k) => NODES[k]), upstreamEdges: edges, downstreamEdges: [] });

function fakeOm({ mcp = 'json', calls = [] } = {}) {
  return async (url, init) => {
    calls.push({ url, init });
    if (init.headers.Authorization !== `Bearer ${TOKEN}`) return new Response('{}', { status: 401 });
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname);
    if (path === '/mcp') {
      const body = JSON.parse(init.body);
      let result;
      if (body.method === 'initialize') result = { protocolVersion: '2025-03-26' };
      else if (body.method === 'tools/list') result = { tools: ['search_metadata', 'get_entity_details', 'get_entity_lineage', 'patch_entity', 'create_lineage'].map((name) => ({ name, description: name, inputSchema: { type: 'object', properties: { q: { type: 'string' } } } })) };
      else if (body.params.name === 'get_user_context') result = { content: [{ type: 'text', text: JSON.stringify({ name: 'openreport-mcp', isAdmin: false }) }] };
      else result = { content: [{ type: 'text', text: JSON.stringify({ hits: [body.params.arguments] }) }] };
      const msg = JSON.stringify({ jsonrpc: '2.0', id: body.id, result });
      return mcp === 'sse'
        ? new Response(`event: message\ndata: ${msg}\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } })
        : new Response(msg, { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    if (path === `/api/v1/dashboard/datamodels/name/${FQN.dm}`) return json({ ...NODES.dm, columns: [{ name: '_calc.lost', fullyQualifiedName: `${FQN.dm}.${COL}`, description: 'count(id) filtered on statut = Perdu' }] });
    if (path === `/api/v1/lineage/dashboardDataModel/name/${FQN.dm}`) {
      expect(u.searchParams.get('upstreamDepth')).toBe('3');
      return json(lineageOf('dm', ['fact', 'stg', 'raw'], EDGES.slice(0, 3)));
    }
    if (path === `/api/v1/lineage/container/name/${FQN.raw}`) return json(lineageOf('raw', ['api'], EDGES.slice(3)));
    if (path === `/api/v1/tables/name/${FQN.fact}`) return json({ columns: [{ name: 'statut', fullyQualifiedName: `${FQN.fact}.statut`, description: 'Final status of the call' }] });
    if (path === `/api/v1/tables/name/${FQN.stg}`) return json({ columns: [{ name: 'status', fullyQualifiedName: `${FQN.stg}.status` }] });
    return new Response('{}', { status: 404 });
  };
}

describe('FQNs of the connector', () => {
  test('a model, a report\'s own fields, a quoted column', () => {
    expect(modelFqn('openreport', 'm1')).toBe('openreport.model.m1');
    expect(modelFqn('openreport', 'm1', 'r9')).toBe('openreport.model.report-r9');
    expect(columnFqn('openreport.model.m1', '_date.year')).toBe('openreport.model.m1."_date.year"');
  });
});

describe('explain_field', () => {
  test('from the field\'s column to the source, rule by rule, beyond depth 3, a missing column lineage said', async () => {
    const out = await explainField(OM, { modelId: 'm1', field: { name: '_calc.lost', label: 'Lost calls', description: 'Calls lost' } }, { fetch: fakeOm() });
    expect(out.field).toMatchObject({ name: '_calc.lost', glossary: 'Calls lost', definition: 'count(id) filtered on statut = Perdu' });
    expect(out.steps.map((s) => s.entity)).toEqual([FQN.fact, FQN.stg, FQN.raw, FQN.api]);
    expect(out.steps[0].columns[0]).toMatchObject({ from: [`${FQN.fact}.statut`], rule: 'count where statut = Perdu', descriptions: { [`${FQN.fact}.statut`]: 'Final status of the call' } });
    expect(out.steps[1].columns[0].rule).toBe('Unanswered or voicemail → Perdu');
    expect(out.steps[1].sql.length).toBeLessThanOrEqual(1501);
    expect(out.steps[2]).toMatchObject({ columns: null, pipeline: { name: '3cx_source_to_raw' }, edge: 'dedup of the 3CX export' });
    expect(out.gaps.join(' ')).toMatch(/s3\.raw\.calls_csv → dwh\.nyukom\.staging\.stg_3cx has no column lineage/);
    expect(out.gaps.join(' ')).toMatch(/stg_3cx\.status has no description/);
    expect(out.sources).toEqual([expect.objectContaining({ entity: FQN.api, type: 'apiEndpoint' })]);
    expect(out.links.map((l) => l.url)).toEqual(expect.arrayContaining([
      `http://om.test/dashboardDataModel/${encodeURIComponent(FQN.dm)}`,
      `http://om.test/table/${encodeURIComponent(FQN.fact)}`,
      `http://om.test/pipeline/${encodeURIComponent(PIPE.fullyQualifiedName)}`,
    ]));
    expect(JSON.stringify(out)).not.toContain(TOKEN);
  });

  test('a model the connector has not seen: said, nothing invented', async () => {
    const out = await explainField(OM, { modelId: 'unknown', field: { name: 'x' } }, { fetch: fakeOm() });
    expect(out.error).toMatch(/no data model openreport\.model\.unknown/);
  });
});

describe('MCP', () => {
  test('an answer in JSON and one in SSE read alike', async () => {
    for (const mcp of ['json', 'sse']) {
      expect(await callTool(OM, 'search_metadata', { q: 'calls' }, { fetch: fakeOm({ mcp }) })).toEqual({ hits: [{ q: 'calls' }] });
    }
    expect(rpcAnswer(': ping\n\ndata: {"jsonrpc":"2.0","id":7,"result":{"ok":1}}\n', 7)).toMatchObject({ result: { ok: 1 } });
  });

  test('a writing tool is refused before anything is sent; the kit relays the three read tools only', async () => {
    const calls = [];
    await expect(callTool(OM, 'patch_entity', {}, { fetch: fakeOm({ calls }) })).rejects.toThrow(/not a read tool/);
    expect(calls).toHaveLength(0);
    const kit = await openMetadataKit({ om: OM, modelId: 'm1', fields: [{ name: '_calc.lost' }] }, { fetch: fakeOm() });
    expect(kit.tools.map((t) => t.name).sort()).toEqual(['explain_field', 'get_entity_details', 'get_entity_lineage', 'search_metadata']);
    expect(await kit.execute({ name: 'create_lineage', args: {} })).toEqual({ error: 'create_lineage is not available' });
    expect(await kit.execute({ name: 'explain_field', args: { field: 'invented' } })).toMatchObject({ error: expect.stringMatching(/Not a field/) });
  });

  test('a refused token is said by its status, never shown', async () => {
    const out = await (await openMetadataKit({ om: { ...OM, url: 'http://om2.test' }, modelId: 'm1', fields: [] }, { fetch: async () => new Response('', { status: 401 }) })).execute({ name: 'explain_field', args: {} });
    expect(JSON.stringify(out)).not.toContain(TOKEN);
    const err = await callTool({ ...OM, token: 'wrong' }, 'search_metadata', {}, { fetch: fakeOm() }).catch((e) => e);
    expect(err.message).toBe('OpenMetadata refused the token (401)');
  });
});

describe('the assistant', () => {
  const app = buildApp();
  let admin, owner, report, model;
  let fetchSpy;
  beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    admin = seedUser({ role: 'admin' });
    owner = seedUser({ role: 'editor' });
    model = seedModel({ userId: owner, datasourceId: seedDatasource({ userId: owner }) });
    report = seedReport({ userId: owner, modelId: model });
    setAiConfig({ provider: 'openai-compat', baseUrl: 'http://llm.test/v1', model: 'm', enabled: true, dataSharing: 'schema' });
  });
  beforeEach(() => {
    providers.chat.mockReset();
    _cache.clear();
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(fakeOm());
  });
  afterEach(() => fetchSpy.mockRestore());
  afterAll(() => jest.restoreAllMocks());

  const chat = () => request(app).post(`/api/ai/reports/${report}/chat`).set('x-test-user', owner)
    .send({ messages: [{ role: 'user', text: 'Where does the amount come from?' }], pageContext: { widgets: [] } });
  const settings = (body) => request(app).put('/api/admin/settings/openmetadata').set('x-test-user', admin).send(body);

  test('off by default: no tool, no prompt line', async () => {
    providers.chat.mockResolvedValueOnce(say('ok'));
    await chat();
    const sent = providers.chat.mock.calls[0][0];
    expect(sent.tools.map((t) => t.name)).not.toContain('explain_field');
    expect(sent.system).not.toMatch(/OpenMetadata/);
  });

  test('switched on: tested, offered, walked server side — the token never leaves', async () => {
    expect((await settings({ enabled: true, url: 'http://om.test' })).status).toBe(400);
    const saved = await settings({ url: 'http://om.test/', token: TOKEN, service: 'openreport', enabled: true });
    expect(saved.status).toBe(200);
    expect(saved.body.openMetadata).toMatchObject({ enabled: true, url: 'http://om.test', hasToken: true, changedBy: expect.any(String) });
    const read = await request(app).get('/api/admin/settings').set('x-test-user', admin);
    expect(JSON.stringify(read.body)).not.toContain(TOKEN);
    const test = await request(app).post('/api/admin/settings/openmetadata/test').set('x-test-user', admin);
    expect(test.body).toEqual({ ok: true, account: 'openreport-mcp', isAdmin: false });

    providers.chat
      .mockResolvedValueOnce(call('explain_field', { field: 'items.amt_sum' }))
      .mockResolvedValueOnce(say('It comes from the items table.'));
    const res = await chat();
    expect(res.body.reply).toBe('It comes from the items table.');
    const [first, second] = providers.chat.mock.calls.map((c) => c[0]);
    expect(first.tools.map((t) => t.name)).toEqual(expect.arrayContaining(['explain_field', 'search_metadata']));
    expect(first.tools.map((t) => t.name)).not.toContain('patch_entity');
    expect(first.system).toMatch(/call `explain_field` first/);
    // The data model of the report's model, named by the server.
    expect(fetchSpy.mock.calls.some(([url]) => decodeURIComponent(url).includes(`/dashboard/datamodels/name/openreport.model.${model}`))).toBe(true);
    for (const sent of [first, second]) expect(JSON.stringify(sent)).not.toContain(TOKEN);
    expect(JSON.stringify(res.body)).not.toContain(TOKEN);
    expect(JSON.stringify(console.error.mock.calls)).not.toContain(TOKEN);

    expect((await settings({ enabled: false })).body.openMetadata.enabled).toBe(false);
  });
});
