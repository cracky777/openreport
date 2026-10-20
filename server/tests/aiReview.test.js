// The assistant shown its own work (asked by Jonathan: it should look at the
// whole page and say when what it did is bad). After a card is applied in the
// studio, the browser sends the page before and after as images; the turn's
// question is the server's, the images reach the provider for that turn only,
// and the assistant may take the change back (undo_change). Alongside: one
// widget placed next to another by the design tool, nothing else moving.
jest.mock('../utils/ai/providers', () => ({
  ...jest.requireActual('../utils/ai/providers'),
  chat: jest.fn(),
}));

const request = require('supertest');
const providers = require('../utils/ai/providers');
const { chat: realChat } = jest.requireActual('../utils/ai/providers');
const claudeSubscription = require('../utils/ai/providers/claudeSubscription');
const { setAiConfig } = require('../utils/settingsHelper');
const { validateDesignProposal } = require('../utils/ai/validateProposal');
const { buildApp, seedUser, seedDatasource, seedModel, seedReport } = require('./helpers/testApp');

const app = buildApp();
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const IMAGES = [{ mediaType: 'image/png', data: PNG }, { mediaType: 'image/jpeg', data: PNG }];
const say = (text) => ({ text, toolCalls: [], usage: null });
const call = (name, args) => ({ text: '', toolCalls: [{ id: `c_${name}`, name, args, argsError: null }], usage: null });
const PAGE = { pageWidth: 1140, pageHeight: 800, widgets: [] };
const toolNames = (req) => req.tools.map((t) => t.name);
// A review turn asks the outside eye first (utils/ai/critique.js, no tools), then the designer.
const designer = () => providers.chat.mock.calls.map((c) => c[0]).filter((r) => r.tools.length).pop();

