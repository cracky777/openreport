jest.mock('../utils/ai/providers', () => ({
  ...jest.requireActual('../utils/ai/providers'),
  chat: jest.fn(),
}));
// Counting values reads the cache over loopback: here each test says what it counted.
jest.mock('../utils/ai/cardinality', () => ({ dimensionCardinality: jest.fn() }));
jest.mock('../utils/ai/cachedQuery', () => ({
  ...jest.requireActual('../utils/ai/cachedQuery'),
  queryCached: jest.fn(),
}));

const request = require('supertest');
const providers = require('../utils/ai/providers');
const { queryCached } = require('../utils/ai/cachedQuery');
const { dimensionCardinality } = require('../utils/ai/cardinality');
const { setAiConfig } = require('../utils/settingsHelper');
const aiAccess = require('../utils/ai/access');
const { buildApp, seedUser, seedDatasource, seedModel, seedReport, seedWorkspace, seedRollup, db } = require('./helpers/testApp');

const app = buildApp();
const say = (text) => ({ text, toolCalls: [], usage: null });
const call = (name, args) => ({ text: '', toolCalls: [{ id: `c_${name}`, name, args, argsError: null }], usage: null });
const ask = (text) => ({ messages: [{ role: 'user', text }] });
const fields = { selectedDimensions: ['items.label'], selectedMeasures: ['items.amt_sum'] };
const widget = (type, title, binding = fields) => ({ type, title, rationale: 'r', binding });

