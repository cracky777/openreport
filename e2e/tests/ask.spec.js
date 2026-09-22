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
  await page.getByRole('button', { name: 'Assistant' }).click();
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
    // No canned questions: an empty panel asks, it does not suggest.
    await expect(panel.getByText('What would you like to know?')).toBeVisible();
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
