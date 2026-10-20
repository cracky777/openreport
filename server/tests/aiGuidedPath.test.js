// The guided path of an open request: the objectives of the model's domains in
// the prompt, one closed question at a time (`ask_user`), and what the model
// says it understood, all held to the catalogue and the schema.
jest.mock('../utils/ai/providers', () => ({
  ...jest.requireActual('../utils/ai/providers'),
  chat: jest.fn(),
}));

const request = require('supertest');
const providers = require('../utils/ai/providers');
const { setAiConfig } = require('../utils/settingsHelper');
const { guidedLines, validateQuestion, validateUnderstood, rolesOf, objectivesOf } = require('../utils/ai/guidedPath');
const { DOMAINS } = require('../utils/ai/domains');
const { buildEffectiveModel } = require('../utils/ai/effectiveModel');
const { widgetsToolFor } = require('../utils/ai/tools');
const { buildApp, seedUser, seedDatasource, seedModel, seedReport, db } = require('./helpers/testApp');

const app = buildApp();
const call = (name, args) => ({ text: '', toolCalls: [{ id: `c_${name}`, name, args, argsError: null }], usage: null });
// A conversation where the user was already asked which pages they want: the
// digest of that question is what the browser carries back (useAiChat.toWire).
const afterPageQuestion = (text) => [
  { role: 'user', text },
  { role: 'assistant', text: '[Asked the user: "Which pages should the report have?" — options: Sales overview | Products]' },
  { role: 'user', text: 'Sales overview, Products' },
];

const MODEL = {
  domains: ['ecommerce'],
  dimensions: [
    { name: 'orders.day', table: 'orders', column: 'day', type: 'date', label: 'Day', role: 'ecommerce.order_date' },
    { name: 'orders.country', table: 'orders', column: 'country', type: 'string', label: 'Country' },
    { name: 'orders.utm', table: 'orders', column: 'utm', type: 'string', label: 'UTM' },
  ],
  measures: [
    { name: 'orders.amount_sum', table: 'orders', column: 'amount', aggregation: 'sum', label: 'Amount', role: 'ecommerce.revenue' },
    { name: 'orders.n', table: 'orders', column: 'id', aggregation: 'count', label: 'Orders' },
  ],
};
const effective = buildEffectiveModel(MODEL, {});

describe('what the prompt says', () => {
  test('with domains: the roles present, the objectives with what is missing, the forks resolved', () => {
    expect(rolesOf(effective)).toEqual({ 'ecommerce.order_date': 'orders.day', 'ecommerce.revenue': 'orders.amount_sum' });
    const text = guidedLines(effective).join('\n');
    expect(text).toContain('Roles present: ecommerce.order_date = orders.day, ecommerce.revenue = orders.amount_sum');
    expect(text).toContain('- ecommerce.sales_overview "Sales overview" — How is the shop doing? Needs ecommerce.order_date, ecommerce.order (MISSING), ecommerce.revenue.');
    expect(text).toContain('If ecommerce.sessions absent: sales by source only');
    expect(text).not.toContain('combo: sessions as bars');
  });

  test('without a domain: the catalogue to match against, no objectives', () => {
    const text = guidedLines(buildEffectiveModel({ dimensions: [], measures: [] }, {})).join('\n');
    expect(text).toContain('No domain declared. Catalogue: finance (Finance)');
    expect(text).not.toContain('Objectives of');
  });

  test('every domain has objectives, and every role they name is a role of that domain', () => {
    for (const d of DOMAINS) {
      const objectives = objectivesOf(d.id);
      expect(objectives.length).toBeGreaterThan(0);
      const roles = new Set(d.roles.map((r) => r.id));
      const ids = objectives.map((o) => o.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const o of objectives) {
        expect(o.needs.length).toBeGreaterThan(0);
        for (const r of [...o.needs, ...(o.forks || []).map((f) => f.role)]) expect(`${d.id}: ${roles.has(r) ? r : `UNKNOWN ${r}`}`).toBe(`${d.id}: ${r}`);
      }
    }
  });

  test('the widgets tool keeps reading and understood next to the widgets', () => {
    const props = widgetsToolFor({ withLayout: false }).parameters.properties;
    expect(Object.keys(props)).toEqual(['reading', 'understood', 'widgets']);
  });
});