// The landing-page assistant: a conversation about a model, with no report.
describe('POST /api/ai/models/:id/chat', () => {
  let owner, wsEditor, wsViewer, stranger, denied, model;

  beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    owner = seedUser({ role: 'editor' });
    wsEditor = seedUser({ role: 'viewer' });
    wsViewer = seedUser({ role: 'viewer' });
    stranger = seedUser({ role: 'editor' });
    denied = seedUser({ role: 'admin' });
    const ws = seedWorkspace({ ownerId: owner });
    db.prepare('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?,?,?)').run(ws, wsEditor, 'editor');
    db.prepare('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?,?,?)').run(ws, wsViewer, 'viewer');
    const ds = seedDatasource({ userId: owner });
    model = seedModel({
      userId: owner,
      datasourceId: ds,
      dimensions: [
        { name: 'items.label', table: 'items', column: 'label', type: 'string', label: 'Label' },
        { name: 'items.day', table: 'items', column: 'day', type: 'date', label: 'Day' },
        { name: 'items.region', table: 'items', column: 'region', type: 'string', label: 'Region' },
      ],
      measures: [
        { name: 'items.amt_sum', table: 'items', column: 'amt', aggregation: 'sum', label: 'Amount' },
        { name: 'items.secret', table: 'items', column: 'amt', aggregation: 'custom', expression: 'SUM(secret_col)', label: 'Custom' },
      ],
    });
    // Shared with the workspace AND public: everyone here can read the model
    // through it. Only some of them may build on it.
    seedReport({ userId: owner, modelId: model, workspaceId: ws, isPublic: 1 });
    seedRollup({ modelId: model });
  });
  afterAll(() => { jest.restoreAllMocks(); });

  beforeEach(() => {
    providers.chat.mockReset();
    queryCached.mockReset();
    dimensionCardinality.mockReset();
    dimensionCardinality.mockResolvedValue({});
    setAiConfig({ provider: 'openai-compat', baseUrl: 'http://llm.test/v1', model: 'm', enabled: true, dataSharing: 'schema+cache' });
  });

  const chat = (uid, body = ask('Amount by label?'), id = model) => {
    const r = request(app).post(`/api/ai/models/${id}/chat`);
    if (uid) r.set('x-test-user', uid);
    return r.send(body);
  };

  test('access: 401 anonymous, 404 unknown model', async () => {
    expect((await chat(null)).status).toBe(401);
    expect((await chat(owner, undefined, 'nope')).status).toBe(404);
    expect(providers.chat).not.toHaveBeenCalled();
  });

  // Reading a model through one shared report must not open its whole schema
  // to questions: the gate is "may build on it", not "may read it".
  test('who only reads the model through a shared report is refused; a workspace editor is not', async () => {
    expect((await chat(wsViewer)).status).toBe(403);
    expect((await chat(stranger)).status).toBe(403);
    expect(providers.chat).not.toHaveBeenCalled();

    providers.chat.mockResolvedValue(say('ok'));
    expect((await chat(wsEditor)).status).toBe(200);
    expect((await chat(owner)).status).toBe(200);
  });

  test('403 for an account the admin excluded, 409 when the assistant is off', async () => {
    aiAccess.setDenied(denied, true);
    expect((await chat(denied)).status).toBe(403);
    setAiConfig({ enabled: false });
    expect((await chat(owner)).status).toBe(409);
    expect(providers.chat).not.toHaveBeenCalled();
  });

  test('the prompt has the schema, and neither SQL, a page nor a report', async () => {
    providers.chat.mockResolvedValueOnce(say('ok'));
    await chat(owner);
    const { system } = providers.chat.mock.calls[0][0];
    expect(system).toContain('items.amt_sum');
    expect(system).not.toContain('secret_col');
    expect(system).not.toContain('expression');
    expect(system).not.toMatch(/^Report:|^Page:|Widgets already on the page|Themes/m);
  });

  test('the toolset: widgets without a layout, the cache, and nothing that needs a page', async () => {
    providers.chat.mockResolvedValueOnce(say('ok'));
    await chat(owner);
    const { tools } = providers.chat.mock.calls[0][0];
    // read_help comes with the user guide (help.md), when there is one.
    expect(tools.map((t) => t.name).filter((n) => n !== 'read_help')).toEqual(['query_cached_data', 'propose_widgets', 'propose_action']);
    const item = tools[1].parameters.properties.widgets.items;
    expect(Object.keys(item.properties)).toEqual(['type', 'subType', 'title', 'answers', 'topN', 'bottomN', 'rankBy', 'filters', 'timePeriod', 'drill', 'sort', 'limit', 'binding', 'rationale']);
  });

  test('schema-only sharing offers no data tool', async () => {
    setAiConfig({ dataSharing: 'schema' });
    providers.chat.mockResolvedValueOnce(say('ok'));
    await chat(owner);
    expect(providers.chat.mock.calls[0][0].tools.map((t) => t.name).filter((n) => n !== 'read_help')).toEqual(['propose_widgets', 'propose_action']);
  });

  // Asked to change the joins, it cannot: it points to the model assistant —
  // with a card for whoever may change the model, in words for anyone else.
  test('a change to the model itself: a card to the model assistant, for its owner only', async () => {
    const openIt = call('propose_action', { userAsked: 'do', action: 'open_model_assistant', summary: 'The model assistant can join them.', request: 'Relie les tables', modelId: 'someone-elses' });
    providers.chat.mockResolvedValueOnce(openIt).mockResolvedValueOnce(say('Done.'));
    const res = await chat(owner, ask('Modifie les jointures'));
    expect(providers.chat.mock.calls[0][0].system).toMatch(/change the data model itself.*open_model_assistant/);
    expect(res.body.proposals).toEqual([{ kind: 'action', action: 'open_model_assistant', summary: 'The model assistant can join them.', request: 'Relie les tables', modelId: model }]);

    providers.chat.mockReset();
    providers.chat.mockResolvedValueOnce(openIt).mockResolvedValueOnce(say('Only its owner or an admin can.'));
    const other = await chat(wsEditor, ask('Modifie les jointures'));
    expect(providers.chat.mock.calls[0][0].system).toMatch(/neither can this user.*No card/);
    expect(providers.chat.mock.calls[1][0].messages.find((m) => m.role === 'tool').content).toMatch(/owner or an admin/);
    expect(other.body.proposals).toEqual([]);
  });

  test('a cache read carries no report', async () => {
    providers.chat
      .mockResolvedValueOnce(call('query_cached_data', { dimensions: ['items.label'], measures: ['items.amt_sum'] }))
      .mockResolvedValueOnce(say('done'));
    queryCached.mockResolvedValueOnce({ miss: 'no-rollup:items' });
    await chat(owner);
    expect(queryCached.mock.calls[0][0].report).toEqual({ id: null, title: null, model_id: model, settings: {} });
  });

  test('the visuals the model proposes are all kept, placed by the server whatever layout it made up', async () => {
    providers.chat.mockResolvedValueOnce(call('propose_widgets', { widgets: [
      { ...widget('bar', 'Amount by label'), layout: { x: 900, y: 700, w: 100, h: 50 } },
      widget('scorecard', 'Total', { selectedMeasures: ['items.amt_sum'] }),
    ] }));
    const res = await chat(owner);
    const [proposal] = res.body.proposals;
    expect(proposal.widgets.map((w) => w.type)).toEqual(['bar', 'scorecard']);
    expect(proposal.widgets[0].layout).not.toEqual({ x: 900, y: 700, w: 100, h: 50 });
  });

  test('a lone visual gets the size of a lone visual', async () => {
    providers.chat.mockResolvedValueOnce(call('propose_widgets', { widgets: [{ ...widget('bar', 'Amount by label'), layout: { x: 900, y: 700, w: 100, h: 50 } }] }));
    expect((await chat(owner)).body.proposals[0].widgets[0].layout).toEqual({ x: 20, y: 20, w: 560, h: 360 });
  });

  test('a dashboard comes back laid out: figures in a band, the trend across, no overlap, inside the page', async () => {
    const total = { selectedMeasures: ['items.amt_sum'] };
    providers.chat.mockResolvedValueOnce(call('propose_widgets', { widgets: [
      widget('scorecard', 'Total', total),
      widget('scorecard', 'Total again', total),
      widget('line', 'Trend', { selectedDimensions: ['items.day'], selectedMeasures: ['items.amt_sum'] }),
      widget('bar', 'By label'),
      widget('pie', 'Share'),
    ] }));
    const res = await chat(owner, ask('Build me a dashboard about sales'));
    const boxes = res.body.proposals[0].widgets.map((w) => w.layout);
    expect(boxes).toHaveLength(5);

    const [k1, k2, trend, bar, pie] = boxes;
    expect(k1.y).toBe(k2.y);
    expect(trend).toMatchObject({ x: 20, w: 1100 });
    expect(trend.y).toBeGreaterThan(k1.y);
    expect(bar.y).toBe(pie.y);
    expect(bar.y).toBeGreaterThan(trend.y);

    for (const b of boxes) {
      expect(b.x).toBeGreaterThanOrEqual(20);
      expect(b.x + b.w).toBeLessThanOrEqual(1120);
      expect(b.y + b.h).toBeLessThanOrEqual(780);
    }
    const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    boxes.forEach((a, i) => boxes.slice(i + 1).forEach((b) => expect(overlap(a, b)).toBe(false)));
  });

  const rankRule = (op, n) => ({ field: 'items.amt_sum', isMeasure: true, op, value: n, values: [] });

  // The request is read by the model — in any language — and written down as
  // its `reading`; the server holds the visuals to that reading.
  const reading = (r) => ({ reading: r });

  test('a top N is a ranking rule of the visual, with the N of the reading, sorted to match', async () => {
    providers.chat.mockResolvedValueOnce(call('propose_widgets', { ...reading({ ranking: { n: 5, direction: 'top' } }), widgets: [{ ...widget('bar', 'Top labels'), topN: 50 }] }));
    const res = await chat(owner, ask('Top 5 des labels par montant'));
    const [w] = res.body.proposals[0].widgets;
    expect(w.dataBinding.widgetFilters).toEqual([rankRule('top_n', 5)]);
    expect(w.config.sortOrder).toBe('desc');
  });

  test('a top N the model forgot is added, on a table too; a bottom N is read as such', async () => {
    providers.chat.mockResolvedValueOnce(call('propose_widgets', { ...reading({ ranking: { n: 3, direction: 'top' } }), widgets: [widget('table', 'Labels')] }));
    const top = await chat(owner, ask('les 3 premiers labels'));
    expect(top.body.proposals[0].widgets[0].dataBinding.widgetFilters).toEqual([rankRule('top_n', 3)]);

    providers.chat.mockResolvedValueOnce(call('propose_widgets', { ...reading({ ranking: { n: 4, direction: 'bottom' } }), widgets: [widget('bar', 'Worst labels')] }));
    const bottom = await chat(owner, ask('the 4 worst labels'));
    const [w] = bottom.body.proposals[0].widgets;
    expect(w.dataBinding.widgetFilters).toEqual([rankRule('bottom_n', 4)]);
    expect(w.config.sortOrder).toBe('asc');
  });

  // Seen with Mistral: "the 3 with the least" came back as a top 3.
  test('the direction of the reading wins over the widget: "the fewest" is a bottom N', async () => {
    providers.chat.mockResolvedValueOnce(call('propose_widgets', { ...reading({ ranking: { n: 3, direction: 'bottom' } }), widgets: [{ ...widget('bar', 'Fewest'), topN: 3 }] }));
    const res = await chat(owner, ask('les 3 labels avec le moins de montant'));
    const [w] = res.body.proposals[0].widgets;
    expect(w.dataBinding.widgetFilters).toEqual([rankRule('bottom_n', 3)]);
    expect(w.config.sortOrder).toBe('asc');
  });

  // "Among these top 5 clients, which has the most cancellations": the members
  // stay those of the ranking by the first measure, the visual shows the other.
  test('a ranking can be by a measure the visual does not show', async () => {
    providers.chat.mockResolvedValueOnce(call('propose_widgets', { widgets: [{
      ...widget('bar', 'Cancellations of the top 5', { selectedDimensions: ['items.label'], selectedMeasures: ['items.secret'] }),
      topN: 5, rankBy: 'items.amt_sum',
    }] }));
    const res = await chat(owner, ask('parmi ces labels, lequel a le plus de custom ?'));
    const [w] = res.body.proposals[0].widgets;
    expect(w.dataBinding.selectedMeasures).toEqual(['items.secret']);
    expect(w.dataBinding.widgetFilters).toEqual([rankRule('top_n', 5)]);
  });

  // The reported conversation, turn two: a real model re-ranked by the new
  // measure one time in four. The ranking of the previous answer is kept.
  test('a follow-up about the same members keeps the previous ranking, whatever the model ranks by, in any language', async () => {
    const previous = [
      { role: 'user', text: 'top 5 labels by amount' },
      { role: 'assistant', text: `[Proposed — not applied yet: bar "Top 5" ${JSON.stringify({ selectedDimensions: ['items.label'], selectedMeasures: ['items.amt_sum'], widgetFilters: [rankRule('top_n', 5)] })}]` },
    ];
    const reRanked = { ...widget('bar', 'Most custom', { selectedDimensions: ['items.label'], selectedMeasures: ['items.secret'] }), topN: 5, rankBy: 'items.secret' };

    providers.chat.mockResolvedValueOnce(call('propose_widgets', { ...reading({ sameMembersAsBefore: true }), widgets: [reRanked] }));
    const res = await chat(owner, { messages: [...previous, { role: 'user', text: 'parmis ces labels, lequel a le plus de custom ?' }] });
    const [w] = res.body.proposals[0].widgets;
    expect(w.dataBinding.selectedMeasures).toEqual(['items.secret']);
    expect(w.dataBinding.widgetFilters).toEqual([rankRule('top_n', 5)]);

    // No word of the request is read here: the same follow-up in German.
    providers.chat.mockResolvedValueOnce(call('propose_widgets', { ...reading({ sameMembersAsBefore: true }), widgets: [reRanked] }));
    const de = await chat(owner, { messages: [...previous, { role: 'user', text: 'Welches dieser Labels hat den höchsten Custom-Wert?' }] });
    expect(de.body.proposals[0].widgets[0].dataBinding.widgetFilters).toEqual([rankRule('top_n', 5)]);

    // Not a follow-up about those members: the model's ranking stands.
    providers.chat.mockResolvedValueOnce(call('propose_widgets', { widgets: [reRanked] }));
    const other = await chat(owner, { messages: [...previous, { role: 'user', text: 'top 5 labels by custom' }] });
    expect(other.body.proposals[0].widgets[0].dataBinding.widgetFilters).toEqual([{ ...rankRule('top_n', 5), field: 'items.secret' }]);
  });

  // The reported case: asked which cities share a region, the model put the
  // region under the city on the axis — a drill-down, where the region is only
  // seen by clicking. Shown at once instead: the second dimension as legend.
  test('two axis dimensions become axis + legend, stacked, unless the model says it is a drill-down', async () => {
    const both = { selectedDimensions: ['items.label', 'items.region'], selectedMeasures: ['items.amt_sum'] };
    providers.chat.mockResolvedValueOnce(call('propose_widgets', { widgets: [widget('bar', 'Labels and their region', both)] }));
    const res = await chat(owner, ask('parmi ces labels, lesquels sont de la même région ?'));
    const [w] = res.body.proposals[0].widgets;
    expect(w.dataBinding).toMatchObject({ selectedDimensions: ['items.label'], groupBy: ['items.region'] });
    expect(w.config.subType).toBe('stacked');

    // What Mistral did the next time: the legend given directly, no layout picked.
    providers.chat.mockResolvedValueOnce(call('propose_widgets', { widgets: [widget('bar', 'B', { selectedDimensions: ['items.label'], groupBy: ['items.region'], selectedMeasures: ['items.amt_sum'] })] }));
    expect((await chat(owner)).body.proposals[0].widgets[0].config.subType).toBe('stacked');

    providers.chat.mockResolvedValueOnce(call('propose_widgets', { widgets: [{ ...widget('bar', 'B', both), subType: 'grouped' }] }));
    const grouped = await chat(owner);
    expect(grouped.body.proposals[0].widgets[0].config.subType).toBe('grouped');

    providers.chat.mockResolvedValueOnce(call('propose_widgets', { widgets: [{ ...widget('bar', 'Drill', both), drill: true }] }));
    const drill = await chat(owner);
    expect(drill.body.proposals[0].widgets[0].dataBinding.selectedDimensions).toEqual(['items.label', 'items.region']);
    expect(drill.body.proposals[0].widgets[0].dataBinding.groupBy).toBeUndefined();
  });

  // Which of two dimensions goes where depends on what they are — whatever
  // they are called, whatever order the model wrote them in.
  test('with a date in the model, a trend is offered — and it has that date on its axis', async () => {
    providers.chat
      .mockResolvedValueOnce(call('propose_widgets', { widgets: [{ ...widget('bar', 'By region', { selectedDimensions: ['items.region'], selectedMeasures: ['items.amt_sum'] }), answers: 'trend' }] }))
      .mockResolvedValueOnce(call('propose_widgets', { widgets: [{ ...widget('line', 'Over time', { selectedDimensions: ['items.day'], selectedMeasures: ['items.amt_sum'] }), answers: 'trend' }] }));
    const res = await chat(owner);
    const { system, tools } = providers.chat.mock.calls[0][0];
    expect(tools.find((t) => t.name === 'propose_widgets').parameters.properties.widgets.items.properties.answers.enum).toContain('trend');
    expect(system).not.toContain('NO date dimension');
    expect(providers.chat.mock.calls[1][0].messages.find((m) => m.role === 'tool').content).toMatch(/a trend has the date dimension on its axis/);
    expect(res.body.proposals[0].widgets.map((w) => w.type)).toEqual(['line']);
  });

  test('time runs along the axis, whatever order the model wrote', async () => {
    providers.chat.mockResolvedValueOnce(call('propose_widgets', { widgets: [widget('line', 'L', { selectedDimensions: ['items.region'], groupBy: ['items.day'], selectedMeasures: ['items.amt_sum'] })] }));
    const res = await chat(owner);
    expect(res.body.proposals[0].widgets[0].dataBinding).toMatchObject({ selectedDimensions: ['items.day'], groupBy: ['items.region'] });
  });

  test('the dimension with many values goes on the axis, the one with few colors the bars — counted, not guessed', async () => {
    const reversed = { selectedDimensions: ['items.region'], groupBy: ['items.label'], selectedMeasures: ['items.amt_sum'] };
    dimensionCardinality.mockResolvedValue({ 'items.label': { n: 200, more: true }, 'items.region': { n: 13, more: false } });
    providers.chat.mockResolvedValueOnce(call('propose_widgets', { widgets: [widget('bar', 'B', reversed)] }));
    const counted = await chat(owner);
    expect(counted.body.proposals[0].widgets[0].dataBinding).toMatchObject({ selectedDimensions: ['items.label'], groupBy: ['items.region'] });

    // Unknown counts decide nothing: the model's order stands.
    dimensionCardinality.mockResolvedValue({});
    providers.chat.mockResolvedValueOnce(call('propose_widgets', { widgets: [widget('bar', 'B', reversed)] }));
    const unknown = await chat(owner);
    expect(unknown.body.proposals[0].widgets[0].dataBinding).toMatchObject({ selectedDimensions: ['items.region'], groupBy: ['items.label'] });

    // A legend of a few values is left where the model put it.
    dimensionCardinality.mockResolvedValue({ 'items.label': { n: 40, more: false }, 'items.region': { n: 6, more: false } });
    providers.chat.mockResolvedValueOnce(call('propose_widgets', { widgets: [widget('bar', 'B', { selectedDimensions: ['items.label'], groupBy: ['items.region'], selectedMeasures: ['items.amt_sum'] })] }));
    expect((await chat(owner)).body.proposals[0].widgets[0].dataBinding).toMatchObject({ selectedDimensions: ['items.label'], groupBy: ['items.region'] });
  });

  test('a line needs an ordered axis: across regions it becomes bars, over days it stays a line', async () => {
    providers.chat.mockResolvedValueOnce(call('propose_widgets', { widgets: [{ ...widget('line', 'L', { selectedDimensions: ['items.region'], selectedMeasures: ['items.amt_sum'] }), subType: 'area' }] }));
    const bars = (await chat(owner)).body.proposals[0].widgets[0];
    expect(bars.type).toBe('bar');
    expect(bars.config.subType).toBeUndefined();
    providers.chat.mockResolvedValueOnce(call('propose_widgets', { widgets: [widget('line', 'L', { selectedDimensions: ['items.day'], selectedMeasures: ['items.amt_sum'] })] }));
    expect((await chat(owner)).body.proposals[0].widgets[0].type).toBe('line');
  });

  test('a pie of many slices becomes bars; a pie of a few stays a pie', async () => {
    dimensionCardinality.mockResolvedValue({ 'items.label': { n: 40, more: false }, 'items.region': { n: 5, more: false } });
    providers.chat.mockResolvedValueOnce(call('propose_widgets', { widgets: [widget('pie', 'Share by label')] }));
    expect((await chat(owner)).body.proposals[0].widgets[0].type).toBe('bar');
    providers.chat.mockResolvedValueOnce(call('propose_widgets', { widgets: [widget('pie', 'Share by region', { selectedDimensions: ['items.region'], selectedMeasures: ['items.amt_sum'] })] }));
    expect((await chat(owner)).body.proposals[0].widgets[0].type).toBe('pie');
  });

  test('the counts reach the provider only where cached data may', async () => {
    dimensionCardinality.mockResolvedValue({ 'items.label': { n: 200, more: true }, 'items.region': { n: 13, more: false } });
    providers.chat.mockResolvedValueOnce(say('ok'));
    await chat(owner);
    const { system } = providers.chat.mock.calls[0][0];
    expect(system).toContain('"name":"items.region","label":"Region","type":"string","values":13');
    expect(system).toContain('"values":"200+"');

    setAiConfig({ dataSharing: 'schema' });
    providers.chat.mockResolvedValueOnce(say('ok'));
    await chat(owner);
    expect(providers.chat.mock.calls[1][0].system).not.toContain('"values"');
  });

  test('rankBy must be a measure', async () => {
    providers.chat
      .mockResolvedValueOnce(call('propose_widgets', { widgets: [{ ...widget('bar', 'B'), topN: 5, rankBy: 'items.label' }] }))
      .mockResolvedValueOnce(say('ok'));
    await chat(owner, ask('top 5 labels'));
    expect(providers.chat.mock.calls[1][0].messages.find((m) => m.role === 'tool').content).toMatch(/rankBy must be a measure name/);
  });

  // What the reported error was: the model filtered on client names it had
  // never read. The repair round now tells it what to do instead.
  test('a filter with no value sends the model back to the ranking, not to "invalid value"', async () => {
    providers.chat
      .mockResolvedValueOnce(call('propose_widgets', { widgets: [{ ...widget('bar', 'B'), filters: [{ field: 'items.label', op: 'in', values: [] }] }] }))
      .mockResolvedValueOnce(call('propose_widgets', { widgets: [{ ...widget('bar', 'B'), topN: 5, rankBy: 'items.amt_sum' }] }));
    const res = await chat(owner, ask('parmi ces labels'));
    expect(providers.chat.mock.calls[1][0].messages.find((m) => m.role === 'tool').content).toMatch(/Only filter on values you have read.*rankBy/);
    expect(res.body.proposals[0].widgets[0].dataBinding.widgetFilters).toEqual([rankRule('top_n', 5)]);
  });

  test('a list written under `value` is read as the list it is', async () => {
    providers.chat.mockResolvedValueOnce(call('propose_widgets', { widgets: [{ ...widget('bar', 'B'), filters: [{ field: 'items.label', op: 'in', value: ['a', 'b'] }] }] }));
    const res = await chat(owner);
    expect(res.body.proposals[0].widgets[0].dataBinding.widgetFilters).toEqual([{ field: 'items.label', isMeasure: false, op: 'in', value: '', values: ['a', 'b'] }]);
  });

  test('a threshold is not a ranking', async () => {
    providers.chat.mockResolvedValueOnce(call('propose_widgets', { widgets: [widget('bar', 'Small labels')] }));
    const res = await chat(owner, ask('labels avec moins de 500 de montant'));
    expect(res.body.proposals[0].widgets[0].dataBinding.widgetFilters).toBeUndefined();
  });

  test('a ranking answered with a single figure goes back for repair', async () => {
    providers.chat
      .mockResolvedValueOnce(call('propose_widgets', { ...reading({ ranking: { n: 5, direction: 'top' } }), widgets: [widget('scorecard', 'Total', { selectedMeasures: ['items.amt_sum'] })] }))
      .mockResolvedValueOnce(call('propose_widgets', { ...reading({ ranking: { n: 5, direction: 'top' } }), widgets: [widget('bar', 'Top labels')] }));
    const res = await chat(owner, ask('top 5 labels'));
    expect(providers.chat.mock.calls[1][0].messages.find((m) => m.role === 'tool').content).toMatch(/top 5/);
    expect(res.body.proposals[0].widgets[0].dataBinding.widgetFilters).toEqual([rankRule('top_n', 5)]);
  });

  test('the filters a question implies are applied to the visual, checked against the schema', async () => {
    providers.chat.mockResolvedValueOnce(call('propose_widgets', { widgets: [{
      ...widget('bar', 'Amount by label in 2023'),
      filters: [
        { field: 'items.day', op: 'between', values: ['2023-01-01', '2023-12-31'] },
        { field: 'items.label', op: 'contains', values: ['fr'] },
        { field: 'items.amt_sum', op: 'gt', values: [1000] },
      ],
      timePeriod: { dim: 'items.day', preset: 'last_12_months' },
    }] }));
    const res = await chat(owner, ask('amount by label in 2023, above 1000'));
    const [w] = res.body.proposals[0].widgets;
    expect(w.dataBinding.widgetFilters).toEqual([
      { field: 'items.day', isMeasure: false, op: 'between', value: '', values: ['2023-01-01', '2023-12-31'] },
      { field: 'items.label', isMeasure: false, op: 'contains', value: 'fr', values: [] },
      { field: 'items.amt_sum', isMeasure: true, op: 'gt', value: 1000, values: [] },
    ]);
    expect(w.dataBinding.timePeriod).toEqual({ dim: 'items.day', preset: 'last_12_months' });
  });

  test.each([
    ['an unknown field', { field: 'items.nope', op: 'in', values: ['a'] }, /unknown filter field/],
    ['an operator the field type does not take', { field: 'items.day', op: 'contains', values: ['x'] }, /operator must be one of between, gte, lte/],
    ['a date that is not one', { field: 'items.day', op: 'gte', values: ['last year'] }, /YYYY-MM-DD/],
    ['a value that is not a scalar', { field: 'items.label', op: 'in', values: [{ a: 1 }] }, /is not a valid value/],
  ])('a filter with %s goes back for repair, never through', async (_what, filter, message) => {
    providers.chat
      .mockResolvedValueOnce(call('propose_widgets', { widgets: [{ ...widget('bar', 'B'), filters: [filter] }] }))
      .mockResolvedValueOnce(say('ok'));
    const res = await chat(owner);
    expect(providers.chat.mock.calls[1][0].messages.find((m) => m.role === 'tool').content).toMatch(message);
    expect(res.body.proposals).toEqual([]);
  });

  test('nothing asked, nothing shaped', async () => {
    providers.chat.mockResolvedValueOnce(call('propose_widgets', { widgets: [widget('bar', 'By label')] }));
    const res = await chat(owner);
    const [w] = res.body.proposals[0].widgets;
    expect(w.dataBinding.widgetFilters).toBeUndefined();
    expect(w.config.sortOrder).toBeUndefined();
  });

  test('a tool that needs a page is refused', async () => {
    providers.chat
      .mockResolvedValueOnce(call('propose_design_changes', { summary: 's', ops: [] }))
      .mockResolvedValueOnce(say('Open a report to restyle it.'));
    const res = await chat(owner);
    expect(res.body).toEqual({ reply: 'Open a report to restyle it.', proposals: [] });
    const toolResult = providers.chat.mock.calls[1][0].messages.find((m) => m.role === 'tool');
    expect(toolResult.content).toMatch(/needs a report open in the editor/);
  });
});
