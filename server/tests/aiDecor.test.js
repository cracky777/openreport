// The page's dressing in the assistant's hands (asked by Jonathan: shapes,
// texts, logos for a report that looks finished, the image added from the
// chat): a text with its content, a shape as a band or a divider, an image
// only by the name of one the user added — never a URL of the model's.
jest.mock('../utils/ai/providers', () => ({
  ...jest.requireActual('../utils/ai/providers'),
  chat: jest.fn(),
}));

const request = require('supertest');
const providers = require('../utils/ai/providers');
const { setAiConfig } = require('../utils/settingsHelper');
const { validateWidgetsProposal } = require('../utils/ai/validateProposal');
const { validateReportChanges } = require('../utils/ai/reportChanges');
const { widgetsToolFor, reportChangesToolFor } = require('../utils/ai/tools');
const { buildApp, seedUser, seedDatasource, seedModel, seedReport } = require('./helpers/testApp');

const effective = {
  dimensions: [{ name: 'orders.country', label: 'Country', type: 'string' }],
  measures: [{ name: 'orders.amount_sum', label: 'Amount', table: 'orders', column: 'amount', aggregation: 'sum' }],
};
const page = { width: 1140, height: 800 };
const pageContext = { pageWidth: 1140, pageHeight: 800, themes: ['light'], theme: 'light', widgets: [] };
const ASSETS = [{ name: 'logo.png', url: '/uploads/images/abc123.png' }];
const ctx = { effective, page, pageContext, mode: 'visuals', library: [], cardinality: {}, assets: ASSETS };
const decor = (w) => ({ answers: 'decor', title: '', rationale: 'r', binding: {}, ...w });

test('a text carries its content as the editor stores it, a shape its look, an image the url of the asset it names', () => {
  const r = validateWidgetsProposal({ widgets: [
    decor({ type: 'text', text: 'Logistics overview', style: { fontSize: 22, bold: true, color: '#1D4ED8', align: 'left' }, layout: { x: 20, y: 20, w: 1100, h: 60 } }),
    decor({ type: 'shape', shape: 'line', fill: '#CCCCCC', thickness: 1, layout: { x: 20, y: 100, w: 1100, h: 12 } }),
    decor({ type: 'shape', shape: 'rectangle', fill: '#1D4ED8', opacity: 10, layout: { x: 20, y: 120, w: 540, h: 300 } }),
    decor({ type: 'image', image: 'logo.png', fit: 'contain', title: 'Company logo', layout: { x: 960, y: 20, w: 160, h: 60 } }),
  ] }, ctx);
  expect(r.errors).toEqual([]);
  const [title, line, band, logo] = r.widgets;
  expect(title).toMatchObject({ type: 'text', dataBinding: {}, config: { textAlign: 'left', fontSize: 22, bold: true, color: '#1D4ED8' }, data: { text: 'Logistics overview', runs: [{ text: 'Logistics overview' }] }, layout: { x: 20, y: 20, w: 1100, h: 60 } });
  expect(title.config.title).toBeUndefined();
  expect(line).toMatchObject({ type: 'shape', config: { shape: 'line', lineColor: '#CCCCCC', lineThickness: 1 }, layout: { h: 20 } });
  expect(band).toMatchObject({ type: 'shape', config: { shape: 'square', shapeFill: '#1D4ED8', shapeOpacity: 10, shapeStrokeWidth: 0 } });
  expect(logo).toMatchObject({ type: 'image', config: { url: '/uploads/images/abc123.png', fit: 'contain', alt: 'Company logo' } });
});

test('what is refused: a text with nothing to say, a shape of another kind, an image by url or by a name the user never added', () => {
  const r = validateWidgetsProposal({ widgets: [
    decor({ type: 'text', text: '  ' }),
    decor({ type: 'shape', shape: 'star' }),
    decor({ type: 'image', image: 'https://evil.test/x.png' }),
    decor({ type: 'image', image: 'other.png' }),
  ] }, ctx);
  expect(r.widgets).toEqual([]);
  expect(r.errors).toEqual([
    expect.stringMatching(/Widget 1: a text needs `text`/),
    expect.stringMatching(/Widget 2: a shape is a rectangle or a line/),
    expect.stringMatching(/Widget 3: an image is one the user added, by name: logo.png/),
    expect.stringMatching(/Widget 4: an image is one the user added/),
  ]);
  const none = validateWidgetsProposal({ widgets: [decor({ type: 'image', image: 'logo.png' })] }, { ...ctx, assets: [] });
  expect(none.errors[0]).toMatch(/none was added to this conversation/);
});

