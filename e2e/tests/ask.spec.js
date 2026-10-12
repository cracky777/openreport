// The Assistant panel, end to end against a scripted provider: from the panel on
// the right of the journey to a visual saved in a new report.
//
// What only a running system shows: the conversation has NO report, and the
// assistant's cache read still goes through the real /query over loopback —
// the seed has no rollup, so it must come back as a miss, never as rows from
// the source. And the visual is written by the server (POST /reports/:id/widgets),
// so it has to be there when the editor opens the report, and after a reload.
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const F = require('../fixtures');

const ids = () => JSON.parse(fs.readFileSync(F.IDS_FILE, 'utf8'));
const TITLE = 'Sales by country (asked)';
const ROWS = { rows: [{ [F.DIM_LABEL]: 'FR', [F.MEASURE_LABEL]: 1 }, { [F.DIM_LABEL]: 'DE', [F.MEASURE_LABEL]: 2 }], rowCount: 2 };

function askScript(body) {
  const toolTurns = body.messages.filter((m) => m.role === 'tool').length;
  if (toolTurns === 0) return { name: 'query_cached_data', arguments: { dimensions: [F.DIM], measures: [F.MEASURE], reportId: 'not-yours' } };
  return {
    name: 'propose_widgets',
    arguments: {
      widgets: [{
        type: 'bar',
        title: TITLE,
        rationale: 'Ranks countries by sales.',
        binding: { selectedDimensions: [F.DIM], selectedMeasures: [F.MEASURE] },
        layout: { x: 9000, y: 9000, w: 10, h: 10 },
      }],
    },
  };
}

// The panel opens from the header, beside the stages; the answer arrives in it.
async function openPanel(page, modelId) {
  // The preview's rows come from /query in the browser; the seed's datasource
  // is unreachable. The assistant's own read is server-side and not mocked.
  await page.route('**/api/models/*/query', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ROWS) }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Assistant', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Assistant' });
  await expect(panel).toBeVisible();
  await panel.getByLabel('Data model').selectOption(modelId);
  return panel;
}

