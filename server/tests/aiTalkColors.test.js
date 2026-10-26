// The colors of Let's Talk: Open Report's by default, computed for the dark or
// the light theme the user reads on; a theme of the user's own when they ask
// for other colors (a card they apply). A visual added to a report leaves them
// behind and takes the report's look.
jest.mock('../utils/ai/providers', () => ({
  ...jest.requireActual('../utils/ai/providers'),
  chat: jest.fn(),
}));
jest.mock('../utils/ai/cardinality', () => ({ dimensionCardinality: jest.fn() }));

const request = require('supertest');
const providers = require('../utils/ai/providers');
const { dimensionCardinality } = require('../utils/ai/cardinality');
const { setAiConfig } = require('../utils/settingsHelper');
const { harmonySeries, SURFACES } = require('../utils/ai/colorScheme');
const { OPEN_REPORT_BASE, cleanTalkTheme } = require('../utils/ai/talkTheme');
const { buildApp, seedUser, seedDatasource, seedModel, seedReport, db } = require('./helpers/testApp');

const app = buildApp();
const call = (name, args) => ({ text: '', toolCalls: [{ id: `c_${name}`, name, args, argsError: null }], usage: null });
const say = (text) => ({ text, toolCalls: [], usage: null });
const BAR = { type: 'bar', title: 'Amount by label', rationale: 'r', binding: { selectedDimensions: ['items.label'], selectedMeasures: ['items.amt_sum'] } };

describe("Let's Talk colors", () => {
  let owner, model;
  beforeAll(() => {
    owner = seedUser({ role: 'editor' });
    model = seedModel({ userId: owner, datasourceId: seedDatasource({ userId: owner }) });
  });
  beforeEach(() => {
    providers.chat.mockReset();
    dimensionCardinality.mockResolvedValue({});
    setAiConfig({ provider: 'openai-compat', baseUrl: 'http://llm.test/v1', model: 'm', enabled: true, dataSharing: 'schema+cache' });
    db.prepare('UPDATE users SET talk_theme = NULL WHERE id = ?').run(owner);
  });

  const talk = (body) => request(app).post(`/api/ai/models/${model}/chat`).set('x-test-user', owner)
    .send({ messages: [{ role: 'user', text: 'Amount by label' }], talk: true, ...body });

  test("Open Report's colors, for the light or the dark theme", async () => {
    providers.chat.mockResolvedValueOnce(call('propose_widgets', { widgets: [BAR] }));
    const light = (await talk({ theme: 'light' })).body.proposals[0];
    providers.chat.mockResolvedValueOnce(call('propose_widgets', { widgets: [BAR] }));
    const dark = (await talk({ theme: 'dark' })).body.proposals[0];
    expect(light.colors).toEqual({ base: OPEN_REPORT_BASE, harmony: 'categorical', theme: 'light' });
    expect(dark.colors.theme).toBe('dark');
    expect(light.widgets[0].config.color).toBe(harmonySeries('categorical', OPEN_REPORT_BASE, SURFACES.light)[0]);
    expect(dark.widgets[0].config.color).not.toBe(light.widgets[0].config.color);
  });

  test("asked for other colors: a card; applied, the user's theme colors the next answers and redraws the old ones", async () => {
    providers.chat.mockResolvedValueOnce(call('propose_action', { userAsked: 'do', action: 'talk_colors', base: '#16A34A', harmony: 'analogous', summary: 'Green charts' }));
    const [card] = (await talk({})).body.proposals;
    expect(card).toMatchObject({ kind: 'action', action: 'talk_colors', theme: { base: '#16a34a', harmony: 'analogous' } });
    expect(card.swatches).toHaveLength(6);

    const put = (theme) => request(app).put('/api/auth/me/talk-theme').set('x-test-user', owner).send({ theme });
    expect((await put({ base: 'green' })).status).toBe(400);
    expect((await put(card.theme)).body.talk_theme).toEqual(card.theme);
    const me = await request(app).get('/api/auth/me').set('x-test-user', owner);
    expect(me.body.user.talk_theme).toEqual(card.theme);

    providers.chat.mockResolvedValueOnce(call('propose_widgets', { widgets: [BAR] }));
    expect((await talk({})).body.proposals[0].colors).toMatchObject(card.theme);

    const old = { type: 'bar', config: { title: 'x', color: '#000000', palette: ['#000000'] }, dataBinding: BAR.binding };
    const redrawn = await request(app).post(`/api/ai/models/${model}/talk-colors`).set('x-test-user', owner).send({ theme: 'light', widgets: [old] });
    expect(redrawn.body.configs[0].title).toBe('x');
    expect(redrawn.body.configs[0].color).toBe(harmonySeries('analogous', '#16a34a', SURFACES.light)[0]);
    expect((await put(null)).body.talk_theme).toBeNull();
  });

  test('a theme is a #rrggbb base and a known rule, nothing else', () => {
    expect(cleanTalkTheme({ base: '#ABCDEF', harmony: 'nope' })).toEqual({ base: '#abcdef', harmony: 'categorical' });
    expect(cleanTalkTheme({ base: 'red' })).toBeNull();
    expect(cleanTalkTheme('not json')).toBeNull();
  });

  test("a visual added to a report takes the report's colors and fonts, not Let's Talk's", async () => {
    const palette = ['#112233', '#445566'];
    const look = { palette, labelFontFamily: 'Lora', titleFontFamily: 'Lora' };
    const chart = (id, type) => [id, { type, config: { title: id, ...look }, dataBinding: BAR.binding }];
    const report = seedReport({ userId: owner, modelId: model, settings: { pages: [{ id: 'p1', name: 'P', layout: [], widgets: Object.fromEntries([chart('a', 'line'), chart('b', 'pie')]) }] } });
    const sent = { type: 'bar', config: { title: 'From Talk', palette: ['#7c3aed'], color: '#7c3aed' }, dataBinding: BAR.binding };
    const res = await request(app).post(`/api/reports/${report}/widgets`).set('x-test-user', owner).send({ widgets: [sent] });
    expect(res.status).toBe(200);
    const row = JSON.parse(db.prepare('SELECT settings FROM reports WHERE id = ?').get(report).settings);
    const config = row.pages[0].widgets[res.body.widgetIds[0]].config;
    expect(config.palette).toEqual(palette);
    expect(config.color).toBeUndefined();
    expect(config.labelFontFamily).toBe('Lora');
    expect(config.titleFontFamily).toBe('Lora');
  });

  test('without a card asked, the chat answers in words', async () => {
    providers.chat.mockResolvedValueOnce(say('ok'));
    expect((await talk({})).body.reply).toBe('ok');
  });
});
