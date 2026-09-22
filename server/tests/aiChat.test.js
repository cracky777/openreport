jest.mock('../utils/ai/providers', () => ({
  ...jest.requireActual('../utils/ai/providers'),
  chat: jest.fn(),
}));
jest.mock('../utils/ai/cachedQuery', () => ({
  ...jest.requireActual('../utils/ai/cachedQuery'),
  queryCached: jest.fn(),
}));

const request = require('supertest');
const providers = require('../utils/ai/providers');
const { queryCached } = require('../utils/ai/cachedQuery');
const { setAiConfig } = require('../utils/settingsHelper');
const { MAX_ITERATIONS } = require('../utils/ai/agent');
const { buildApp, seedUser, seedDatasource, seedModel, seedReport, seedWorkspace, seedRollup, db } = require('./helpers/testApp');

const app = buildApp();
const ASK = { messages: [{ role: 'user', text: 'Sales by label?' }], pageContext: { pageWidth: 1140, pageHeight: 800, widgets: [] } };
const say = (text) => ({ text, toolCalls: [], usage: null });
const call = (name, args) => ({ text: '', toolCalls: [{ id: `c_${name}`, name, args, argsError: null }], usage: null });
const BAR = { type: 'bar', title: 'Sales', rationale: 'r', binding: { selectedDimensions: ['items.label'], selectedMeasures: ['items.amt_sum'] } };

