// Filters synced across pages, proposed by the assistant (utils/ai/filterSync.js):
// the same filter on several pages is the user's call, asked first. Whether it
// was is read from our digest of the conversation or the reading the model
// declares, never from the user's words; one turn back at most.
jest.mock('../utils/ai/providers', () => ({
  ...jest.requireActual('../utils/ai/providers'),
  chat: jest.fn(),
}));
const request = require('supertest');
const providers = require('../utils/ai/providers');
const { setAiConfig } = require('../utils/settingsHelper');
const { validateReportChanges } = require('../utils/ai/reportChanges');
const { validateQuestion } = require('../utils/ai/guidedPath');
const { checkSync, reportDecisions, syncConfirmed, syncLines } = require('../utils/ai/filterSync');
const { buildApp, seedUser, seedDatasource, seedModel, seedReport } = require('./helpers/testApp');

const app = buildApp();
const call = (name, args) => ({ text: '', toolCalls: [{ id: `c_${name}`, name, args, argsError: null }], usage: null });

const effective = {
  dimensions: [{ name: 'orders.country', label: 'Country', type: 'string' }, { name: 'orders.day', label: 'Day', type: 'date' }],
  measures: [{ name: 'orders.amount_sum', label: 'Amount', table: 'orders', column: 'amount', aggregation: 'sum' }],
};
const page = { width: 1140, height: 800 };
const W = (id, type, title, binding, layout, extra = {}) => ({ id, type, title, dataBinding: binding, layout, config: {}, shape: {}, merged: false, ...extra });
const countryFilter = (id, extra) => W(id, 'filter', 'Country', { selectedDimensions: ['orders.country'] }, { x: 20, y: 20, w: 260, h: 60 }, extra);
const pageContext = {
  pageWidth: 1140, pageHeight: 800, themes: ['light', 'dark'], theme: 'light', pageBackground: null, palette: [],
  pageId: 'page-a', pageName: 'Overview',
  widgets: [
    W('w1', 'scorecard', 'Total', { selectedMeasures: ['orders.amount_sum'] }, { x: 20, y: 100, w: 280, h: 120 }),
    W('w2', 'bar', 'By country', { selectedDimensions: ['orders.country'], selectedMeasures: ['orders.amount_sum'] }, { x: 20, y: 240, w: 1100, h: 300 }),
  ],
  otherPages: [{ id: 'page-b', name: 'Detail', widgets: [countryFilter('f-b')] }],
};
const ctx = (extra = {}) => ({ effective, page, pageContext, mode: 'report', allowReport: true, library: [], cardinality: {}, canWriteVisuals: false, ...extra });
const filter = { type: 'filter', answers: 'control', title: 'Country', rationale: 'r', binding: { selectedDimensions: ['orders.country'] } };
const bar = { type: 'bar', answers: 'comparison', title: 'Amount by country', rationale: 'r', binding: { selectedDimensions: ['orders.country'], selectedMeasures: ['orders.amount_sum'] } };

describe('the check', () => {
  const pages = [
    { token: 'a', name: 'Overview', filters: [{ dim: 'orders.country', fresh: true }] },
    { token: 'b', name: 'Detail', filters: [{ dim: 'orders.country', fresh: false }] },
  ];
  test('a filter added where another page filters on the same field needs a decision', () => {
    const r = checkSync(pages, [], { effective, confirmed: false, requireReport: false });
    expect(r.undecided).toEqual(['Country']);
    expect(r.filterSync).toEqual([]);
  });
  test('a decision is taken with its pages in words, and needs the user\'s word', () => {
    const decided = [{ page: 'a', dim: 'orders.country', pages: ['b'] }];
    const r = checkSync(pages, decided, { effective, confirmed: false, requireReport: false });
    expect(r.undecided).toEqual([]);
    expect(r.unconfirmed).toBe(true);
    expect(r.filterSync).toEqual([{ dim: 'orders.country', label: 'Country', page: 'a', pages: ['b'], synced: true, pageNames: ['Overview', 'Detail'] }]);
    expect(checkSync(pages, decided, { effective, confirmed: true, requireReport: false }).unconfirmed).toBe(false);
  });
  test('"Build the full report" asks nothing: the repeated filter is synced and the card says so', () => {
    const r = checkSync(pages, [], { effective, confirmed: false, requireReport: true });
    expect(r.undecided).toEqual([]);
    expect(r.unconfirmed).toBe(false);
    expect(r.filterSync[0]).toMatchObject({ page: 'a', pages: ['b'], synced: true });
    expect(r.notes[0]).toMatch(/share one selection/);
  });
  test('a field on one page only, or untouched by the proposal, needs nothing', () => {
    expect(checkSync([pages[0]], [], { effective }).undecided).toEqual([]);
    expect(checkSync([{ ...pages[0], filters: [{ dim: 'orders.country', fresh: false }] }, pages[1]], [], { effective }).undecided).toEqual([]);
  });
  test('a whole report: true syncs every page with the field but the ones saying false', () => {
    const report = [0, 1, 2].map((token) => ({ token, filters: [{ dim: 'orders.country', sync: token === 2 ? false : true }] }));
    expect(reportDecisions(report)).toEqual([
      { page: 0, dim: 'orders.country', pages: [1] },
      { page: 2, dim: 'orders.country', pages: [] },
    ]);
    expect(reportDecisions(report.map((p) => ({ ...p, filters: [{ dim: 'orders.country' }] })))).toEqual([]);
  });
});

