const request = require('supertest');
const { buildApp, seedUser, seedDatasource, seedModel, seedReport, seedWorkspace, db } = require('./helpers/testApp');

const app = buildApp();
const BAR = { type: 'bar', config: { title: 'Sales', subType: 'stacked', bundleUrl: 'http://evil' }, dataBinding: { selectedDimensions: ['items.label'], selectedMeasures: ['items.amt_sum'] } };

describe('adding widgets to a saved report', () => {
  let owner, wsEditor, wsViewer, stranger, model, report, ws;

  beforeAll(() => {
    owner = seedUser({ role: 'editor' });
    wsEditor = seedUser({ role: 'viewer' });
    wsViewer = seedUser({ role: 'viewer' });
    stranger = seedUser({ role: 'editor' });
    ws = seedWorkspace({ ownerId: owner });
    db.prepare('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?,?,?)').run(ws, wsEditor, 'editor');
    db.prepare('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?,?,?)').run(ws, wsViewer, 'viewer');
    model = seedModel({ userId: owner, datasourceId: seedDatasource({ userId: owner }) });
  });

  beforeEach(() => {
    report = seedReport({
      userId: owner,
      modelId: model,
      workspaceId: ws,
      settings: { theme: 'dark', extraMeasures: [], pages: [{ id: 'p1', name: 'Page 1', layout: [], widgets: {} }] },
    });
  });

  const add = (uid, body, id = report) => {
    const r = request(app).post(`/api/reports/${id}/widgets`);
    if (uid) r.set('x-test-user', uid);
    return r.send(body);
  };
  const saved = (id = report) => {
    const row = db.prepare('SELECT * FROM reports WHERE id = ?').get(id);
    return { settings: JSON.parse(row.settings), layout: JSON.parse(row.layout), widgets: JSON.parse(row.widgets) };
  };

  test('access: 401 anonymous, 404 for who cannot see it, 403 for a workspace viewer', async () => {
    expect((await add(null, { widgets: [BAR] })).status).toBe(401);
    expect((await add(stranger, { widgets: [BAR] })).status).toBe(404);
    expect((await add(wsViewer, { widgets: [BAR] })).status).toBe(403);
    expect(saved().settings.pages[0].layout).toEqual([]);
  });

  // Let's Talk defines measures with its visuals: the route compiles their
  // closed arguments again — what the browser sends is never SQL.
  test('measures sent with the visuals are compiled again and kept on the report', async () => {
    const measures = [{ label: 'Twice the amount', kind: 'arithmetic', op: 'add', left: 'items.amt_sum', right: 'items.amt_sum', expression: 'SUM(secret)' }];
    const widget = { ...BAR, dataBinding: { selectedDimensions: ['items.label'], selectedMeasures: ['_calc.twice_the_amount'] } };
    // Without its measure, the visual names a field the model does not have.
    expect((await add(wsEditor, { widgets: [widget] })).status).toBe(400);
    const res = await add(wsEditor, { widgets: [widget], measures });
    expect(res.status).toBe(200);
    const [m] = saved().settings.extraMeasures;
    expect(m).toMatchObject({ name: '_calc.twice_the_amount', aggregation: 'custom', expression: 'COALESCE((${items.amt_sum}), 0) + COALESCE((${items.amt_sum}), 0)' });

    const refused = await add(wsEditor, { widgets: [widget], measures: [{ label: 'X', kind: 'arithmetic', op: 'add', left: 'items.nope', right: 'items.amt_sum' }] });
    expect(refused.status).toBe(400);
  });

  test('the widget is rebuilt by the validator, placed by the server, and a version is kept', async () => {
    const res = await add(wsEditor, { widgets: [{ ...BAR, layout: { x: 9000, y: 9000, w: 5, h: 5 } }] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ reportId: report, pageId: 'p1', newPage: false });

    const { settings, layout, widgets } = saved();
    const [id] = res.body.widgetIds;
    expect(settings.theme).toBe('dark');
    expect(settings.pages[0].layout).toEqual([{ i: id, x: 20, y: 20, w: 560, h: 360, z: 1 }]);
    // Nothing of the config the browser sent survives but what the validator builds.
    expect(settings.pages[0].widgets[id].config).toEqual({ title: 'Sales', subType: 'stacked', showLegend: false, legendPosition: 'top', sortOrder: 'desc', valueAbbreviation: 'auto', showXAxisTitle: false, showYAxisTitle: false });
    // The measure has no format in the model: the report gets one (utils/ai/dress.js).
    expect(settings.measureOverrides['items.amt_sum'].format.decimals).toBe(0);
    expect(layout).toEqual(settings.pages[0].layout);
    expect(widgets).toEqual(settings.pages[0].widgets);
    expect(db.prepare('SELECT COUNT(*) AS n FROM report_versions WHERE report_id = ?').get(report).n).toBe(1);
  });

  // The column names the conversation gave a table ("Client" for raison_sociale)
  // were lost on the way to the report.
  test('a table keeps the names its columns were given, and only those of fields it shows', async () => {
    const TABLE = {
      type: 'table',
      config: { title: 'By label', tableConfig: { columns: { label: { displayName: 'Product' }, amt: { displayName: 'Amount' }, other: { displayName: 'Injected' } } } },
      dataBinding: { selectedDimensions: ['items.label'], selectedMeasures: ['items.amt_sum'] },
    };
    const res = await add(owner, { widgets: [TABLE] });
    expect(res.status).toBe(200);
    const { settings } = saved();
    const columns = settings.pages[0].widgets[res.body.widgetIds[0]].config.tableConfig.columns;
    expect(columns.label.displayName).toBe('Product');
    expect(columns.other).toBeUndefined();
    // The renamed measure's column look moves to the label it shows under.
    expect(columns.amt).toBeUndefined();
    expect(columns.Amount).toMatchObject({ values: { alignment: 'right' } });
    // A measure's name is its label in the whole report, as in the conversation.
    expect(settings.measureOverrides['items.amt_sum'].label).toBe('Amount');
  });

  test('filters, ranking and sort survive the rebuild; a forged filter is refused', async () => {
    const rules = [
      { field: 'items.amt_sum', isMeasure: true, op: 'top_n', value: 5, values: [] },
      { field: 'items.label', isMeasure: false, op: 'in', value: '', values: ['a', 'b'] },
    ];
    const shaped = { ...BAR, config: { ...BAR.config, sortOrder: 'desc' }, dataBinding: { ...BAR.dataBinding, widgetFilters: rules } };
    const res = await add(owner, { widgets: [shaped] });
    expect(res.status).toBe(200);
    const w = saved().widgets[res.body.widgetIds[0]];
    expect(w.dataBinding.widgetFilters).toEqual(rules);
    expect(w.config.sortOrder).toBe('desc');

    const forged = { ...BAR, dataBinding: { ...BAR.dataBinding, widgetFilters: [{ field: 'items.label', op: 'raw_sql', value: '1=1' }] } };
    expect((await add(owner, { widgets: [forged] })).status).toBe(400);
  });

  test('one unknown field refuses the whole request and writes nothing', async () => {
    const bad = { ...BAR, dataBinding: { selectedDimensions: ['items.nope'], selectedMeasures: ['items.amt_sum'] } };
    const res = await add(owner, { widgets: [BAR, bad] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cannot be added/);
    expect(saved().settings.pages[0].layout).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM report_versions WHERE report_id = ?').get(report).n).toBe(0);
    expect((await add(owner, { widgets: [] })).status).toBe(400);
  });

  // A crowded page: nothing written, a 409 the dialog turns into a choice.
  test('a crowded page answers 409 and writes nothing; the user then picks a new page or this one pressed', async () => {
    const grid = [];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) grid.push({ i: `w${r}${c}`, x: 20 + c * 280, y: 20 + r * 190, w: 260, h: 170 });
    const widgets = Object.fromEntries(grid.map((g) => [g.i, { type: 'bar', data: {}, dataBinding: BAR.dataBinding, config: {} }]));
    db.prepare('UPDATE reports SET settings = ? WHERE id = ?').run(JSON.stringify({ pages: [{ id: 'p1', name: 'Page 1', layout: grid, widgets }] }), report);
    const crowded = await add(owner, { widgets: [BAR] });
    expect(crowded.status).toBe(409);
    expect(crowded.body).toMatchObject({ crowded: true, count: 16 });
    expect(saved().settings.pages[0].layout).toHaveLength(16);
    expect(db.prepare('SELECT COUNT(*) AS n FROM report_versions WHERE report_id = ?').get(report).n).toBe(0);

    const fresh = await add(owner, { widgets: [BAR], mode: 'newPage' });
    expect(fresh.body.newPage).toBe(true);
    const pressed = await add(owner, { widgets: [BAR], mode: 'compress' });
    expect(pressed.status).toBe(200);
    expect(saved().settings.pages[0].layout).toHaveLength(17);
  });

  test('a set of visuals is laid out for the page of THIS report', async () => {
    db.prepare('UPDATE reports SET settings = ? WHERE id = ?').run(JSON.stringify({ pageWidth: 1600, pageHeight: 900 }), report);
    const PIE = { type: 'pie', config: { title: 'Share' }, dataBinding: BAR.dataBinding };
    const res = await add(owner, { widgets: [BAR, PIE] });
    expect(res.status).toBe(200);
    const boxes = saved().layout;
    expect(boxes).toHaveLength(2);
    expect(boxes[0].y).toBe(boxes[1].y);
    expect(boxes[1].x + boxes[1].w).toBe(1580);
  });

  test('GET /writable lists the reports of the model the caller may write, and no other', async () => {
    const list = (uid, q = `?modelId=${model}`) => request(app).get(`/api/reports/writable${q}`).set('x-test-user', uid);
    expect((await list(owner, '')).status).toBe(400);
    const mine = await list(wsEditor);
    expect(mine.status).toBe(200);
    expect(mine.body.reports.map((r) => r.id)).toContain(report);
    expect(mine.body.reports[0]).toEqual(expect.objectContaining({ title: expect.anything(), workspace_id: ws, pages: expect.any(Array) }));
    expect((await list(wsViewer)).body.reports).toEqual([]);
    expect((await list(stranger)).body.reports).toEqual([]);
  });
});