describe('POST /api/ai/reports/:id/chat', () => {
  let owner, stranger, wsViewer, report, model;

  beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    owner = seedUser({ role: 'editor' });
    stranger = seedUser({ role: 'editor' });
    wsViewer = seedUser({ role: 'viewer' });
    const ws = seedWorkspace({ ownerId: owner });
    db.prepare('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?,?,?)').run(ws, wsViewer, 'viewer');
    const ds = seedDatasource({ userId: owner });
    model = seedModel({
      userId: owner,
      datasourceId: ds,
      measures: [
        { name: 'items.amt_sum', table: 'items', column: 'amt', aggregation: 'sum', label: 'Amount' },
        { name: 'items.secret', table: 'items', column: 'amt', aggregation: 'custom', expression: 'SUM(secret_col)', label: 'Custom' },
      ],
    });
    report = seedReport({ userId: owner, modelId: model, workspaceId: ws });
    seedRollup({ modelId: model });
  });
  afterAll(() => { jest.restoreAllMocks(); });

  beforeEach(() => {
    providers.chat.mockReset();
    queryCached.mockReset();
    setAiConfig({ provider: 'openai-compat', baseUrl: 'http://llm.test/v1', model: 'm', enabled: true, dataSharing: 'schema+cache' });
  });

  const chat = (uid, body = ASK, id = report) => {
    const r = request(app).post(`/api/ai/reports/${id}/chat`);
    if (uid) r.set('x-test-user', uid);
    return r.send(body);
  };

  test('access: 401 anonymous, 404 unknown, 403 without write access', async () => {
    expect((await chat(null)).status).toBe(401);
    expect((await chat(owner, ASK, 'nope')).status).toBe(404);
    expect((await chat(stranger)).status).toBe(403);
    expect((await chat(wsViewer)).status).toBe(403);
    expect(providers.chat).not.toHaveBeenCalled();
  });

  // Proposing a visual needs the schema, not the data: a model someone has just
  // added, with no report and no cache yet, is exactly where the assistant is
  // wanted. The cache only decides what it can READ. (A block on models without
  // a cache was tried, and taken back.)
  test('a model with no cache: the assistant still proposes, it just reads nothing', async () => {
    const bare = seedModel({ userId: owner, datasourceId: seedDatasource({ userId: owner }) });
    const bareReport = seedReport({ userId: owner, modelId: bare });
    providers.chat.mockResolvedValueOnce(call('propose_widgets', { widgets: [BAR] }));
    const visuals = await chat(owner, ASK, bareReport);
    expect(visuals.status).toBe(200);
    expect(visuals.body.proposals[0].widgets.map((w) => w.type)).toEqual(['bar']);
    expect(providers.chat.mock.calls[0][0].system).toContain('Nothing is cached yet');

    providers.chat.mockResolvedValueOnce(call('propose_widgets', { widgets: [BAR] }));
    const ask = await request(app).post(`/api/ai/models/${bare}/chat`).set('x-test-user', owner).send({ messages: ASK.messages });
    expect(ask.status).toBe(200);
  });

  // What the model read comes back to the client, which replays it in the
  // next turns: "among these" can then name them.
  test('cache reads come back with the answer, a miss explains the rule', async () => {
    providers.chat
      .mockResolvedValueOnce(call('query_cached_data', { dimensions: ['items.label'], measures: ['items.amt_sum'] }))
      .mockResolvedValueOnce(call('query_cached_data', { dimensions: ['items.label'], measures: ['items.secret'] }))
      .mockResolvedValueOnce(say('A leads.'));
    queryCached
      .mockResolvedValueOnce({ rows: Array.from({ length: 60 }, (_, i) => ({ label: `c${i}`, amt: i })), truncated: false })
      .mockResolvedValueOnce({ miss: 'no-rollup:items' });
    const res = await chat(owner);
    expect(res.body.reads).toEqual([{
      dimensions: ['items.label'], measures: ['items.amt_sum'],
      rows: expect.any(Array), truncated: true,
    }]);
    expect(res.body.reads[0].rows).toHaveLength(50);
    const missed = JSON.parse(providers.chat.mock.calls[2][0].messages.filter((m) => m.role === 'tool')[1].content);
    expect(missed).toEqual({ miss: 'no-rollup:items', note: expect.stringMatching(/only read data the cache holds/) });
  });

  // "How do I schedule this report?" — done for the user, on the report open in
  // the editor, once they confirm the card (the card calls the ordinary route).
  test('an action is proposed for the report open in the editor, never applied here', async () => {
    providers.chat.mockResolvedValueOnce(call('propose_action', { userAsked: 'do', action: 'schedule_cache_refresh', frequency: 'weekly', weekday: 'monday', time: '08:00', summary: 'Refresh every Monday.' }));
    const before = db.prepare('SELECT COUNT(*) AS n FROM cache_schedules').get().n;
    const res = await chat(owner, { ...ASK, messages: [{ role: 'user', text: 'Wie plane ich diesen Bericht jeden Montag?' }] });
    expect(res.body.proposals).toEqual([{ kind: 'action', action: 'schedule_cache_refresh', cron: '0 8 * * 1', schedule: { frequency: 'weekly', weekday: 'monday', time: '08:00' }, summary: 'Refresh every Monday.', reportId: report }]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM cache_schedules').get().n).toBe(before);
  });

  test('409 when the assistant is disabled', async () => {
    setAiConfig({ enabled: false });
    expect((await chat(owner)).status).toBe(409);
    const status = await request(app).get('/api/ai/status').set('x-test-user', owner);
    // Off at the instance is off for everyone: no provider, and no way to bring one.
    expect(status.body).toEqual({ enabled: false, dataSharing: 'schema', source: null, reason: 'off', personal: null });
  });

  test('a plain answer comes back with no proposal', async () => {
    providers.chat.mockResolvedValueOnce(say('Use a bar chart.'));
    const res = await chat(owner);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reply: 'Use a bar chart.', proposals: [] });
  });

  test('the prompt never carries SQL or physical names', async () => {
    providers.chat.mockResolvedValueOnce(say('ok'));
    await chat(owner);
    const { system } = providers.chat.mock.calls[0][0];
    expect(system).toContain('items.amt_sum');
    expect(system).not.toContain('secret_col');
    expect(system).not.toContain('expression');
  });

  test('a valid proposal is returned validated, layout clamped to the page', async () => {
    providers.chat.mockResolvedValueOnce(call('propose_widgets', { widgets: [{ ...BAR, subType: 'stacked', layout: { x: 5000, y: -40, w: 403, h: 10 } }] }));
    const res = await chat(owner);
    expect(res.body.proposals).toEqual([{
      kind: 'widgets',
      widgets: [{
        type: 'bar',
        config: { title: 'Sales', subType: 'stacked', showLegend: true, showXAxisTitle: false, showYAxisTitle: false },
        dataBinding: { selectedDimensions: ['items.label'], selectedMeasures: ['items.amt_sum'] },
        // h: a bar chart is raised to its readable floor, not to the generic one.
        layout: { x: 740, y: 0, w: 400, h: 200 },
        rationale: 'r',
      }],
    }]);
  });

  test('proposed charts drop the axis titles their own title repeats — except a scatter, which needs them', async () => {
    const fields = { selectedDimensions: ['items.label'], selectedMeasures: ['items.amt_sum'] };
    providers.chat.mockResolvedValueOnce(call('propose_widgets', { widgets: [
      { type: 'line', title: 'Trend', rationale: 'r', binding: fields },
      { type: 'combo', title: 'Mix', rationale: 'r', binding: { selectedDimensions: ['items.label'], comboBarMeasures: ['items.amt_sum'], comboLineMeasures: ['items.amt_sum'] } },
      { type: 'scatter', title: 'Cloud', rationale: 'r', binding: { selectedDimensions: ['items.label'], scatterMeasures: { x: 'items.amt_sum', y: 'items.amt_sum' } } },
      { type: 'pie', title: 'Share', rationale: 'r', binding: fields },
    ] }));
    const dashboard = { ...ASK, messages: [{ role: 'user', text: 'Build me a sales dashboard' }] };
    const [line, combo, scatter, pie] = (await chat(owner, dashboard)).body.proposals[0].widgets.map((w) => w.config);
    expect(line).toMatchObject({ showXAxisTitle: false, showYAxisTitle: false });
    expect(line.showSecondaryYAxisTitle).toBeUndefined();
    expect(combo).toMatchObject({ showXAxisTitle: false, showYAxisTitle: false, showSecondaryYAxisTitle: false });
    expect(scatter.showXAxisTitle).toBeUndefined();
    expect(pie.showXAxisTitle).toBeUndefined();
  });

  // The author asked for the "one visual per question" rule to go: the
  // visuals the model proposes are kept. What holds each chart to the question
  // is the kind of question the model says it answers.
  describe('several visuals, each held to the kind of question it answers', () => {
    const TOTAL = { type: 'scorecard', title: 'Total', rationale: 'r', binding: { selectedMeasures: ['items.amt_sum'] } };
    const ask = (text) => ({ ...ASK, messages: [{ role: 'user', text }] });

    test('the visuals proposed are kept as they came, in one round', async () => {
      providers.chat.mockResolvedValueOnce(call('propose_widgets', { widgets: [TOTAL, BAR] }));
      const res = await chat(owner, ask('Nombre de ventes par libellé'));
      expect(providers.chat).toHaveBeenCalledTimes(1);
      expect(res.body.proposals[0].widgets.map((w) => w.type)).toEqual(['scorecard', 'bar']);
    });

    test('a chart that does not answer the kind of question the model named goes back once', async () => {
      providers.chat
        .mockResolvedValueOnce(call('propose_widgets', { widgets: [{ ...BAR, type: 'pie', answers: 'ranking' }] }))
        .mockResolvedValueOnce(call('propose_widgets', { widgets: [{ ...BAR, answers: 'ranking' }] }));
      const res = await chat(owner, ask('Best labels'));
      expect(providers.chat.mock.calls[1][0].messages.find((m) => m.role === 'tool').content).toMatch(/a pie does not answer a ranking question; use bar or table/);
      expect(res.body.proposals[0].widgets.map((w) => w.type)).toEqual(['bar']);
    });

    // Reported: asked to analyse the population of a model with no date at
    // all, the model offered its "evolution" among four visuals.
    test('a model with no date: no trend is offered, and one proposed anyway is left out', async () => {
      providers.chat
        .mockResolvedValueOnce(call('propose_widgets', { widgets: [{ ...BAR, answers: 'comparison' }, { ...BAR, type: 'line', title: 'Evolution', answers: 'trend' }] }))
        .mockResolvedValueOnce(call('propose_widgets', { widgets: [{ ...BAR, answers: 'comparison' }, { ...BAR, type: 'line', title: 'Evolution', answers: 'trend' }] }));
      const res = await chat(owner, ask('Analyse the sales'));
      const { system, tools } = providers.chat.mock.calls[0][0];
      const item = tools.find((t) => t.name === 'propose_widgets').parameters.properties.widgets.items.properties;
      expect(item.answers.enum).not.toContain('trend');
      expect(item.timePeriod).toBeUndefined();
      expect(system).toContain('This model has NO date dimension');
      expect(providers.chat.mock.calls[1][0].messages.find((m) => m.role === 'tool').content).toMatch(/no date dimension, so nothing can be shown over time/);
      expect(res.body.proposals[0].widgets.map((w) => w.config.title)).toEqual(['Sales']);
    });

    test('still mismatched after the repair: kept, and flagged to the author', async () => {
      const wrong = call('propose_widgets', { widgets: [{ ...TOTAL, answers: 'ranking' }] });
      providers.chat.mockResolvedValueOnce(wrong).mockResolvedValueOnce(wrong);
      const res = await chat(owner, ask('Quel est le total ?'));
      expect(res.body.proposals[0].widgets.map((w) => w.type)).toEqual(['scorecard']);
      expect(res.body.reply).toMatch(/Check before applying: .*a scorecard does not answer a ranking question/);
    });

    test.each([
      ['figure', { ...TOTAL }],
      ['ranking', { ...BAR }],
      ['share', { ...BAR, type: 'pie' }],
      ['detail', { ...BAR, type: 'table' }],
    ])('%s answered by the matching type passes without a round trip', async (answers, w) => {
      providers.chat.mockResolvedValueOnce(call('propose_widgets', { widgets: [{ ...w, answers }] }));
      await chat(owner, ask('Show me the sales'));
      expect(providers.chat).toHaveBeenCalledTimes(1);
    });

    // The author's second report: a single scorecard of the total, with the
    // advice to filter by region. "By region" was the question.
    test('a lone figure does not answer "by …": the model is told, once', async () => {
      providers.chat
        .mockResolvedValueOnce(call('propose_widgets', { reading: { breakdownBy: ['items.label'] }, widgets: [TOTAL] }))
        .mockResolvedValueOnce(call('propose_widgets', { reading: { breakdownBy: ['items.label'] }, widgets: [BAR] }));
      const res = await chat(owner, ask('Nombre d\'habitants par région'));
      expect(providers.chat.mock.calls[1][0].messages.find((m) => m.role === 'tool').content).toMatch(/reading says the request asks for a measure by items\.label/);
      expect(res.body.proposals[0].widgets.map((w) => w.type)).toEqual(['bar']);
    });

    test.each(['Quel est le total des ventes ?', 'Ventes par rapport à l\'an dernier', 'Total sales, par exemple en scorecard'])('%s — a figure is a fine answer', async (text) => {
      providers.chat.mockResolvedValueOnce(call('propose_widgets', { widgets: [TOTAL] }));
      const res = await chat(owner, ask(text));
      expect(providers.chat).toHaveBeenCalledTimes(1);
      expect(res.body.proposals[0].widgets.map((w) => w.type)).toEqual(['scorecard']);
    });
    test('a rejected widget is not padding', async () => {
      const ghost = { ...BAR, binding: { selectedDimensions: ['items.ghost'], selectedMeasures: ['items.amt_sum'] } };
      providers.chat.mockResolvedValue(call('propose_widgets', { widgets: [ghost, BAR] }));
      const res = await chat(owner, ask('Sales by label'));
      expect(res.body.proposals[0].widgets).toHaveLength(1);
      expect(res.body.proposals[0].widgets[0].dataBinding.selectedDimensions).toEqual(['items.label']);
    });
  });

  test('a hallucinated field gets one repair round, then is dropped', async () => {
    const bad = { ...BAR, binding: { selectedDimensions: ['items.ghost'], selectedMeasures: ['items.amt_sum'] } };
    providers.chat
      .mockResolvedValueOnce(call('propose_widgets', { widgets: [bad] }))
      .mockResolvedValueOnce(call('propose_widgets', { widgets: [bad, BAR] }));
    const res = await chat(owner);

    // The conversation array is shared with the loop, so look the first tool
    // result up rather than reading the tail.
    const firstResult = providers.chat.mock.calls[1][0].messages.find((m) => m.role === 'tool');
    expect(firstResult.isError).toBe(true);
    expect(firstResult.content).toContain('Widget 1');
    expect(res.body.proposals[0].widgets).toHaveLength(1);
    expect(res.body.proposals[0].widgets[0].dataBinding.selectedDimensions).toEqual(['items.label']);
    expect(res.body.reply).toMatch(/Left out: Widget 1/);
  });

  test('config keys the model invents never reach the proposal', async () => {
    providers.chat.mockResolvedValueOnce(call('propose_widgets', { widgets: [{ ...BAR, config: { bundleUrl: 'http://evil' }, dataBinding: { x: 1 } }] }));
    const w = (await chat(owner)).body.proposals[0].widgets[0];
    expect(Object.keys(w.config).sort()).toEqual(['showLegend', 'showXAxisTitle', 'showYAxisTitle', 'title']);
  });

  test('a design proposal targets widgets of the submitted page only', async () => {
    providers.chat.mockResolvedValueOnce(call('propose_design_changes', {
      reading: { layout: false, colors: false, theme: true },
      summary: 'KPI first.',
      ops: [
        { op: 'update_config', widgetId: 'w1', set: { color: '#2563eb', bundleUrl: 'http://evil' } },
        { op: 'move', widgetId: 'ghost', x: 0, y: 0, w: 200, h: 200 },
        { op: 'report_settings', set: { theme: 'dark' } },
      ],
    })).mockResolvedValueOnce(call('propose_design_changes', {
      reading: { layout: false, colors: false, theme: true },
      summary: 'KPI first.',
      ops: [
        { op: 'update_config', widgetId: 'w1', set: { color: '#2563eb' } },
        { op: 'report_settings', set: { theme: 'dark' } },
      ],
    }));
    const res = await chat(owner, {
      // A request about the theme: a theme switch is only accepted when it is asked for.
      messages: [{ role: 'user', text: 'Switch to a dark theme and make the bars blue' }],
      mode: 'design',
      pageContext: { themes: ['light', 'dark'], theme: 'light', widgets: [{ id: 'w1', type: 'bar', config: { color: '#000000', bundleUrl: 'KEEP-OUT' } }] },
    });
    expect(providers.chat.mock.calls[0][0].system).not.toContain('KEEP-OUT');
    expect(res.body.proposals).toEqual([{
      kind: 'design',
      summary: 'KPI first.',
      advice: [],
      colorScheme: null,
      ops: [
        { op: 'update_config', widgetId: 'w1', set: { color: '#2563eb' } },
        { op: 'report_settings', set: { theme: 'dark' } },
      ],
    }]);
  });

  test('a follow-up after a wordless proposal never sends an empty assistant message', async () => {
    providers.chat.mockResolvedValueOnce(say('ok'));
    const res = await chat(owner, {
      ...ASK,
      messages: [{ role: 'user', text: 'Sales?' }, { role: 'assistant', text: '' }, { role: 'user', text: 'Make it a line chart' }],
    });
    expect(res.status).toBe(200);
    const sent = providers.chat.mock.calls[0][0].messages;
    expect(sent.every((m) => m.text.trim().length > 0)).toBe(true);
  });

  test('an empty answer from the provider is retried as is, then said, never shown as a blank', async () => {
    providers.chat.mockResolvedValueOnce(say('')).mockResolvedValueOnce(call('propose_widgets', { widgets: [BAR] }));
    expect((await chat(owner)).body.proposals).toHaveLength(1);

    providers.chat.mockReset();
    providers.chat.mockResolvedValue(say('  '));
    const res = await chat(owner);
    // The same request, sent again as is: nothing was added to the conversation.
    expect(providers.chat).toHaveBeenCalledTimes(4);
    expect(providers.chat.mock.calls[3][0].messages).toHaveLength(1);
    expect(res.body).toEqual({ reply: expect.stringMatching(/empty answer/), proposals: [] });
  });

  test('a proposal typed out as JSON is pushed back once into a real tool call', async () => {
    const written = say('#### Option 1\n```json\n{ "widgets": [{ "type": "bar", "binding": {} }] }\n```\nQuelle option préférez-vous ?');
    providers.chat.mockResolvedValueOnce(written).mockResolvedValueOnce(call('propose_widgets', { widgets: [BAR] }));
    const res = await chat(owner);
    // Shared array again: look the push-back up rather than reading the tail.
    expect(providers.chat.mock.calls[1][0].messages.filter((m) => m.role === 'user').at(-1).text).toContain('Call propose_widgets now');
    expect(res.body.proposals[0].widgets).toHaveLength(1);

    // Once only: a model that keeps typing gets its text through, not a loop.
    providers.chat.mockReset();
    providers.chat.mockResolvedValue(written);
    await chat(owner);
    expect(providers.chat).toHaveBeenCalledTimes(2);
  });

  // Reported by the author: asked for the color of the legend text, the page
  // came back re-laid and every chart recolored.
  // Asked for the legend text color, a real model re-laid the page and
  // recolored every chart. Its own reading of the request now says what may
  // change; the rest is dropped whatever it writes.
  test('a targeted design request: only what the reading allows is applied', async () => {
    providers.chat.mockResolvedValueOnce(call('propose_design_changes', {
      reading: { layout: false, colors: false, theme: false },
      summary: 'Légendes en gris foncé.',
      arrangement: { rows: [{ widgets: ['w2', 'w1'] }] },
      colorScheme: 'triadic',
      ops: [{ op: 'update_config', widgetId: 'w1', set: { legendTextColor: '#334155' } }],
    }));
    const res = await chat(owner, {
      messages: [{ role: 'user', text: 'change la couleur du texte des légendes en gris foncé' }],
      mode: 'design',
      pageContext: { theme: 'light', widgets: [
        { id: 'a', type: 'bar', title: 'A', layout: { x: 0, y: 0, w: 400, h: 300 } },
        { id: 'b', type: 'pie', title: 'B', layout: { x: 420, y: 0, w: 400, h: 300 } },
      ] },
    });
    const sent = providers.chat.mock.calls[0][0];
    expect(Object.keys(sent.tools[0].parameters.properties)[0]).toBe('reading');
    expect(providers.chat).toHaveBeenCalledTimes(1);
    expect(res.body.proposals[0].ops).toEqual([{ op: 'update_config', widgetId: 'a', set: { legendTextColor: '#334155' } }]);
    expect(res.body.proposals[0].colorScheme).toBeNull();
  });

  test('an overlap gets the repair round, then is kept and flagged to the author', async () => {
    // The model names widgets by alias (w1, w2…); what comes back carries the real id.
    const stack = call('propose_design_changes', { reading: { layout: true, colors: false, theme: false }, summary: 's', ops: [{ op: 'move', widgetId: 'w2', x: 100, y: 0, w: 400, h: 300 }] });
    providers.chat.mockResolvedValueOnce(stack).mockResolvedValueOnce(stack);
    const res = await chat(owner, {
      // A request about the layout: a move is only accepted when it is asked for.
      messages: [{ role: 'user', text: 'Déplace le second graphique' }],
      mode: 'design',
      pageContext: { widgets: [
        { id: 'a', type: 'bar', title: 'A', layout: { x: 0, y: 0, w: 400, h: 300 } },
        { id: 'b', type: 'line', title: 'B', layout: { x: 420, y: 0, w: 400, h: 300 } },
      ] },
    });
    expect(providers.chat).toHaveBeenCalledTimes(2);
    expect(providers.chat.mock.calls[1][0].messages.find((m) => m.role === 'tool').content).toContain('would overlap');
    expect(res.body.proposals[0].ops).toEqual([{ op: 'move', widgetId: 'b', x: 100, y: 0, w: 400, h: 300 }]);
    expect(providers.chat.mock.calls[0][0].system).toContain('"id":"w2"');
    expect(providers.chat.mock.calls[0][0].system).not.toContain('"id":"b"');
    expect(res.body.reply).toMatch(/Check before applying: "A" and "B" would overlap/);
    expect(providers.chat.mock.calls[0][0].system).toContain('bar 280×200');
  });

  test('cache reads go through queryCached and the loop is bounded', async () => {
    queryCached.mockResolvedValue({ rows: [{ label: 'a', Amount: 1 }], truncated: false });
    providers.chat.mockResolvedValue(call('query_cached_data', { dimensions: ['items.label'], measures: ['items.amt_sum'] }));
    const res = await chat(owner);
    expect(res.status).toBe(200);
    expect(providers.chat).toHaveBeenCalledTimes(MAX_ITERATIONS);
    expect(queryCached).toHaveBeenCalledTimes(MAX_ITERATIONS);
    expect(queryCached.mock.calls[0][0].user.id).toBe(owner);
    expect(res.body.proposals).toEqual([]);
  });

  test('schema-only mode offers no data tool and refuses a call to it', async () => {
    setAiConfig({ dataSharing: 'schema' });
    providers.chat
      .mockResolvedValueOnce(call('query_cached_data', { dimensions: [], measures: ['items.amt_sum'] }))
      .mockResolvedValueOnce(say('No data access.'));
    await chat(owner);
    // The owner of the workspace is its admin, hence the second tool.
    expect(providers.chat.mock.calls[0][0].tools.map((t) => t.name).filter((n) => n !== 'read_help'))
      .toEqual(['propose_widgets', 'propose_custom_visual', 'propose_action']);
    expect(queryCached).not.toHaveBeenCalled();
  });

  test('the mode picks the toolset, and a tool of the other mode is refused', async () => {
    const restyle = call('propose_design_changes', { summary: 's', ops: [{ op: 'report_settings', set: { theme: 'dark' } }] });
    providers.chat.mockResolvedValueOnce(restyle).mockResolvedValueOnce(say('Switch to Design.'));
    const visuals = await chat(owner, { ...ASK, pageContext: { themes: ['light', 'dark'] } });
    expect(visuals.body).toEqual({ reply: 'Switch to Design.', proposals: [] });
    expect(providers.chat.mock.calls[1][0].messages.find((m) => m.role === 'tool').isError).toBe(true);
    const visualsPrompt = providers.chat.mock.calls[0][0].system;

    providers.chat.mockReset();
    providers.chat.mockResolvedValueOnce(call('propose_widgets', { widgets: [BAR] })).mockResolvedValueOnce(say('Switch to Visuals.'));
    const design = await chat(owner, { ...ASK, mode: 'design' });
    expect(design.body.proposals).toEqual([]);
    const sent = providers.chat.mock.calls[0][0];
    // No data tool and no schema either: a restyle has no use for them.
    expect(sent.tools.map((t) => t.name).filter((n) => n !== 'read_help')).toEqual(['propose_design_changes']);
    expect(sent.system).not.toContain('items.amt_sum');
    expect(sent.system).not.toContain('propose_widgets');
    // The chart-choice guide is dead weight when no chart can be proposed.
    expect(sent.system).not.toContain('Choosing the visual');
    expect(visualsPrompt).toContain('Choosing the visual');
    expect(visualsPrompt).toContain('No built-in type draws');
    // An unknown mode is the default one, never a third behaviour.
    providers.chat.mockReset();
    providers.chat.mockResolvedValueOnce(say('ok'));
    await chat(owner, { ...ASK, mode: 'everything' });
    expect(providers.chat.mock.calls[0][0].tools.map((t) => t.name)).not.toContain('propose_design_changes');
  });

  test('page context: fetched data is stripped, an oversized page is a 400', async () => {
    providers.chat.mockResolvedValueOnce(say('ok'));
    await chat(owner, {
      ...ASK,
      pageContext: { widgets: [{ id: 'w1', type: 'bar', title: 't', dataBinding: {}, data: { rows: [{ leaked: 'ROWDATA' }] } }] },
    });
    expect(providers.chat.mock.calls[0][0].system).not.toContain('ROWDATA');

    const many = Array.from({ length: 61 }, (_, i) => ({ id: `w${i}`, type: 'bar' }));
    expect((await chat(owner, { ...ASK, pageContext: { widgets: many } })).status).toBe(400);
  });

  test.each([
    ['no messages', { messages: [] }],
    ['a system role', { messages: [{ role: 'system', text: 'x' }] }],
    ['an assistant last', { messages: [{ role: 'user', text: 'a' }, { role: 'assistant', text: 'b' }] }],
    ['an oversized message', { messages: [{ role: 'user', text: 'x'.repeat(8001) }] }],
  ])('%s is a 400', async (_what, body) => {
    expect((await chat(owner, { ...ASK, ...body })).status).toBe(400);
  });

  test('a provider failure is a 502 with its short message', async () => {
    providers.chat.mockRejectedValueOnce(new providers.AiProviderError(502, 'The AI provider rejected the API key'));
    const res = await chat(owner);
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'The AI provider rejected the API key' });
  });
});