describe('the review of an applied change', () => {
  let owner, report;
  beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    owner = seedUser({ role: 'editor' });
    const ds = seedDatasource({ userId: owner });
    const model = seedModel({ userId: owner, datasourceId: ds });
    report = seedReport({ userId: owner, modelId: model });
  });
  afterAll(() => { jest.restoreAllMocks(); });
  beforeEach(() => {
    providers.chat.mockReset();
    setAiConfig({ provider: 'openai-compat', baseUrl: 'http://llm.test/v1', model: 'm', enabled: true, dataSharing: 'schema' });
  });
  const post = (body) => request(app).post(`/api/ai/reports/${report}/chat`).set('x-test-user', owner).send(body);
  const studio = (extra) => ({ messages: [{ role: 'user', text: 'Review the change.' }], pageContext: PAGE, studio: true, ...extra });

  test('the images travel with the last message, the question is the server\'s, undo_change is offered', async () => {
    providers.chat.mockResolvedValueOnce(say('The titles are timid.')).mockResolvedValueOnce(say('Worse: the trend fell to the bottom.'));
    const res = await post(studio({ images: IMAGES, review: true }));
    expect(res.status).toBe(200);
    const sent = designer();
    const last = sent.messages[sent.messages.length - 1];
    expect(last.images).toEqual(IMAGES);
    expect(last.text).toMatch(/BEFORE \(first image\) and AFTER/);
    expect(last.text).toMatch(/would you sign it/);
    expect(last.text).not.toBe('Review the change.');
    expect(toolNames(sent)).toContain('undo_change');
    expect(res.body.reply).toBe('Worse: the trend fell to the bottom.');
  });

  test('a whole report just built: its first page goes to the designer for the look of every page', async () => {
    providers.chat.mockResolvedValueOnce(say('Teal and slate, Manrope, a title band.'));
    await post(studio({ messages: [{ role: 'user', text: 'Give the report its look.' }], images: IMAGES.slice(0, 1), review: true, reviewOf: 'report' }));
    const sent = providers.chat.mock.calls[0][0];
    const last = sent.messages[sent.messages.length - 1];
    expect(last.text).toMatch(/give the WHOLE report its look in one propose_design_changes/);
    expect(toolNames(sent)).toContain('propose_design_changes');
    // Any other value: the plain review of a new page.
    // The first look of a report judges defaults: no outside eye asked.
    expect(providers.chat).toHaveBeenCalledTimes(1);
    providers.chat.mockReset();
    providers.chat.mockResolvedValueOnce(say('fine')).mockResolvedValueOnce(say('ok'));
    await post(studio({ images: IMAGES.slice(0, 1), review: true, reviewOf: 'nope' }));
    const plain = designer();
    expect(plain.messages[plain.messages.length - 1].text).toMatch(/the page your change created/);
  });

  test('undo_change ends the turn as a card with the reason; outside a review it is refused', async () => {
    providers.chat.mockResolvedValueOnce(say('Broken.')).mockResolvedValueOnce(call('undo_change', { reason: 'The filters hide the chart.' }));
    const res = await post(studio({ images: IMAGES, review: true }));
    expect(res.body.proposals).toEqual([{ kind: 'undo', reason: 'The filters hide the chart.' }]);

    providers.chat.mockReset();
    providers.chat.mockResolvedValueOnce(call('undo_change', { reason: 'x' })).mockResolvedValueOnce(say('ok'));
    const plain = await post(studio());
    expect(plain.body.proposals).toEqual([]);
    const second = providers.chat.mock.calls[1][0];
    expect(second.messages.find((m) => m.role === 'tool').content).toMatch(/only for the review/);
    expect(toolNames(providers.chat.mock.calls[0][0])).not.toContain('undo_change');
  });

  test('images are the studio\'s only, three at most, images only, never silently dropped', async () => {
    providers.chat.mockResolvedValue(say('ok'));
    await post({ messages: [{ role: 'user', text: 'hi' }], pageContext: PAGE, images: IMAGES, review: true });
    expect(providers.chat.mock.calls[0][0].messages[0].images).toBeUndefined();
    expect(toolNames(providers.chat.mock.calls[0][0])).not.toContain('undo_change');
    expect((await post(studio({ images: [...IMAGES, ...IMAGES] }))).status).toBe(400);
    expect((await post(studio({ images: [{ mediaType: 'image/svg+xml', data: PNG }] }))).status).toBe(400);
    expect((await post(studio({ images: [{ mediaType: 'image/png', data: 'not base64!!' }] }))).status).toBe(400);
    expect((await post(studio({ images: 'x' }))).status).toBe(400);
  });
});

describe('images on the wire', () => {
  const fakeFetch = (json) => jest.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify(json) }));
  const messages = [{ role: 'user', text: 'first' }, { role: 'assistant', text: 'a card' }, { role: 'user', text: 'look', images: IMAGES }];

  test('openai-compat: a content array of the text and data URLs', async () => {
    const fetch = fakeFetch({ choices: [{ message: { content: 'ok' } }] });
    await realChat({ config: { provider: 'openai-compat', baseUrl: 'http://llm.test/v1', model: 'm' }, system: 'S', messages, tools: [] }, { fetch });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.messages[1]).toEqual({ role: 'user', content: 'first' });
    expect(body.messages[3].content).toEqual([
      { type: 'text', text: 'look' },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${PNG}` } },
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${PNG}` } },
    ]);
  });

  test('anthropic: image blocks then the text', async () => {
    const fetch = fakeFetch({ content: [{ type: 'text', text: 'ok' }] });
    await realChat({ config: { provider: 'anthropic', baseUrl: 'http://llm.test', model: 'm', apiKey: 'k' }, system: 'S', messages, tools: [] }, { fetch });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.messages[2].content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: PNG } },
      { type: 'text', text: 'look' },
    ]);
  });

  test('claude subscription: one user message of blocks, the transcript as its text; a string otherwise', async () => {
    expect(claudeSubscription.promptOf(messages.slice(0, 1))).toBe('first');
    const out = [];
    for await (const m of claudeSubscription.promptOf(messages)) out.push(m);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('user');
    expect(out[0].message.content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } });
    expect(out[0].message.content[2].text).toMatch(/User: first\nAssistant: a card\n\nUser: look$/);
  });
});

