jest.mock('../utils/ai/providers', () => ({
  ...jest.requireActual('../utils/ai/providers'),
  chat: jest.fn(),
}));

const request = require('supertest');
const providers = require('../utils/ai/providers');
const { setAiConfig } = require('../utils/settingsHelper');
const { buildApp, seedUser, seedDatasource, seedModel, seedReport, seedWorkspace, seedRollup, db } = require('./helpers/testApp');

const app = buildApp();
const say = (text) => ({ text, toolCalls: [], usage: null });
const call = (name, args) => ({ text: '', toolCalls: [{ id: `c_${name}`, name, args, argsError: null }], usage: null });
const ask = (text, extra = {}) => ({ messages: [{ role: 'user', text }], ...extra });
const fields = { selectedDimensions: ['items.label'], selectedMeasures: ['items.amt_sum'] };
const toolResult = (n = 1) => providers.chat.mock.calls[n][0].messages.find((m) => m.role === 'tool').content;

const VISUAL_JS = 'OpenReportRegisterVisual({ render: function (el, ctx) { el.textContent = ctx.data.rows.length; } });';
const MANIFEST = { id: 'funnel', name: 'Funnel', dataSchema: { dimensions: [{ role: 'stage', label: 'Stage' }], measures: [{ role: 'value', label: 'Value' }] } };

function install(wsId, userId, id, name, description) {
  const manifest = { id, name, version: '1.0.0', description, dataSchema: MANIFEST.dataSchema };
  db.prepare('INSERT INTO custom_visuals (workspace_id, visual_id, name, version, manifest, bundle, uploaded_by, origin) VALUES (?,?,?,?,?,?,?,?)')
    .run(wsId, id, name, '1.0.0', JSON.stringify(manifest), VISUAL_JS, userId, 'upload');
}