describe('ask_user', () => {
  const ctx = { effective };

  test('an objective question: labels only', () => {
    const out = validateQuestion({ question: 'What do you want to follow?', options: [{ label: 'Sales overview' }, { label: 'Acquisition' }, { label: 'Acquisition' }] }, ctx);
    expect(out.errors).toEqual([]);
    expect(out.payload).toEqual({ kind: 'question', question: 'What do you want to follow?', options: [{ label: 'Sales overview' }, { label: 'Acquisition' }] });
  });

  test('a domain question: values are catalogue ids', () => {
    const out = validateQuestion({ question: 'Which trade?', learn: { kind: 'domain' }, options: [{ label: 'E-commerce', value: 'ecommerce' }, { label: 'Retail', value: 'retail' }, { label: 'Nope', value: 'ghost' }] }, ctx);
    expect(out.payload).toBeNull();
    expect(out.errors).toEqual(['options: "Nope": value must be a domain id of the catalogue']);
    const ok = validateQuestion({ question: 'Which trade?', learn: { kind: 'domain' }, options: [{ label: 'E-commerce', value: 'ecommerce' }, { label: 'Retail', value: 'retail' }] }, ctx);
    expect(ok.payload.learn).toEqual({ kind: 'domain' });
  });

  test('a role question: values are fields of the schema that may carry the role; synonyms are bounded', () => {
    const out = validateQuestion({
      question: 'Which column says where a visitor came from?',
      learn: { kind: 'role', role: 'ecommerce.source', synonyms: ['traffic source', 'provenance', '', 7] },
      options: [{ label: 'utm', value: 'orders.utm' }, { label: 'country', value: 'orders.country' }, { label: 'amount', value: 'orders.amount_sum' }],
    }, ctx);
    expect(out.payload).toBeNull();
    expect(out.errors).toEqual(['options: orders.amount_sum is a measure, ecommerce.source is not a measure role']);
    const ok = validateQuestion({ question: 'Which?', learn: { kind: 'role', role: 'ecommerce.source', synonyms: ['traffic source'] }, options: [{ label: 'utm', value: 'orders.utm' }, { label: 'country', value: 'orders.country' }] }, ctx);
    expect(ok.payload).toEqual({ kind: 'question', question: 'Which?', options: [{ label: 'utm', value: 'orders.utm' }, { label: 'country', value: 'orders.country' }], learn: { kind: 'role', role: 'ecommerce.source', synonyms: ['traffic source'] } });
    expect(validateQuestion({ question: 'x', learn: { kind: 'role', role: 'ecommerce.nope' }, options: [{ label: 'a', value: 'orders.utm' }, { label: 'b', value: 'orders.country' }] }, ctx).errors[0]).toMatch(/not a role of the catalogue/);
    expect(validateQuestion({ question: 'x', options: [{ label: 'a' }] }, ctx).errors).toEqual(['options: two to six choices']);
    // "None of these" without a value is a plain answer, kept; a question whose every option is valueless teaches nothing.
    const none = validateQuestion({ question: 'Which?', learn: { kind: 'role', role: 'ecommerce.source' }, options: [{ label: 'utm', value: 'orders.utm' }, { label: 'None of these' }] }, ctx);
    expect(none.payload.options).toEqual([{ label: 'utm', value: 'orders.utm' }, { label: 'None of these' }]);
    expect(validateQuestion({ question: 'Which?', learn: { kind: 'role', role: 'ecommerce.source' }, options: [{ label: 'a' }, { label: 'b' }] }, ctx).errors).toEqual(['options: a role question needs at least one option with a value to learn from']);
  });
});

describe('understood', () => {
  test('kept when it fits the catalogue and the schema, junk dropped with a warning', () => {
    const out = validateUnderstood({ understood: { domain: 'ecommerce', objective: 'acquisition', roles: { 'ecommerce.revenue': 'orders.amount_sum', 'ecommerce.source': 'orders.utm', 'ecommerce.order': 'orders.amount_sum', 'ghost.x': 'orders.utm' } } }, { effective });
    expect(out.understood).toEqual({
      domain: { id: 'ecommerce', label: 'E-commerce' },
      objective: { id: 'acquisition', label: 'Acquisition and conversion' },
      roles: [{ role: 'ecommerce.revenue', label: 'Revenue', field: 'orders.amount_sum' }, { role: 'ecommerce.source', label: 'Acquisition source', field: 'orders.utm' }],
    });
    expect(out.warnings).toHaveLength(2);
    expect(validateUnderstood({}, { effective })).toEqual({ understood: null, warnings: [] });
    expect(validateUnderstood({ understood: { domain: 'ghost' } }, { effective }).understood).toBeNull();
  });
});