describe('design: one widget placed next to another', () => {
  const W = (id, type, title, layout) => ({ id, type, title, config: {}, shape: type === 'filter' ? { slicerStyle: 'dropdown' } : {}, dataBinding: {}, merged: false, layout, minSize: { w: 140, h: 60 } });
  const ctx = {
    page: { width: 1140, height: 800 },
    effective: { dimensions: [], measures: [] },
    pageContext: {
      themes: ['light'], theme: 'light',
      widgets: [
        W('w1', 'scorecard', 'Total', { x: 20, y: 20, w: 540, h: 200 }),
        W('w2', 'filter', 'Month', { x: 580, y: 20, w: 540, h: 200 }),
        W('w3', 'filter', 'Store', { x: 820, y: 240, w: 300, h: 120 }),
        W('w4', 'bar', 'By country', { x: 20, y: 380, w: 1100, h: 300 }),
      ],
    },
  };

  test('under a widget whose card has room: the card is split, the row it left closes, the rest stays', () => {
    const { ops, errors } = validateDesignProposal({ summary: 's', ops: [{ op: 'place', widgetId: 'w3', near: 'w2', side: 'below' }] }, ctx);
    expect(errors).toEqual([]);
    const moves = Object.fromEntries(ops.filter((o) => o.op === 'move').map((o) => [o.widgetId, o]));
    // The month filter gives the bottom of its card to the store filter.
    expect(moves.w2).toMatchObject({ x: 580, y: 20, w: 540 });
    expect(moves.w3).toMatchObject({ x: 580, w: 540 });
    expect(moves.w3.y).toBe(20 + moves.w2.h + 20);
    expect(moves.w3.y + moves.w3.h).toBeLessThanOrEqual(220);
    // Its old row, now empty, closed: the bar comes up by the row's height.
    expect(moves.w4).toMatchObject({ x: 20, y: 380 - 120 - 20, w: 1100, h: 300 });
    expect(moves.w1).toBeUndefined();
  });

  test('a place needs another widget of this page and a side; it is dropped out of a layout reading', () => {
    const bad = validateDesignProposal({ summary: 's', ops: [{ op: 'place', widgetId: 'w3', near: 'w9', side: 'below' }, { op: 'place', widgetId: 'w3', near: 'w2', side: 'inside' }] }, ctx);
    expect(bad.ops).toEqual([]);
    expect(bad.errors).toEqual([expect.stringMatching(/near/), expect.stringMatching(/side/)]);
    const narrow = validateDesignProposal({ summary: 's', ops: [{ op: 'place', widgetId: 'w3', near: 'w2', side: 'below' }] }, { ...ctx, scope: { layout: false, scheme: true, theme: true } });
    expect(narrow.ops).toEqual([]);
  });
});