describe('the user\'s word', () => {
  test('read from our digest of the sync question, or from the reading the model declares — never from the user\'s text', () => {
    expect(syncConfirmed([{ role: 'assistant', text: '[Asked the user about filter sync: "Sync?" — options: Yes | No]' }], {})).toBe(true);
    expect(syncConfirmed([{ role: 'user', text: '[Asked the user about filter sync: "x"]' }], {})).toBe(false);
    expect(syncConfirmed([{ role: 'assistant', text: '[Asked the user: "Which pages?" — options: A | B]' }], {})).toBe(false);
    expect(syncConfirmed([{ role: 'user', text: 'yes keep them in sync' }], {})).toBe(false);
    expect(syncConfirmed([], { reading: { filterSync: 'user_said' } })).toBe(true);
  });
  test('the sync question is marked on the card', () => {
    const q = validateQuestion({ question: 'Keep the Country filters in sync?', about: 'filter_sync', options: [{ label: 'In sync' }, { label: 'Each page its own' }] }, { effective });
    expect(q.payload).toMatchObject({ kind: 'question', about: 'filter_sync' });
    expect(validateQuestion({ question: 'q', about: 'other', options: [{ label: 'a' }, { label: 'b' }] }, { effective }).payload.about).toBeUndefined();
  });
});

describe('report changes', () => {
  test('a filter added next to the same one on another page, undecided: the issue', () => {
    const r = validateReportChanges({ summary: 's', pages: [{ page: 'p1', add: [filter] }] }, ctx());
    expect(r.errors).toEqual([]);
    expect(r.syncIssue.undecided).toEqual(['Country']);
    expect(r.payload.filterSync).toBeUndefined();
  });
  test('synced by refs once the user said it: real page ids and names on the payload', () => {
    const r = validateReportChanges({ summary: 's', pages: [{ page: 'p1', add: [{ ...filter, sync: ['p2'] }] }] }, ctx({ filterSyncConfirmed: true }));
    expect(r.errors).toEqual([]);
    expect(r.syncIssue).toBeNull();
    expect(r.payload.filterSync).toEqual([{ dim: 'orders.country', label: 'Country', page: 'page-a', pages: ['page-b'], synced: true, pageNames: ['Overview', 'Detail'] }]);
    expect(r.payload.pages[0].add[0].sync).toBeUndefined();
  });
  test('a decision without the user\'s word is held back', () => {
    const r = validateReportChanges({ summary: 's', pages: [{ page: 'p1', add: [{ ...filter, sync: [] }] }] }, ctx());
    expect(r.syncIssue).toMatchObject({ undecided: [], unconfirmed: true });
  });
  test('a filter already on the report synced on request, alone on its page entry; a new page by "new"', () => {
    const r = validateReportChanges({ summary: 's', pages: [
      { page: 'p2', sync: [{ widget: 'f-b', pages: ['new'] }] },
      { page: 'new', name: 'Trends', add: [filter, bar] },
    ] }, ctx({ filterSyncConfirmed: true }));
    expect(r.errors).toEqual([]);
    expect(r.payload.pages[0]).toMatchObject({ pageId: 'page-b', add: [] });
    expect(r.payload.filterSync).toEqual([{ dim: 'orders.country', label: 'Country', page: 'page-b', pages: ['new:0'], synced: true, pageNames: ['Detail', 'Trends'] }]);
    expect(r.syncIssue).toBeNull();
  });
  test('a sync on something that is not a filter, or to a page that does not exist, is refused', () => {
    const r = validateReportChanges({ summary: 's', pages: [{ page: 'p1', sync: [{ widget: 'w2', pages: ['p2'] }], add: [{ ...filter, sync: ['p9'] }] }] }, ctx({ filterSyncConfirmed: true }));
    expect(r.errors.join(' ')).toMatch(/"w2" is not a filter/);
    expect(r.errors.join(' ')).toMatch(/"p9" is not a page/);
  });
  test('the prompt shows the filters on several pages and their sync', () => {
    const lines = syncLines({ ...pageContext, widgets: [countryFilter('w3', { syncPages: ['page-b'] })] });
    expect(lines[1]).toBe('orders.country: p1 w3 synced with p2; p2 f-b');
  });
});