describe('through the Ask route', () => {
  let owner, model;
  beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    owner = seedUser({ role: 'editor' });
    model = seedModel({ userId: owner, datasourceId: seedDatasource({ userId: owner }), dimensions: MODEL.dimensions, measures: MODEL.measures });
    db.prepare("UPDATE models SET domains = '[\"ecommerce\"]' WHERE id = ?").run(model);
  });
  afterAll(() => { jest.restoreAllMocks(); });
  beforeEach(() => {
    providers.chat.mockReset();
    setAiConfig({ provider: 'openai-compat', baseUrl: 'http://llm.test/v1', model: 'm', enabled: true, dataSharing: 'schema' });
  });
  const chat = (text) => request(app).post(`/api/ai/models/${model}/chat`).set('x-test-user', owner).send({ messages: [{ role: 'user', text }] });

  test('a question ends the turn as a card; the prompt carried the objectives', async () => {
    providers.chat.mockResolvedValueOnce(call('ask_user', { question: 'What do you want to follow?', options: [{ label: 'Sales overview' }, { label: 'Products' }] }));
    const res = await chat('I need a dashboard');
    expect(res.status).toBe(200);
    expect(res.body.proposals).toEqual([{ kind: 'question', question: 'What do you want to follow?', options: [{ label: 'Sales overview' }, { label: 'Products' }] }]);
    const sent = providers.chat.mock.calls[0][0];
    expect(sent.tools.map((t) => t.name)).toContain('ask_user');
    expect(sent.system).toContain('Objectives of E-commerce (ecommerce):');
    expect(sent.system).toContain('Roles present: ecommerce.order_date = orders.day');
  });

  test('a bad question gets one repair round, then the model answers in words', async () => {
    providers.chat
      .mockResolvedValueOnce(call('ask_user', { question: 'Which?', learn: { kind: 'role', role: 'ecommerce.source' }, options: [{ label: 'a', value: 'nope' }, { label: 'b', value: 'orders.utm' }] }))
      .mockResolvedValueOnce({ text: 'Sorry.', toolCalls: [], usage: null });
    const res = await chat('I need a dashboard');
    expect(res.body.proposals).toEqual([]);
    const repair = providers.chat.mock.calls[1][0].messages.find((m) => m.role === 'tool');
    expect(repair.content).toContain('value must be a field name of the schema');
  });

  test('understood rides on the widgets card', async () => {
    providers.chat.mockResolvedValueOnce(call('propose_widgets', {
      reading: { breakdownBy: ['orders.utm'] },
      understood: { domain: 'ecommerce', objective: 'acquisition', roles: { 'ecommerce.source': 'orders.utm' } },
      widgets: [{ type: 'bar', answers: 'comparison', title: 'Revenue by source', rationale: 'r', binding: { selectedDimensions: ['orders.utm'], selectedMeasures: ['orders.amount_sum'] } }],
    }));
    const res = await chat('Revenue by traffic source');
    expect(res.body.proposals[0].kind).toBe('widgets');
    expect(res.body.proposals[0].understood).toEqual({
      domain: { id: 'ecommerce', label: 'E-commerce' },
      objective: { id: 'acquisition', label: 'Acquisition and conversion' },
      roles: [{ role: 'ecommerce.source', label: 'Acquisition source', field: 'orders.utm' }],
    });
  });
});