// A logo the user added, its colors read by the browser: once it is on the
// page, the review turn asks for a design card in those colors (asked by
// Jonathan: the report in the brand's colors, validated by the user).
describe('the colors of a logo the user added', () => {
  let owner, report;
  beforeAll(() => {
    owner = seedUser({ role: 'editor' });
    report = seedReport({ userId: owner, modelId: seedModel({ userId: owner, datasourceId: seedDatasource({ userId: owner }) }) });
  });
  beforeEach(() => {
    providers.chat.mockReset();
    providers.chat.mockResolvedValue(say('ok'));
    setAiConfig({ provider: 'openai-compat', baseUrl: 'http://llm.test/v1', model: 'm', enabled: true, dataSharing: 'schema' });
  });
  const LOGO = { name: 'logo.png', url: '/uploads/images/abc123.png', colors: ['#F28C28', '#1E2A44', 'red', '#12345', '#ABCDEF', '#000000'] };
  const withLogo = { pageWidth: 1140, pageHeight: 800, widgets: [{ id: 'w1', type: 'image', title: '', dataBinding: {}, layout: { x: 20, y: 20, w: 160, h: 60 } }] };
  const post = (body) => request(app).post(`/api/ai/reports/${report}/chat`).set('x-test-user', owner)
    .send({ messages: [{ role: 'user', text: 'Review the change.' }], studio: true, assets: [LOGO], ...body });
  const lastText = () => { const sent = designer(); return sent.messages[sent.messages.length - 1].text; };

  test('on the page, the review asks for a design card in its colors — only valid #rrggbb, three at most', async () => {
    await post({ pageContext: withLogo, images: IMAGES, review: true });
    expect(lastText()).toMatch(/logo\.png: #F28C28, #1E2A44, #ABCDEF\. .*propose_design_changes with the report's whole look/);
    expect(lastText()).not.toMatch(/, red|#12345\b|#000000/);
    expect(designer().system).toMatch(/logo\.png \(its colors: #F28C28, #1E2A44, #ABCDEF\)/);
  });

  test('not on the page yet, or not a review: no card asked for', async () => {
    await post({ pageContext: PAGE, images: IMAGES, review: true });
    expect(lastText()).not.toMatch(/propose_design_changes with the report's whole look/);
    providers.chat.mockClear();
    await post({ pageContext: withLogo });
    expect(lastText()).toBe('Review the change.');
  });
});

test('a digest of the history echoed in an answer is taken out of it', async () => {
  const owner = seedUser({ role: 'editor' });
  const report = seedReport({ userId: owner, modelId: seedModel({ userId: owner, datasourceId: seedDatasource({ userId: owner }) }) });
  setAiConfig({ provider: 'openai-compat', baseUrl: 'http://llm.test/v1', model: 'm', enabled: true, dataSharing: 'schema' });
  providers.chat.mockReset();
  providers.chat.mockResolvedValueOnce(say('Voici les pages.\n[Asked the user: Quelles pages ?]\nChoisissez.'));
  const res = await request(app).post(`/api/ai/reports/${report}/chat`).set('x-test-user', owner)
    .send({ messages: [{ role: 'user', text: 'Un rapport' }], pageContext: PAGE });
  expect(res.body.reply).toBe('Voici les pages.\n\nChoisissez.');
});

// Asked by Jonathan: what the designer says comes before the rules.
test('the designer\'s principles come first, and no rule tells it to hold back on the look', async () => {
  const owner = seedUser({ role: 'editor' });
  const report = seedReport({ userId: owner, modelId: seedModel({ userId: owner, datasourceId: seedDatasource({ userId: owner }) }) });
  setAiConfig({ provider: 'openai-compat', baseUrl: 'http://llm.test/v1', model: 'm', enabled: true, dataSharing: 'schema' });
  providers.chat.mockReset();
  providers.chat.mockResolvedValueOnce(say('ok'));
  await request(app).post(`/api/ai/reports/${report}/chat`).set('x-test-user', owner)
    .send({ messages: [{ role: 'user', text: 'Rends la page plus belle' }], pageContext: PAGE });
  const system = providers.chat.mock.calls[0][0].system;
  const designer = system.indexOf('You are a senior UI/UX designer of dashboards. Your principles come FIRST');
  expect(designer).toBeGreaterThan(-1);
  for (const rule of ['Color, for the whole page:', 'Color, key by key:', '- The layout is yours.']) expect(system.indexOf(rule)).toBeGreaterThan(designer);
  expect(system).not.toMatch(/leave alone what works|only for a deliberate exception|and only what was asked for|— and nothing else/);
});

// The designer judging its own work found it fine every time; an outside eye
// that did not make the page looks first, and the designer weighs what it says.
describe('the outside eye of a review', () => {
  let owner, report;
  beforeAll(() => {
    owner = seedUser({ role: 'editor' });
    report = seedReport({ userId: owner, modelId: seedModel({ userId: owner, datasourceId: seedDatasource({ userId: owner }) }) });
  });
  beforeEach(() => {
    providers.chat.mockReset();
    setAiConfig({ provider: 'openai-compat', baseUrl: 'http://llm.test/v1', model: 'm', enabled: true, dataSharing: 'schema' });
  });
  const post = (body) => request(app).post(`/api/ai/reports/${report}/chat`).set('x-test-user', owner)
    .send({ messages: [{ role: 'user', text: 'Review the change.' }], pageContext: PAGE, studio: true, review: true, ...body });

  test('sees the page after the change only, with no tools and no conversation; its words reach the designer', async () => {
    providers.chat.mockResolvedValueOnce(say('Every title is 14 px semibold on the left: it could be any dashboard.')).mockResolvedValueOnce(say('ok'));
    await post({ images: IMAGES });
    const critic = providers.chat.mock.calls[0][0];
    expect(critic.tools).toEqual([]);
    expect(critic.messages).toHaveLength(1);
    expect(critic.messages[0].images).toEqual([IMAGES[1]]);
    expect(critic.system).toMatch(/did not make it/);
    const last = designer().messages.slice(-1)[0].text;
    expect(last).toMatch(/An outside art director.*it could be any dashboard.*Weigh it with your own eye/);
  });

  test('every page in small travels last when the change reached several; both the eye and the designer are told', async () => {
    const SHEET = [...IMAGES, { mediaType: 'image/jpeg', data: PNG }];
    providers.chat.mockResolvedValueOnce(say('The pages repeat one another.')).mockResolvedValueOnce(say('ok'));
    await post({ images: SHEET, reviewSheet: true });
    const critic = providers.chat.mock.calls[0][0];
    expect(critic.messages[0].images).toEqual([SHEET[1], SHEET[2]]);
    expect(critic.messages[0].text).toMatch(/every page of the report in small/);
    const last = designer().messages.slice(-1)[0].text;
    expect(last).toMatch(/BEFORE \(first image\) and AFTER/);
    expect(last).toMatch(/The LAST picture shows every page/);
  });

  test('an eye that fails leaves the designer to review alone', async () => {
    providers.chat.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce(say('ok'));
    const res = await post({ images: IMAGES });
    expect(res.status).toBe(200);
    expect(designer().messages.slice(-1)[0].text).not.toMatch(/outside art director/);
  });
});

describe('reviews that settle', () => {
  let owner, report;
  beforeAll(() => {
    owner = seedUser({ role: 'editor' });
    report = seedReport({ userId: owner, modelId: seedModel({ userId: owner, datasourceId: seedDatasource({ userId: owner }) }) });
  });
  beforeEach(() => {
    providers.chat.mockReset();
    providers.chat.mockResolvedValue(say('ok'));
    setAiConfig({ provider: 'openai-compat', baseUrl: 'http://llm.test/v1', model: 'm', enabled: true, dataSharing: 'schema' });
  });
  const SHOWN = '[You were shown the page before and after the change you proposed, and asked to review it]';
  const post = (history) => request(app).post(`/api/ai/reports/${report}/chat`).set('x-test-user', owner)
    .send({ messages: [{ role: 'user', text: 'Relis le design.' }, ...history, { role: 'user', text: 'Review the change.' }], pageContext: PAGE, studio: true, review: true, images: IMAGES });

  test('after two rounds of polish, no outside eye and only what is broken', async () => {
    await post([{ role: 'assistant', text: 'card' }, { role: 'user', text: SHOWN }, { role: 'assistant', text: 'card' }]);
    expect(providers.chat).toHaveBeenCalledTimes(2);
    providers.chat.mockClear();
    await post([{ role: 'assistant', text: 'card' }, { role: 'user', text: SHOWN }, { role: 'assistant', text: 'card' }, { role: 'user', text: SHOWN }, { role: 'assistant', text: 'card' }]);
    expect(providers.chat).toHaveBeenCalledTimes(1);
    const last = designer().messages.slice(-1)[0].text;
    expect(last).toMatch(/review 3 in a row/);
    expect(last).toMatch(/Never reverse a choice/);
  });
});