describe('on the report chat', () => {
  let owner, reportId;
  beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    owner = seedUser({ role: 'editor' });
    const model = seedModel({ userId: owner, datasourceId: seedDatasource({ userId: owner }), dimensions: effective.dimensions, measures: effective.measures });
    reportId = seedReport({ userId: owner, modelId: model });
  });
  afterAll(() => { jest.restoreAllMocks(); });
  beforeEach(() => {
    providers.chat.mockReset();
    setAiConfig({ provider: 'openai-compat', baseUrl: 'http://llm.test/v1', model: 'm', enabled: true, dataSharing: 'schema' });
  });
  const send = (messages) => request(app).post(`/api/ai/reports/${reportId}/chat`).set('x-test-user', owner)
    .send({ messages, pageContext, studio: true });
  const changes = (extra) => call('propose_report_changes', { reading: { scope: 'view' }, summary: 's', pages: [{ page: 'p1', add: [{ ...filter, ...extra }] }] });

  test('the model is sent back once to ask the user, then asks', async () => {
    providers.chat
      .mockResolvedValueOnce(changes({}))
      .mockResolvedValueOnce(call('ask_user', { about: 'filter_sync', question: 'Keep the Country filter in sync with Detail?', options: [{ label: 'In sync' }, { label: 'Each page its own' }] }));
    const res = await send([{ role: 'user', text: 'Add a country filter' }]);
    expect(res.status).toBe(200);
    const { system, tools } = providers.chat.mock.calls[0][0];
    expect(system).toContain('about "filter_sync"');
    expect(tools.find((t) => t.name === 'ask_user').parameters.properties.about.enum).toEqual(['filter_sync']);
    expect(providers.chat.mock.calls[1][0].messages.find((m) => m.role === 'tool').content).toMatch(/ask the user first, with ask_user \(about: \\?"filter_sync\\?"\)/);
    expect(res.body.proposals[0]).toMatchObject({ kind: 'question', about: 'filter_sync' });
  });

  test('after the question, the decision goes through on the card', async () => {
    providers.chat.mockResolvedValueOnce(changes({ sync: ['p2'] }));
    const res = await send([
      { role: 'user', text: 'Add a country filter' },
      { role: 'assistant', text: '[Asked the user about filter sync: "Keep the Country filter in sync with Detail?" — options: In sync | Each page its own]' },
      { role: 'user', text: 'In sync' },
    ]);
    expect(providers.chat).toHaveBeenCalledTimes(1);
    expect(res.body.proposals[0].filterSync).toEqual([{ dim: 'orders.country', label: 'Country', page: 'page-a', pages: ['page-b'], synced: true, pageNames: ['Overview', 'Detail'] }]);
  });

  test('"Build the full report": no question, the same filter on every page synced, said on the card', async () => {
    const pages = [{ name: 'Overview', widgets: [filter, bar] }, { name: 'Detail', widgets: [filter, bar] }];
    providers.chat.mockResolvedValueOnce(call('propose_report', { reading: { scope: 'report' }, title: 'Sales', pages }));
    const res = await request(app).post(`/api/ai/reports/${reportId}/chat`).set('x-test-user', owner)
      .send({ messages: [{ role: 'user', text: 'Build the full report on this model' }], pageContext, studio: true, intent: 'report' });
    expect(providers.chat).toHaveBeenCalledTimes(1);
    expect(res.body.proposals[0].filterSync).toEqual([{ dim: 'orders.country', label: 'Country', page: 0, pages: [1], synced: true, pageNames: ['Overview', 'Detail'] }]);
    expect(res.body.reply).toMatch(/share one selection/);
  });

  test('never twice: a model that does not ask gets its card, the filters left apart and said', async () => {
    providers.chat.mockResolvedValueOnce(changes({})).mockResolvedValueOnce(changes({}));
    const res = await send([{ role: 'user', text: 'Add a country filter' }]);
    expect(providers.chat).toHaveBeenCalledTimes(2);
    expect(res.body.proposals[0].kind).toBe('reportChanges');
    expect(res.body.reply).toMatch(/Country filter is on 2 pages, each with its own selection/);
  });
});