describe('propose_report through the Ask route', () => {
  let owner, model;
  beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    owner = seedUser({ role: 'editor' });
    model = seedModel({ userId: owner, datasourceId: seedDatasource({ userId: owner }), dimensions: MODEL.dimensions, measures: MODEL.measures });
  });
  afterAll(() => { jest.restoreAllMocks(); });
  beforeEach(() => {
    providers.chat.mockReset();
    setAiConfig({ provider: 'openai-compat', baseUrl: 'http://llm.test/v1', model: 'm', enabled: true, dataSharing: 'schema' });
  });
  const bar = (title, dim) => ({ type: 'bar', answers: 'comparison', title, rationale: 'r', binding: { selectedDimensions: [dim], selectedMeasures: ['orders.amount_sum'] } });

  test('each page is checked and laid out; an empty page is dropped; the tool is offered in Ask only', async () => {
    providers.chat.mockResolvedValueOnce(call('propose_report', {
      reading: {}, title: 'Shop report',
      understood: { domain: 'ecommerce' },
      pages: [
        { name: 'Overview', widgets: [{ type: 'scorecard', answers: 'figure', title: 'Revenue', rationale: 'r', binding: { selectedMeasures: ['orders.amount_sum'] } }, bar('By country', 'orders.country')] },
        { name: 'Broken', widgets: [bar('Nope', 'orders.nope')] },
        { name: 'Sources', widgets: [bar('By source', 'orders.utm')] },
      ],
    })).mockResolvedValueOnce(call('propose_report', {
      reading: {}, title: 'Shop report', pages: [{ name: 'Overview', widgets: [bar('By country', 'orders.country')] }],
    }));
    const res = await request(app).post(`/api/ai/models/${model}/chat`).set('x-test-user', owner).send({ messages: afterPageQuestion('A full report on my shop') });
    expect(res.status).toBe(200);
    // The broken page cost one repair round; the second call is what lands.
    expect(providers.chat).toHaveBeenCalledTimes(2);
    expect(providers.chat.mock.calls[1][0].messages.find((m) => m.role === 'tool').content).toMatch(/Broken: /);
    const [report] = res.body.proposals;
    expect(report.kind).toBe('report');
    expect(report.title).toBe('Shop report');
    expect(report.pages.map((p) => p.name)).toEqual(['Overview']);
    expect(report.pages[0].widgets[0].layout).toEqual(expect.objectContaining({ x: expect.any(Number), w: expect.any(Number) }));
    expect(providers.chat.mock.calls[0][0].tools.map((t) => t.name)).toContain('propose_report');
  });

  test('in the report editor the tool is not offered, and a call to it is turned back', async () => {
    const reportId = seedReport({ userId: owner, modelId: model });
    providers.chat
      .mockResolvedValueOnce(call('propose_report', { reading: {}, title: 'x', pages: [{ name: 'p', widgets: [bar('By country', 'orders.country')] }] }))
      .mockResolvedValueOnce({ text: 'One page then.', toolCalls: [], usage: null });
    const res = await request(app).post(`/api/ai/reports/${reportId}/chat`).set('x-test-user', owner)
      .send({ messages: [{ role: 'user', text: 'A full report' }], pageContext: { pageWidth: 1140, pageHeight: 800, widgets: [] } });
    expect(res.status).toBe(200);
    expect(res.body.proposals).toEqual([]);
    expect(providers.chat.mock.calls[0][0].tools.map((t) => t.name)).not.toContain('propose_report');
    expect(providers.chat.mock.calls[1][0].messages.find((m) => m.role === 'tool').content).toMatch(/propose_report is for the Assistant panel/);
    const { reportToolFor } = require('../utils/ai/tools');
    const props = reportToolFor({}).parameters.properties;
    expect(Object.keys(props)).toEqual(['reading', 'understood', 'title', 'measures', 'pages']);
    expect(props.pages.items.properties.widgets.items.properties.layout).toBeUndefined();
  });
});

describe('the scope the model declares', () => {
  let owner, model;
  beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    owner = seedUser({ role: 'editor' });
    model = seedModel({ userId: owner, datasourceId: seedDatasource({ userId: owner }), dimensions: MODEL.dimensions, measures: MODEL.measures });
  });
  afterAll(() => { jest.restoreAllMocks(); });
  beforeEach(() => {
    providers.chat.mockReset();
    setAiConfig({ provider: 'openai-compat', baseUrl: 'http://llm.test/v1', model: 'm', enabled: true, dataSharing: 'schema' });
  });
  const bar = { type: 'bar', answers: 'comparison', title: 'By country', rationale: 'r', binding: { selectedDimensions: ['orders.country'], selectedMeasures: ['orders.amount_sum'] } };

  test('a whole report read, one page proposed: turned back to propose_report', async () => {
    providers.chat
      .mockResolvedValueOnce(call('propose_widgets', { reading: { scope: 'report' }, widgets: [bar] }))
      .mockResolvedValueOnce(call('propose_report', { reading: { scope: 'report' }, title: 'Shop', pages: [{ name: 'Overview', widgets: [bar] }] }));
    const res = await request(app).post(`/api/ai/models/${model}/chat`).set('x-test-user', owner).send({ messages: afterPageQuestion('Make me a report') });
    expect(res.body.proposals[0].kind).toBe('report');
    expect(providers.chat.mock.calls[1][0].messages.find((m) => m.role === 'tool').content).toMatch(/call propose_report instead/);
    expect(providers.chat.mock.calls[0][0].tools.find((t) => t.name === 'propose_widgets').parameters.properties.reading.required).toEqual(['scope']);
  });

  test('a view read, a report proposed: turned back to propose_widgets', async () => {
    providers.chat
      .mockResolvedValueOnce(call('propose_report', { reading: { scope: 'view' }, title: 'Shop', pages: [{ name: 'Overview', widgets: [bar] }] }))
      .mockResolvedValueOnce(call('propose_widgets', { reading: { scope: 'view' }, widgets: [bar] }));
    const res = await request(app).post(`/api/ai/models/${model}/chat`).set('x-test-user', owner).send({ messages: [{ role: 'user', text: 'Sales by country' }] });
    expect(res.body.proposals[0].kind).toBe('widgets');
  });
});

