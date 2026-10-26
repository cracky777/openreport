// Let's Talk at the 'schema+results' sharing level: the assistant reads the
// rows its answer is about from the source, as the user (their rights, their
// RLS — /query's), 50 rows at most. A cache only holds what reports group by,
// so an ad hoc question went unread (Jonathan 2026-10-25). Nowhere else, and
// never below that level.
jest.mock('../utils/ai/providers', () => ({
  ...jest.requireActual('../utils/ai/providers'),
  chat: jest.fn(),
}));
jest.mock('../utils/ai/cardinality', () => ({ dimensionCardinality: jest.fn() }));
jest.mock('../utils/ai/cachedQuery', () => ({
  ...jest.requireActual('../utils/ai/cachedQuery'),
  queryCached: jest.fn(),
  queryLive: jest.fn(),
}));

const request = require('supertest');
const providers = require('../utils/ai/providers');
const { queryCached, queryLive, buildBody } = require('../utils/ai/cachedQuery');
const { dimensionCardinality } = require('../utils/ai/cardinality');
const { setAiConfig, getAiConfig } = require('../utils/settingsHelper');
const { buildApp, seedUser, seedDatasource, seedModel } = require('./helpers/testApp');

const app = buildApp();
const call = (name, args) => ({ text: '', toolCalls: [{ id: `c_${name}`, name, args, argsError: null }], usage: null });
const say = (text) => ({ text, toolCalls: [], usage: null });
const read = { dimensions: ['items.label'], measures: ['items.amt_sum'] };

describe("Let's Talk reads its results", () => {
  let owner, model;
  beforeAll(() => {
    owner = seedUser({ role: 'editor' });
    model = seedModel({ userId: owner, datasourceId: seedDatasource({ userId: owner }) });
  });
  beforeEach(() => {
    providers.chat.mockReset();
    queryCached.mockReset();
    queryLive.mockReset();
    dimensionCardinality.mockResolvedValue({});
  });
  const share = (dataSharing) => setAiConfig({ provider: 'openai-compat', baseUrl: 'http://llm.test/v1', model: 'm', enabled: true, dataSharing });
  const chat = (body) => request(app).post(`/api/ai/models/${model}/chat`).set('x-test-user', owner)
    .send({ messages: [{ role: 'user', text: 'Who sells most?' }], ...body });
  const toolsOf = (i = 0) => providers.chat.mock.calls[i][0].tools.map((t) => t.name);

  test('the admin may choose the level; it is not the default', () => {
    share('schema+results');
    expect(getAiConfig().dataSharing).toBe('schema+results');
    expect(() => setAiConfig({ dataSharing: 'everything' })).toThrow(/Data sharing/);
  });

  test("in Let's Talk, the read is from the data, as the user, and comes back to the conversation as such", async () => {
    share('schema+results');
    queryLive.mockResolvedValueOnce({ rows: [{ label: 'France', amt: 100 }], truncated: false });
    providers.chat.mockResolvedValueOnce(call('query_data', read)).mockResolvedValueOnce(say('France leads with 100.'));
    const res = await chat({ talk: true });
    expect(toolsOf()).toContain('query_data');
    expect(toolsOf()).not.toContain('query_cached_data');
    expect(providers.chat.mock.calls[0][0].system).toMatch(/read which years the data holds/);
    expect(queryLive).toHaveBeenCalledTimes(1);
    expect(queryLive.mock.calls[0][0].user.id).toBe(owner);
    expect(queryCached).not.toHaveBeenCalled();
    expect(res.body.reads).toEqual([{ ...read, rows: [{ label: 'France', amt: 100 }], truncated: false, live: true }]);
  });

  test('not outside Let\'s Talk, and not below that level: the cache, as before', async () => {
    share('schema+results');
    providers.chat.mockResolvedValueOnce(call('query_data', read)).mockResolvedValueOnce(say('ok'));
    await chat({});
    expect(toolsOf()).toContain('query_cached_data');
    expect(toolsOf()).not.toContain('query_data');
    expect(queryLive).not.toHaveBeenCalled();

    providers.chat.mockReset();
    share('schema+cache');
    providers.chat.mockResolvedValueOnce(call('query_data', read)).mockResolvedValueOnce(say('ok'));
    await chat({ talk: true });
    expect(toolsOf()).not.toContain('query_data');
    expect(queryLive).not.toHaveBeenCalled();
  });

  // A figure the answer defines (a delay, a variance) is read before it is
  // drawn: compiled from closed arguments, never the model's SQL.
  test('a read may define the measures it needs; they reach /query compiled', async () => {
    share('schema+results');
    const twice = { label: 'Twice', kind: 'arithmetic', op: 'add', left: 'items.amt_sum', right: 'items.amt_sum', expression: 'SUM(secret)' };
    queryLive.mockResolvedValueOnce({ rows: [{ label: 'France', Twice: 200 }], truncated: false });
    providers.chat.mockResolvedValueOnce(call('query_data', { dimensions: ['items.label'], measures: ['_calc.twice'], define: [twice] })).mockResolvedValueOnce(say('ok'));
    await chat({ talk: true });
    const sent = queryLive.mock.calls[0][0];
    expect(sent.extraMeasures).toEqual([expect.objectContaining({ name: '_calc.twice', aggregation: 'custom', expression: 'COALESCE((${items.amt_sum}), 0) + COALESCE((${items.amt_sum}), 0)' })]);
    expect(sent.effective.measures.some((m) => m.name === '_calc.twice')).toBe(true);

    queryLive.mockReset();
    providers.chat.mockReset();
    providers.chat.mockResolvedValueOnce(call('query_data', { dimensions: ['items.label'], measures: ['_calc.bad'], define: [{ label: 'Bad', kind: 'arithmetic', op: 'add', left: 'items.nope', right: 'items.amt_sum' }] })).mockResolvedValueOnce(say('ok'));
    await chat({ talk: true });
    expect(queryLive).not.toHaveBeenCalled();
    expect(providers.chat.mock.calls[1][0].messages.find((m) => m.role === 'tool').content).toMatch(/left and right must be measure names/);
  });

  test('the live body is the same whitelist without cacheOnly, 50 rows at most', () => {
    const effective = { dimensions: [{ name: 'items.label' }], measures: [{ name: 'items.amt_sum' }] };
    const report = { id: null, settings: {} };
    const live = buildBody({ report, effective, args: { ...read, limit: 500, _rollupBuilder: true }, live: true }).body;
    expect(live.cacheOnly).toBeUndefined();
    expect(live.limit).toBe(50);
    expect(live._rollupBuilder).toBeUndefined();
    expect(buildBody({ report, effective, args: read }).body.cacheOnly).toBe(true);
    // A read from the source keeps the rows a measure condition passes, and ranks by a measure read;
    // a read from the cache does neither.
    const kept = buildBody({ report, effective, args: { ...read, filters: [{ field: 'items.amt_sum', op: 'lt', values: [0] }], rank: { by: 'items.amt_sum', order: 'asc' }, limit: 20 }, live: true }).body;
    expect(kept.widgetFilters).toEqual([
      { field: 'items.amt_sum', isMeasure: true, op: 'lt', value: 0, values: [] },
      { field: 'items.amt_sum', isMeasure: true, op: 'bottom_n', value: 20, values: [] },
    ]);
    expect(buildBody({ report, effective, args: { ...read, filters: [{ field: 'items.amt_sum', op: 'lt', values: [0] }] } }).error).toMatch(/Unknown filter field/);
    expect(buildBody({ report, effective, args: { ...read, rank: { by: 'items.nope' } }, live: true }).error).toMatch(/rank.by/);
  });
});