describe('the workspace library, in both assistants', () => {
  let admin, member, stranger, model, ws, otherWs, report;

  beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    admin = seedUser({ role: 'editor' });
    member = seedUser({ role: 'viewer' });
    stranger = seedUser({ role: 'editor' });
    ws = seedWorkspace({ ownerId: admin });
    otherWs = seedWorkspace({ ownerId: stranger });
    db.prepare('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?,?,?)').run(ws, member, 'editor');
    model = seedModel({ userId: admin, datasourceId: seedDatasource({ userId: admin }) });
    seedRollup({ modelId: model });
    report = seedReport({ userId: admin, modelId: model, workspaceId: ws });
    install(ws, admin, 'funnel', 'Funnel', 'Conversion between stages');
    install(otherWs, stranger, 'sankey', 'Sankey', 'Flows');
  });
  afterAll(() => { jest.restoreAllMocks(); });

  beforeEach(() => {
    providers.chat.mockReset();
    setAiConfig({ provider: 'openai-compat', baseUrl: 'http://llm.test/v1', model: 'm', enabled: true, dataSharing: 'schema' });
  });

  const askChat = (uid, body) => request(app).post(`/api/ai/models/${model}/chat`).set('x-test-user', uid).send(body);
  const editorChat = (uid, body) => request(app).post(`/api/ai/reports/${report}/chat`).set('x-test-user', uid)
    .send({ pageContext: { pageWidth: 1140, pageHeight: 800, widgets: [] }, ...body });
  const toolsOf = (n = 0) => providers.chat.mock.calls[n][0].tools;
  const widgetTool = (n = 0) => toolsOf(n).find((t) => t.name === 'propose_widgets').parameters.properties.widgets.items.properties;

  test('Ask: a workspace member sees its library, as a type with a closed list of ids', async () => {
    providers.chat.mockResolvedValueOnce(say('ok'));
    await askChat(member, ask('a funnel of sales', { workspaceId: ws }));
    const { system } = providers.chat.mock.calls[0][0];
    expect(system).toContain('Workspace library');
    expect(system).toContain('"funnel": "Funnel" — "Conversion between stages"');
    expect(system).not.toContain('Sankey');
    expect(widgetTool().type.enum).toContain('customVisual');
    expect(widgetTool().visualId.enum).toEqual(['funnel']);
    // A member places what is installed; only an admin has code written.
    expect(toolsOf().map((t) => t.name)).not.toContain('propose_custom_visual');
  });

  test('Ask: no workspace, no library; someone else\'s workspace is a 403', async () => {
    providers.chat.mockResolvedValueOnce(say('ok'));
    await askChat(member, ask('sales'));
    expect(widgetTool().type.enum).not.toContain('customVisual');
    expect(widgetTool().visualId).toBeUndefined();
    expect((await askChat(member, ask('sales', { workspaceId: otherWs }))).status).toBe(403);
  });

  test('a library visual is pointed at by the server, from the library row', async () => {
    providers.chat.mockResolvedValueOnce(call('propose_widgets', { widgets: [{
      type: 'customVisual', visualId: 'funnel', title: 'Sales funnel', rationale: 'r', binding: fields,
      config: { bundleUrl: 'http://evil.invalid/x.js' },
    }] }));
    const res = await askChat(member, ask('a funnel of sales', { workspaceId: ws }));
    const [w] = res.body.proposals[0].widgets;
    expect(w.type).toBe('customVisual');
    expect(w.config).toMatchObject({ title: 'Sales funnel', visualId: 'funnel', visualName: 'Funnel', bundleUrl: `/api/workspaces/${ws}/visuals/funnel/bundle.js` });
    expect(w.config.manifest.dataSchema).toEqual(MANIFEST.dataSchema);
    expect(w.dataBinding).toEqual(fields);
    expect(w.layout).toEqual(expect.objectContaining({ x: 20, y: 20 }));
  });

  test('an id that is not in THIS library goes back for repair', async () => {
    providers.chat
      .mockResolvedValueOnce(call('propose_widgets', { widgets: [{ type: 'customVisual', visualId: 'sankey', title: 'S', rationale: 'r', binding: fields }] }))
      .mockResolvedValueOnce(say('ok'));
    const res = await askChat(member, ask('flows', { workspaceId: ws }));
    expect(toolResult()).toMatch(/visualId must be one of the workspace library: funnel/);
    expect(res.body.proposals).toEqual([]);
  });

  test('Ask: an admin of the workspace may have a new visual written, sized by the server', async () => {
    providers.chat.mockResolvedValueOnce(call('propose_custom_visual', {
      manifest: { id: 'radial', name: 'Radial bars', dataSchema: MANIFEST.dataSchema },
      visualJs: VISUAL_JS,
      binding: fields,
      layout: { x: 900, y: 900, w: 10, h: 10 },
      rationale: 'No built-in type draws radial bars.',
    }));
    const res = await askChat(admin, ask('a radial bar chart of sales by label', { workspaceId: ws }));
    expect(toolsOf().map((t) => t.name)).toContain('propose_custom_visual');
    const [proposal] = res.body.proposals;
    expect(proposal.kind).toBe('customVisual');
    expect(proposal.layout).toEqual({ x: 20, y: 20, w: 560, h: 360 });
  });

  test('Ask: a member who is not its admin is refused the tool even if the model calls it', async () => {
    providers.chat
      .mockResolvedValueOnce(call('propose_custom_visual', { manifest: MANIFEST, visualJs: VISUAL_JS, binding: fields, rationale: 'r' }))
      .mockResolvedValueOnce(say('An admin of the workspace can create it.'));
    const res = await askChat(member, ask('a radial bar chart', { workspaceId: ws }));
    expect(toolResult()).toMatch(/needs a workspace admin/);
    expect(res.body.proposals).toEqual([]);
  });

  test('the editor offers the library of the report\'s workspace', async () => {
    providers.chat.mockResolvedValueOnce(say('ok'));
    await editorChat(member, { messages: [{ role: 'user', text: 'a funnel' }] });
    expect(widgetTool().visualId.enum).toEqual(['funnel']);
    expect(widgetTool().layout).toBeDefined();
  });

  test('adding to a report: a library visual of that report\'s workspace goes in, another workspace\'s does not', async () => {
    const add = (visualId) => request(app).post(`/api/reports/${report}/widgets`).set('x-test-user', member)
      .send({ widgets: [{ type: 'customVisual', config: { title: 'F', visualId, bundleUrl: 'http://evil.invalid/x.js' }, dataBinding: fields }] });

    const ok = await add('funnel');
    expect(ok.status).toBe(200);
    const row = db.prepare('SELECT widgets FROM reports WHERE id = ?').get(report);
    const saved = JSON.parse(row.widgets)[ok.body.widgetIds[0]];
    expect(saved.config.bundleUrl).toBe(`/api/workspaces/${ws}/visuals/funnel/bundle.js`);

    const refused = await add('sankey');
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatch(/workspace library/);
  });
});