describe('the AI studio', () => {
  let owner, model, reportId;
  beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    owner = seedUser({ role: 'editor' });
    model = seedModel({ userId: owner, datasourceId: seedDatasource({ userId: owner }), dimensions: MODEL.dimensions, measures: MODEL.measures });
    reportId = seedReport({ userId: owner, modelId: model });
  });
  afterAll(() => { jest.restoreAllMocks(); });
  beforeEach(() => {
    providers.chat.mockReset();
    setAiConfig({ provider: 'openai-compat', baseUrl: 'http://llm.test/v1', model: 'm', enabled: true, dataSharing: 'schema' });
  });

  test('the report chat of the studio is handed whole reports, laid out on the page it was told', async () => {
    const bar = { type: 'bar', answers: 'comparison', title: 'By country', rationale: 'r', binding: { selectedDimensions: ['orders.country'], selectedMeasures: ['orders.amount_sum'] } };
    providers.chat.mockResolvedValueOnce(call('propose_report', { reading: { scope: 'report' }, title: 'Shop', pages: [{ name: 'Overview', widgets: [bar] }, { name: 'Countries', widgets: [bar] }] }));
    const res = await request(app).post(`/api/ai/reports/${reportId}/chat`).set('x-test-user', owner)
      .send({ messages: afterPageQuestion('The full report'), studio: true, pageContext: { pageWidth: 1140, pageHeight: 800, widgets: [] } });
    expect(res.status).toBe(200);
    expect(res.body.proposals[0].kind).toBe('report');
    expect(res.body.proposals[0].pages.map((p) => p.name)).toEqual(['Overview', 'Countries']);
    expect(providers.chat.mock.calls[0][0].tools.map((t) => t.name)).toContain('propose_report');
  });
});

describe('"Build the full report" pressed', () => {
  let owner, model;
  beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    owner = seedUser({ role: 'editor' });
    model = seedModel({ userId: owner, datasourceId: seedDatasource({ userId: owner }), dimensions: MODEL.dimensions, measures: MODEL.measures });
  });
  afterAll(() => { jest.restoreAllMocks(); });
  beforeEach(() => {
    providers.chat.mockReset();
    setAiConfig({ provider: 'openai-compat', baseUrl: 'http://llm.test/v1', model: 'm', enabled: true, dataSharing: 'schema' });
  });
  const bar = { type: 'bar', answers: 'comparison', title: 'By country', rationale: 'r', binding: { selectedDimensions: ['orders.country'], selectedMeasures: ['orders.amount_sum'] } };

  test('visuals are turned back whatever the model read; a report goes through; a question on the way is allowed', async () => {
    providers.chat
      .mockResolvedValueOnce(call('propose_widgets', { reading: { scope: 'view' }, widgets: [bar] }))
      .mockResolvedValueOnce(call('ask_user', { question: 'Which trade?', learn: { kind: 'domain' }, options: [{ label: 'E-commerce', value: 'ecommerce' }, { label: 'Retail', value: 'retail' }] }));
    const res = await request(app).post(`/api/ai/models/${model}/chat`).set('x-test-user', owner).send({ messages: [{ role: 'user', text: 'Build the full report' }], intent: 'report' });
    expect(res.body.proposals[0].kind).toBe('question');
    expect(providers.chat.mock.calls[1][0].messages.find((m) => m.role === 'tool').content).toMatch(/pressed .*Build the full report/);
    providers.chat.mockResolvedValueOnce(call('propose_report', { reading: { scope: 'report' }, title: 'Shop', pages: [{ name: 'Overview', widgets: [bar] }] }));
    const ok = await request(app).post(`/api/ai/models/${model}/chat`).set('x-test-user', owner).send({ messages: [{ role: 'user', text: 'Build the full report' }], intent: 'report' });
    expect(ok.body.proposals[0].kind).toBe('report');
  });
});