test('the tool offers the dressing only where there is a page, and an image only once one was added', () => {
  const props = (tool) => tool.parameters.properties.widgets.items.properties;
  const editor = props(widgetsToolFor({ assets: ASSETS }));
  expect(editor.type.enum).toEqual(expect.arrayContaining(['text', 'shape', 'image']));
  expect(editor.image.enum).toEqual(['logo.png']);
  expect(editor.answers.enum).toContain('decor');
  const noImage = props(widgetsToolFor({}));
  expect(noImage.type.enum).toContain('shape');
  expect(noImage.type.enum).not.toContain('image');
  expect(noImage.image).toBeUndefined();
  const ask = props(widgetsToolFor({ withLayout: false, decor: false }));
  expect(ask.type.enum).not.toContain('text');
  expect(ask.text).toBeUndefined();
  expect(ask.answers.enum).not.toContain('decor');
  // An addition to a page may carry its own box.
  const add = reportChangesToolFor({ assets: ASSETS }).parameters.properties.pages.items.properties.add.items.properties;
  expect(add.layout).toBeDefined();
  expect(add.image.enum).toEqual(['logo.png']);
});

test('added to a page with its own box, the dressing is kept exactly there; a visual without a box is set into the page', () => {
  const W = (id, type, title, binding, layout) => ({ id, type, title, dataBinding: binding, layout, config: {}, shape: {}, merged: false });
  const withPage = { ...ctx, allowReport: true, pageContext: { ...pageContext, pageId: 'p', pageName: 'Overview', widgets: [
    W('w1', 'bar', 'By country', { selectedDimensions: ['orders.country'], selectedMeasures: ['orders.amount_sum'] }, { x: 20, y: 100, w: 1100, h: 300 }),
  ] } };
  const r = validateReportChanges({ summary: 's', pages: [{ page: 'p1', add: [
    decor({ type: 'text', text: 'Sales', layout: { x: 20, y: 20, w: 1100, h: 60 } }),
    { type: 'scorecard', answers: 'figure', title: 'Total', rationale: 'r', binding: { selectedMeasures: ['orders.amount_sum'] } },
  ] }] }, withPage);
  expect(r.errors).toEqual([]);
  const [band, figure] = r.payload.pages[0].add;
  expect(band.layout).toEqual({ x: 20, y: 20, w: 1100, h: 60 });
  expect(band.data.text).toBe('Sales');
  // The figure, placeless, lands under everything; the bar did not move.
  expect(figure.layout.y).toBeGreaterThanOrEqual(420);
  expect(r.payload.pages[0].moves).toEqual([]);
});

test('no image yet: the assistant may hand over a card to drop one on, in the editor and the studio, not in Ask', () => {
  const { validateActionProposal, ACTIONS_FOR } = require('../utils/ai/actions');
  const card = validateActionProposal({ userAsked: 'do', action: 'add_image', summary: 'Drop your logo here.', request: 'Put the logo top left' }, { allowed: ACTIONS_FOR.editor });
  expect(card.errors).toEqual([]);
  expect(card.action).toEqual({ action: 'add_image', summary: 'Drop your logo here.', request: 'Put the logo top left' });
  // A card that only takes a drop goes with an explanation too.
  expect(validateActionProposal({ userAsked: 'how', action: 'add_image', summary: 's' }, { allowed: ACTIONS_FOR.editor }).action).toMatchObject({ action: 'add_image' });
  expect(validateActionProposal({ userAsked: 'do', action: 'add_image', summary: 's' }, { allowed: ACTIONS_FOR.ask }).action).toBeNull();
});

describe('the images of a conversation reach the assistant by name', () => {
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

  test('named in the prompt and the tool; a url outside the upload folder is dropped', async () => {
    providers.chat.mockResolvedValueOnce({ text: 'ok', toolCalls: [], usage: null });
    const app = buildApp();
    const res = await request(app).post(`/api/ai/reports/${report}/chat`).set('x-test-user', owner).send({
      messages: [{ role: 'user', text: 'Put the logo top left' }],
      pageContext,
      assets: [...ASSETS, { name: 'evil.png', url: 'https://evil.test/x.png' }, { name: 'bad', url: '/uploads/images/../../etc/passwd' }],
    });
    expect(res.status).toBe(200);
    const sent = providers.chat.mock.calls[0][0];
    expect(sent.system).toContain('Images the user added to this conversation (type image, by name): logo.png.');
    expect(sent.system).not.toContain('evil');
    const widgets = sent.tools.find((t) => t.name === 'propose_widgets');
    expect(widgets.parameters.properties.widgets.items.properties.image.enum).toEqual(['logo.png']);
  });
});