async function addToNewReport(page, panel, button, title) {
  await panel.getByRole('button', { name: button }).click();
  await page.getByRole('tab', { name: 'New report' }).click();
  await page.getByLabel('Title').fill(title);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await panel.getByRole('button', { name: 'Open in editor' }).click();
  await expect(page).toHaveURL(/\/edit\//);
  return page.url().split('/edit/')[1].split(/[?#]/)[0];
}

test('a question asked in the panel becomes a visual in a new report', async ({ page }) => {
  const provider = await F.startScriptedProvider(askScript);
  let createdId = null;
  try {
    await page.request.put('/api/admin/settings/ai', {
      data: { provider: 'openai-compat', baseUrl: provider.url, model: 'scripted', enabled: true, dataSharing: 'schema+cache' },
    });
    const panel = await openPanel(page, ids().modelId);
    // An empty panel suggests (Try / Learn the tool); a typed question is sent as is.
    await expect(panel.getByText('What would you like to know?')).toBeVisible();
    await expect(panel.getByRole('button', { name: 'How do I add an answer to a report?' })).toBeVisible();
    await panel.getByLabel('Your question').fill('Sales by country');
    await panel.getByRole('button', { name: 'Send' }).click();

    // The answer arrives in the panel; the journey stays where it was.
    const add = panel.getByRole('button', { name: 'Add to report' });
    await expect(add).toBeVisible({ timeout: 20000 });
    await expect(page).toHaveURL(/\/$/);
    // Drawn for real, and the same fields read as a table.
    const preview = panel.getByLabel('Visual preview');
    await expect(preview.locator('canvas, svg').first()).toBeVisible();
    await panel.getByRole('tab', { name: 'Table' }).click();
    await expect(preview.getByText('DE')).toBeVisible();
    await panel.getByRole('tab', { name: 'Chart' }).click();
    await panel.getByRole('button', { name: 'Good answer' }).click();
    await expect(panel.getByRole('button', { name: 'Good answer' })).toHaveAttribute('aria-pressed', 'true');

    // The cache read came back as a miss: nothing was read from the source.
    expect(provider.requests.length).toBe(2);
    const toolResult = provider.requests[1].messages.find((m) => m.role === 'tool');
    expect(JSON.parse(toolResult.content)).toHaveProperty('miss');
    // No page, no report in what the provider was shown.
    const system = provider.requests[0].messages.find((m) => m.role === 'system').content;
    expect(system).not.toContain('Widgets already on the page');
    const tool = provider.requests[0].tools.find((t) => t.function.name === 'propose_widgets');
    expect(Object.keys(tool.function.parameters.properties.widgets.items.properties)).not.toContain('layout');

    createdId = await addToNewReport(page, panel, 'Add to report', `Asked ${Date.now()}`);
    await expect(page.locator('.widget-content').first()).toBeVisible();
    await expect(page.getByText(TITLE).first()).toBeVisible();
    // Placed by the server, not where the model said.
    const saved = await (await page.request.get(`/api/reports/${createdId}`)).json();
    expect(saved.report.pages[0].layout).toEqual([expect.objectContaining({ x: 20, y: 20, w: 560, h: 360 })]);

    await page.reload();
    await expect(page.getByText(TITLE).first()).toBeVisible();
  } finally {
    if (createdId) await page.request.delete(`/api/reports/${createdId}`);
    await page.request.put('/api/admin/settings/ai', { data: { enabled: false } });
    provider.server.close();
  }
});

// A visual no built-in type draws, written by an admin of the workspace:
// previewed with the network shut, installed in that workspace's library when
// it is added, and run on the report under the same policy.
const PROBE_JS = `
(function () {
  var root;
  function draw(ctx) { root.textContent = 'ASK-VISUAL-OK rows=' + ctx.data.rows.length; }
  OpenReportRegisterVisual({
    render: function (container, ctx) { root = container; draw(ctx); },
    update: function (ctx) { draw(ctx); }
  });
})();`;

function writeScript() {
  return {
    name: 'propose_custom_visual',
    arguments: {
      manifest: { id: 'Ask Probe', name: 'Ask probe', dataSchema: { dimensions: [{ role: 'category', label: 'Category' }], measures: [{ role: 'value', label: 'Value' }] } },
      visualJs: PROBE_JS,
      binding: { selectedDimensions: [F.DIM], selectedMeasures: [F.MEASURE] },
      rationale: 'No built-in type draws this.',
    },
  };
}

test('an admin has a new kind of visual written in the panel, and it lands in the library and a report', async ({ page }) => {
  const provider = await F.startScriptedProvider(writeScript);
  let createdId = null;
  try {
    await page.request.put('/api/admin/settings/ai', {
      data: { provider: 'openai-compat', baseUrl: provider.url, model: 'scripted', enabled: true, dataSharing: 'schema' },
    });
    const panel = await openPanel(page, ids().modelId);
    await panel.getByLabel('Your question').fill('Draw sales as a new kind of visual');
    await panel.getByRole('button', { name: 'Send' }).click();

    // The conversation named a workspace this user administers: the tool was offered.
    await expect(panel.getByRole('button', { name: 'Add to library & report' })).toBeVisible({ timeout: 20000 });
    expect(provider.requests[0].tools.map((t) => t.function.name)).toContain('propose_custom_visual');

    const preview = page.frameLocator('iframe[title="Custom visual"]').first();
    await expect(preview.getByText(/ASK-VISUAL-OK rows=/)).toBeVisible();
    await expect(preview.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveCount(1);

    createdId = await addToNewReport(page, panel, 'Add to library & report', `Written ${Date.now()}`);
    const saved = await (await page.request.get(`/api/reports/${createdId}`)).json();
    const [widget] = Object.values(saved.report.pages[0].widgets);
    expect(widget.config.visualId).toBe('ai-ask-probe');
    const library = await (await page.request.get(`/api/workspaces/${saved.report.workspace_id}/visuals`)).json();
    expect(library.visuals.find((v) => v.id === 'ai-ask-probe')).toEqual(expect.objectContaining({ origin: 'ai' }));

    const onCanvas = page.locator('.widget-content').frameLocator('iframe').first();
    await expect(onCanvas.getByText('ASK-VISUAL-OK rows=2')).toBeVisible({ timeout: 15000 });
    await expect(onCanvas.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveCount(1);
  } finally {
    if (createdId) await page.request.delete(`/api/reports/${createdId}`);
    await page.request.put('/api/admin/settings/ai', { data: { enabled: false } });
    provider.server.close();
  }
});

// "Schedule my report every Monday" — done for the user: a card, a report to pick,
// one click, and the schedule exists. Nothing before that click.
test('asked to schedule a report, the assistant does it once the user confirms', async ({ page }) => {
  const provider = await F.startScriptedProvider(() => ({
    name: 'propose_action',
    arguments: { userAsked: 'do', action: 'schedule_cache_refresh', frequency: 'weekly', weekday: 'monday', time: '07:30', summary: 'Every Monday morning.' },
  }));
  const { modelId, reportId } = ids();
  let created = null;
  try {
    await page.request.put('/api/admin/settings/ai', {
      data: { provider: 'openai-compat', baseUrl: provider.url, model: 'scripted', enabled: true, dataSharing: 'schema' },
    });
    const schedules = async () => (await (await page.request.get(`/api/cache-schedules/by-report/${reportId}`)).json()).schedules;
    const before = (await schedules()).length;

    const panel = await openPanel(page, modelId);
    await panel.getByLabel('Your question').fill('Planifie mon rapport chaque lundi à 7h30');
    await panel.getByRole('button', { name: 'Send' }).click();

    await expect(panel.getByText('Every Monday at 07:30')).toBeVisible({ timeout: 20000 });
    expect(await schedules()).toHaveLength(before);

    await panel.getByLabel('Report to schedule').selectOption(reportId);
    await panel.getByRole('button', { name: 'Schedule' }).click();
    await expect(panel.getByText('Scheduled')).toBeVisible();

    const after = await schedules();
    expect(after).toHaveLength(before + 1);
    created = after.find((s) => s.cron_expression === '30 7 * * 1');
    expect(created).toBeTruthy();
  } finally {
    if (created) await page.request.delete(`/api/cache-schedules/${created.id}`);
    await page.request.put('/api/admin/settings/ai', { data: { enabled: false } });
    provider.server.close();
  }
});

// Help from the header: the same panel on its Help tab, answered from the user
// guide — no model picked, no data tool offered to the provider.
test('the Help button opens the Help tab, and a suggested question is answered from the guide', async ({ page }) => {
  const provider = await F.startScriptedProvider(() => ({ name: 'read_help', arguments: { topics: ['sharing'] } }));
  try {
    await page.request.put('/api/admin/settings/ai', {
      data: { provider: 'openai-compat', baseUrl: provider.url, model: 'scripted', enabled: true, dataSharing: 'schema' },
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Help' }).click();
    const panel = page.getByRole('complementary', { name: 'Assistant' });
    await expect(panel.getByRole('tab', { name: 'Help' })).toHaveAttribute('aria-selected', 'true');
    await expect(panel.getByLabel('Data model')).toBeHidden();

    await panel.getByRole('button', { name: 'How do I share a report with my team?' }).click();
    await expect(panel.getByText('How do I share a report with my team?')).toBeVisible();
    await expect(panel.getByText('Here is a bar chart.')).toBeVisible({ timeout: 20000 });

    // The guide, and the cards that bring data in: no data tool.
    expect(provider.requests[0].tools.map((t) => t.function.name)).toEqual(['read_help', 'propose_action']);
    const guide = provider.requests[1].messages.find((m) => m.role === 'tool');
    expect(JSON.parse(guide.content).help).toMatch(/## sharing/);

    // The Your data tab keeps its own, still empty, conversation.
    await panel.getByRole('tab', { name: 'Your data' }).click();
    await expect(panel.getByText('What would you like to know?')).toBeVisible();
  } finally {
    await page.request.put('/api/admin/settings/ai', { data: { enabled: false } });
    provider.server.close();
  }
});

// "What do you need?" on the empty Reports stage hands the request to the
// Assistant panel; with a model here, the answer is a report to build — a card,
// then the editor with its own assistant asked the same request. The request
// travels in the browser's storage, never in the URL.
// Skipped while "What do you need?" is off (Dashboard.jsx DESCRIBE_REPORT).
test.skip('asked on the empty stage, the panel answers with a report to build, and the editor opens on it', async ({ page, request }) => {
  const REQUEST = 'Sales by country, best first';
  const provider = await F.startScriptedProvider((body) => (provider.requests.length === 1
    ? { name: 'propose_action', arguments: { userAsked: 'do', action: 'create_report', request: REQUEST, summary: 'A report of sales by country.' } }
    : {
      name: 'propose_widgets',
      arguments: { widgets: [{ type: 'bar', title: 'Sales by country (described)', rationale: 'Ranks countries by sales.', binding: { selectedDimensions: [F.DIM], selectedMeasures: [F.MEASURE] } }] },
    }));
  let reportId = null;
  let ws = null;
  try {
    await page.request.put('/api/admin/settings/ai', {
      data: { provider: 'openai-compat', baseUrl: provider.url, model: 'scripted', enabled: true, dataSharing: 'schema' },
    });
    const { modelId } = ids();
    const name = `Describe ${Date.now()}`;
    ws = (await (await request.post('/api/workspaces', { data: { name } })).json()).workspace;
    expect((await request.put(`/api/models/${modelId}/shares`, { data: { workspaceIds: [ws.id] } })).ok()).toBeTruthy();
    await page.route('**/api/models/*/query', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ROWS) }));
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto('/');
    await page.locator('header').getByRole('button', { name: 'My Reports' }).click();
    await page.getByRole('button', { name }).first().click();

    await page.getByLabel('Describe the report you want').last().fill(REQUEST);
    await page.getByLabel('Describe the report you want').last().press('Enter');
    const panel = page.getByRole('complementary', { name: 'Assistant' });
    await expect(panel.getByRole('tab', { name: 'Your data' })).toHaveAttribute('aria-selected', 'true');
    await panel.getByRole('button', { name: 'Build this report' }).click({ timeout: 20000 });
    await page.waitForURL(/\/edit\//);
    reportId = page.url().split('/edit/')[1].split(/[?#]/)[0];
    expect(page.url()).not.toContain('Sales');

    // Asked once, in the report's own conversation, and its answer is a card to apply.
    await expect(page.getByRole('button', { name: 'Add visual' })).toBeVisible({ timeout: 20000 });
    const editorAsk = provider.requests[1];
    expect(editorAsk.messages.filter((m) => m.role === 'user')).toEqual([expect.objectContaining({ content: expect.stringContaining(REQUEST) })]);

    const row = (await (await request.get(`/api/reports/${reportId}`)).json()).report;
    expect(row.workspace_id).toBe(ws.id);
    expect(row.model_id).toBe(modelId);
    expect(row.draft).toBe(1);
  } finally {
    if (reportId) await page.request.delete(`/api/reports/${reportId}`);
    // Left behind, the empty workspace would be where the next spec lands.
    if (ws) await page.request.delete(`/api/workspaces/${ws.id}`);
    await page.request.put('/api/admin/settings/ai', { data: { enabled: false } });
    provider.server.close();
  }
});

// The same box on a workspace with a data source but no model: the Help tab
// hands over a model to build; the model assistant picks the table, the editor
// loads it, the assistant is asked again on its own, and "Continue to your
// report" carries the request on to the report's assistant.
function journeyScript(REQUEST, first) {
  return (body) => {
    const tools = body.tools.map((t) => t.function.name);
    if (tools.includes('propose_model_changes')) {
      const asked = body.messages.filter((m) => m.role === 'user').length;
      const system = body.messages.find((m) => m.role === 'system').content;
      const table = system.match(/Other tables of the source \(not in the model\): "([^"]+)"/);
      return asked === 1
        ? { name: 'propose_model_changes', arguments: { reading: { tables: true }, summary: 'Add the table.', addTables: [table[1]] } }
        : { name: 'propose_model_changes', arguments: { reading: { layout: true }, summary: 'Arrange the diagram.' } };
    }
    if (!tools.includes('propose_widgets')) return first;
    return { name: 'read_help', arguments: { topics: ['reports'] } };
  };
}

// Skipped while "What do you need?" is off (Dashboard.jsx DESCRIBE_REPORT).
test.skip('asked on a workspace with only a source, the panel builds a model with the model assistant, then the report', async ({ page, request }) => {
  const REQUEST = 'Amounts by id';
  const provider = await F.startScriptedProvider(journeyScript(REQUEST,
    { name: 'propose_action', arguments: { userAsked: 'do', action: 'build_model', request: REQUEST, summary: 'A data model on your file.' } }));
  let ws = null;
  let reportId = null;
  try {
    await page.request.put('/api/admin/settings/ai', {
      data: { provider: 'openai-compat', baseUrl: provider.url, model: 'scripted', enabled: true, dataSharing: 'schema' },
    });
    const name = `Source only ${Date.now()}`;
    ws = (await (await request.post('/api/workspaces', { data: { name } })).json()).workspace;
    const up = await request.post('/api/upload', {
      multipart: { file: { name: `described-${Date.now()}.csv`, mimeType: 'text/csv', buffer: Buffer.from('id,amount\n1,10\n2,20\n') }, workspaceId: ws.id },
    });
    expect(up.status()).toBe(201);
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto('/');
    await page.locator('header').getByRole('button', { name: 'My Reports' }).click();
    await page.getByRole('button', { name }).first().click();

    await page.getByLabel('Describe the report you want').last().fill(REQUEST);
    await page.getByLabel('Describe the report you want').last().press('Enter');
    const panel = page.getByRole('complementary', { name: 'Assistant' });
    await panel.getByRole('button', { name: /^Build it on / }).click({ timeout: 20000 });
    await page.waitForURL(/\/models\//);
    const assistant = page.getByRole('complementary', { name: 'Model assistant' });
    await expect(assistant.getByText(REQUEST)).toBeVisible({ timeout: 20000 });

    // The table card, then the second turn asked without the user typing.
    await expect(assistant.getByText('Tables to add')).toBeVisible({ timeout: 20000 });
    await assistant.getByRole('button', { name: /^Apply/ }).click();
    await expect(assistant.getByText(/The tables are in the model now/)).toBeVisible({ timeout: 20000 });
    await expect(assistant.getByText('Tables arranged: facts in the middle, their dimensions around')).toBeVisible({ timeout: 20000 });
    const second = provider.requests.filter((b) => b.tools.some((t) => t.function.name === 'propose_model_changes')).pop();
    expect(second.messages.find((m) => m.role === 'system').content).toMatch(/Tables \(column type.*\n- described_\d+: id /);

    await page.getByRole('button', { name: 'Continue to your report →' }).click();
    await page.waitForURL(/\/edit\//);
    reportId = page.url().split('/edit/')[1].split(/[?#]/)[0];
    await expect(page.getByText(REQUEST)).toBeVisible({ timeout: 20000 });
    expect(provider.requests.some((b) => b.tools.some((t) => t.function.name === 'propose_widgets')
      && b.messages.some((m) => m.role === 'user' && m.content.includes(REQUEST)))).toBe(true);
  } finally {
    if (reportId) await page.request.delete(`/api/reports/${reportId}`);
    if (ws) await page.request.delete(`/api/workspaces/${ws.id}`);
    await page.request.put('/api/admin/settings/ai', { data: { enabled: false } });
    provider.server.close();
  }
});

// With nothing in the workspace, "send me the file": the card takes it, the
// file goes to the upload route (never to the provider), and the model to
// build on it is one click away, with the request carried on.
// Skipped while "What do you need?" is off (Dashboard.jsx DESCRIBE_REPORT).
test.skip('asked on an empty workspace, the panel takes the file and goes on to the model', async ({ page, request }) => {
  const REQUEST = 'Total amount';
  const provider = await F.startScriptedProvider(journeyScript(REQUEST,
    { name: 'propose_action', arguments: { userAsked: 'do', action: 'import_file', request: REQUEST, summary: 'Send me the file.' } }));
  let ws = null;
  try {
    await page.request.put('/api/admin/settings/ai', {
      data: { provider: 'openai-compat', baseUrl: provider.url, model: 'scripted', enabled: true, dataSharing: 'schema' },
    });
    const name = `Nothing yet ${Date.now()}`;
    ws = (await (await request.post('/api/workspaces', { data: { name } })).json()).workspace;
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto('/');
    await page.locator('header').getByRole('button', { name: 'My Reports' }).click();
    await page.getByRole('button', { name }).first().click();

    await page.getByLabel('Describe the report you want').last().fill(REQUEST);
    await page.getByLabel('Describe the report you want').last().press('Enter');
    const panel = page.getByRole('complementary', { name: 'Assistant' });
    await expect(panel.getByRole('tab', { name: 'Help' })).toHaveAttribute('aria-selected', 'true');
    await expect(panel.getByText('Drop your file here, or click to choose it')).toBeVisible({ timeout: 20000 });
    await panel.getByLabel('File to import').setInputFiles({
      name: `waiting-${Date.now()}.csv`, mimeType: 'text/csv', buffer: Buffer.from('id,amount\n1,10\n2,20\n'),
    });
    await page.getByRole('dialog').getByRole('button', { name: 'Import', exact: true }).click();
    await expect(panel.getByText(/is ready$/)).toBeVisible({ timeout: 20000 });
    // The provider saw the request, never the file.
    expect(JSON.stringify(provider.requests)).not.toContain('id,amount');

    await panel.getByRole('button', { name: 'Build a data model with the assistant' }).click();
    await page.waitForURL(/\/models\//);
    await expect(page.getByRole('complementary', { name: 'Model assistant' }).getByText(REQUEST)).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('button', { name: 'Continue to your report →' })).toBeVisible();
  } finally {
    if (ws) await page.request.delete(`/api/workspaces/${ws.id}`);
    await page.request.put('/api/admin/settings/ai', { data: { enabled: false } });
    provider.server.close();
  }
});

// "How do I create a connection?": the steps, and a card that opens the form.
// The connection details are typed there, never in the chat.
test('asked how to connect a database, Help explains and hands over the connection form', async ({ page }) => {
  const provider = await F.startScriptedProvider((body) => (body.messages.some((m) => m.role === 'tool')
    ? { name: 'propose_action', arguments: { userAsked: 'how', action: 'connect_database', summary: 'Open the connection form.' } }
    : { name: 'read_help', arguments: { topics: ['datasources'] } }));
  try {
    await page.request.put('/api/admin/settings/ai', {
      data: { provider: 'openai-compat', baseUrl: provider.url, model: 'scripted', enabled: true, dataSharing: 'schema' },
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Help' }).click();
    const panel = page.getByRole('complementary', { name: 'Assistant' });
    await panel.getByLabel('Your question').fill('Comment créer une connexion ?');
    await panel.getByRole('button', { name: 'Send' }).click();
    await panel.getByRole('button', { name: 'Connect a database' }).click({ timeout: 20000 });
    await expect(page.getByRole('dialog').getByText('Host', { exact: true })).toBeVisible();
    expect(provider.requests[0].tools.map((t) => t.function.name)).toEqual(['read_help', 'propose_action']);
  } finally {
    await page.request.put('/api/admin/settings/ai', { data: { enabled: false } });
    provider.server.close();
  }
});

// Without the assistant, Help is the user guide: the same help.md, readable and searchable.
test('without the assistant, Help opens the user guide, searchable', async ({ page }) => {
  await page.request.put('/api/admin/settings/ai', { data: { enabled: false } });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Help' }).click();
  await expect(page).toHaveURL(/\/help$/);
  await expect(page.getByRole('heading', { name: 'Public links and embedding' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Topics' }).getByText('Row-level security (RLS)')).toBeVisible();

  await page.getByLabel('Search the guide').fill('public link');
  await expect(page.getByRole('heading', { name: 'Public links and embedding' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Row-level security (RLS)' })).toHaveCount(0);
});