describe('a report attempt is not traded for visuals', () => {
  let owner, model;
  beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    owner = seedUser({ role: 'editor' });
    model = seedModel({ userId: owner, datasourceId: seedDatasource({ userId: owner }), dimensions: MODEL.dimensions, measures: MODEL.measures });
  });
  afterAll(() => { jest.restoreAllMocks(); });
  beforeEach(() => {
    providers.chat.mockReset();
    setAiConfig({ provider: 'openai-compat', baseUrl: 'http://llm.test/v1', model: 'm', enabled: true, dataSharing: 'schema' });
  });

  test('a mangled propose_report, then propose_widgets: both turned back, the retry lands', async () => {
    const bar = { type: 'bar', answers: 'comparison', title: 'By country', rationale: 'r', binding: { selectedDimensions: ['orders.country'], selectedMeasures: ['orders.amount_sum'] } };
    providers.chat
      .mockResolvedValueOnce({ text: '', toolCalls: [{ id: 'c1', name: 'propose_report', args: null, argsError: 'Invalid JSON in tool arguments' }], usage: null })
      .mockResolvedValueOnce(call('propose_widgets', { reading: { scope: 'view' }, widgets: [bar] }))
      .mockResolvedValueOnce(call('propose_report', { reading: { scope: 'report' }, title: 'Shop', pages: [{ name: 'Overview', widgets: [bar] }] }));
    const res = await request(app).post(`/api/ai/models/${model}/chat`).set('x-test-user', owner).send({ messages: afterPageQuestion('Un rapport sur les ventes') });
    expect(res.body.proposals[0].kind).toBe('report');
    const tools = providers.chat.mock.calls.map((c) => c[0].messages.filter((m) => m.role === 'tool').map((m) => m.content));
    expect(tools[1][0]).toMatch(/Call propose_report again with fewer pages/);
    expect(tools[2][1]).toMatch(/You were building a whole report/);
  });
});

describe('which pages: asked before any typed report', () => {
  let owner, model;
  beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    owner = seedUser({ role: 'editor' });
    model = seedModel({ userId: owner, datasourceId: seedDatasource({ userId: owner }), dimensions: MODEL.dimensions, measures: MODEL.measures });
  });
  afterAll(() => { jest.restoreAllMocks(); });
  beforeEach(() => {
    providers.chat.mockReset();
    setAiConfig({ provider: 'openai-compat', baseUrl: 'http://llm.test/v1', model: 'm', enabled: true, dataSharing: 'schema' });
  });

  test('a report proposed with no question asked is turned back; a multiple-choice question of pages goes through', async () => {
    const bar = { type: 'bar', answers: 'comparison', title: 'By country', rationale: 'r', binding: { selectedDimensions: ['orders.country'], selectedMeasures: ['orders.amount_sum'] } };
    providers.chat
      .mockResolvedValueOnce(call('propose_report', { reading: { scope: 'report' }, title: 'Shop', pages: [{ name: 'Overview', widgets: [bar] }] }))
      .mockResolvedValueOnce(call('ask_user', { question: 'Which pages?', multiple: true, options: [{ label: 'Sales overview' }, { label: 'Products' }, { label: 'Returns — needs a status column' }] }));
    const res = await request(app).post(`/api/ai/models/${model}/chat`).set('x-test-user', owner).send({ messages: [{ role: 'user', text: 'Un rapport sur les ventes' }] });
    expect(providers.chat.mock.calls[1][0].messages.find((m) => m.role === 'tool').content).toMatch(/ask the user which pages/);
    expect(res.body.proposals[0]).toMatchObject({ kind: 'question', multiple: true });
    expect(res.body.proposals[0].options).toHaveLength(3);
  });

  test('a column question cannot be multiple', () => {
    expect(validateQuestion({ question: 'x', multiple: true, learn: { kind: 'role', role: 'ecommerce.source' }, options: [{ label: 'a', value: 'orders.utm' }, { label: 'b', value: 'orders.country' }] }, { effective }).errors)
      .toEqual(['multiple: a column question takes one answer']);
  });
});
