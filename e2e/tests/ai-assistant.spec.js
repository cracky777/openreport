// The assistant, end to end against a scripted provider.
//
// Two things here only exist in a running system. The data tool reaches /query
// over loopback with the internal token — no listening server under Jest — so
// this is where `cacheOnly` is proven on the real route: the seed has no
// rollup, and the tool must come back with a miss rather than rows from the
// source. And applying a proposal must be ONE undo step, which is a property
// of the editor's history, not of the pure helper the unit tests cover.
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const F = require('../fixtures');

const ids = () => JSON.parse(fs.readFileSync(F.IDS_FILE, 'utf8'));

// Reads the cache first, then proposes a bar chart.
function widgetScript(body) {
  const toolTurns = body.messages.filter((m) => m.role === 'tool').length;
  if (toolTurns === 0) return { name: 'query_cached_data', arguments: { dimensions: [F.DIM], measures: [F.MEASURE] } };
  return {
    name: 'propose_widgets',
    arguments: {
      widgets: [{
        type: 'bar',
        title: 'Sales by country (AI)',
        rationale: 'Ranks countries by sales.',
        binding: { selectedDimensions: [F.DIM], selectedMeasures: [F.MEASURE] },
      }],
    },
  };
}

// Restyles the first widget it was told about, and switches the theme.
function designScript(body) {
  const system = body.messages.find((m) => m.role === 'system').content;
  const widgetId = system.slice(system.indexOf('Widgets already on the page')).match(/"id":"([^"]+)"/)[1];
  return {
    name: 'propose_design_changes',
    arguments: {
      // The request names a theme switch: the model's reading allows it.
      reading: { layout: false, colors: false, theme: true },
      summary: 'Name the table and go dark.',
      ops: [
        { op: 'update_config', widgetId, set: { title: 'Renamed by the assistant', bundleUrl: 'http://evil.invalid/x.js' } },
        { op: 'report_settings', set: { theme: 'dark' } },
      ],
    },
  };
}

const startScriptedProvider = (script = widgetScript) => F.startScriptedProvider(script);

test('a design proposal restyles in one undo step and hands back a way out of the theme change', async ({ page }) => {
  const provider = await startScriptedProvider(designScript);
  try {
    await page.request.put('/api/admin/settings/ai', {
      data: { provider: 'openai-compat', baseUrl: provider.url, model: 'scripted', enabled: true, dataSharing: 'schema' },
    });
    const { tableReportId } = ids();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/edit/${tableReportId}`);
    await page.locator('.widget-content').first().waitFor();
    // The report theme wrapper, not the app's own: it is the one holding the canvas.
    const reportTheme = page.locator('[data-theme]').filter({ has: page.locator('.widget-content') }).last();
    const themeBefore = await reportTheme.getAttribute('data-theme');
    expect(themeBefore).not.toBe('dark');

    await page.getByRole('button', { name: 'AI assistant' }).click();
    await page.getByRole('tab', { name: 'Design' }).click();
    // The request names the theme: a theme switch is only accepted when asked for.
    await page.getByPlaceholder('Describe the look you want…').fill('Name the table and switch to the dark theme');
    await page.getByRole('button', { name: 'Send' }).click();

    // The key it was never allowed to set went through a repair round and is
    // gone from the card; the two legitimate changes remain.
    const apply = page.getByRole('button', { name: 'Apply 2 changes' });
    await expect(apply).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('evil.invalid')).toHaveCount(0);
    expect(provider.requests.length).toBe(2);

    await apply.click();
    // Looked up inside the canvas wrapper: the card in the panel quotes the
    // same title and would satisfy a page-wide search on its own.
    const onCanvas = reportTheme.getByText('Renamed by the assistant');
    await expect(onCanvas.first()).toBeVisible();
    await expect(reportTheme).toHaveAttribute('data-theme', 'dark');

    // The theme sits outside the undo stack, so the card carries the way back…
    await page.getByRole('button', { name: 'Revert theme' }).click();
    await expect(reportTheme).toHaveAttribute('data-theme', themeBefore);
    // …and the restyle is an ordinary undo step.
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(onCanvas).toHaveCount(0);
  } finally {
    await page.request.put('/api/admin/settings/ai', { data: { enabled: false } });
    provider.server.close();
  }
});

// Writes a small SVG visual. No network in it: the lint would refuse it, and
// the point here is the path a legitimate one takes.
const VISUAL_JS = `
(function () {
  var root;
  function draw(ctx) {
    var ns = 'http://www.w3.org/2000/svg';
    root.textContent = '';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', ctx.width); svg.setAttribute('height', ctx.height);
    var t = document.createElementNS(ns, 'text');
    t.setAttribute('x', 10); t.setAttribute('y', 24);
    t.textContent = 'AI-VISUAL-OK rows=' + ctx.data.rows.length;
    svg.appendChild(t); root.appendChild(svg);
  }
  OpenReportRegisterVisual({
    render: function (container, ctx) { root = container; draw(ctx); },
    update: function (ctx) { draw(ctx); }
  });
})();`;

function visualScript() {
  return {
    name: 'propose_custom_visual',
    arguments: {
      manifest: { id: 'E2E Probe', name: 'E2E probe', dataSchema: { dimensions: [{ role: 'category', label: 'Category' }], measures: [{ role: 'value', label: 'Value' }] } },
      visualJs: VISUAL_JS,
      binding: { selectedDimensions: [F.DIM], selectedMeasures: [F.MEASURE] },
      rationale: 'No built-in type shows this.',
    },
  };
}

test('a generated visual is previewed with the network shut, then joins the library and the page', async ({ page }) => {
  const provider = await startScriptedProvider(visualScript);
  try {
    await page.request.put('/api/admin/settings/ai', {
      data: { provider: 'openai-compat', baseUrl: provider.url, model: 'scripted', enabled: true, dataSharing: 'schema' },
    });
    // Custom visuals live in a workspace library, so the report has to be in one.
    const { modelId } = ids();
    const ws = await (await page.request.post('/api/workspaces', { data: { name: `ai-visuals-${Date.now()}` } })).json();
    const wsId = ws.workspace.id;
    const rep = await (await page.request.post('/api/reports', { data: { title: `AI visual ${Date.now()}`, modelId } })).json();
    const moved = await page.request.put(`/api/workspaces/${wsId}/reports/${rep.report.id}`);
    expect(moved.ok(), await moved.text()).toBeTruthy();

    // The visual's rows come from /query; the seed's datasource is unreachable.
    await page.route('**/api/models/*/query', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ rows: [{ [F.DIM_LABEL]: 'FR', [F.MEASURE_LABEL]: 1 }, { [F.DIM_LABEL]: 'DE', [F.MEASURE_LABEL]: 2 }], rowCount: 2 }),
    }));

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/edit/${rep.report.id}`);
    await page.getByRole('button', { name: 'AI assistant' }).click();
    await page.getByPlaceholder('Ask a business question…').fill('Draw something no chart can');
    await page.getByRole('button', { name: 'Send' }).click();

    // The preview runs the code on invented rows, under the no-network policy.
    const preview = page.frameLocator('iframe[title="Custom visual"]').first();
    await expect(preview.getByText('AI-VISUAL-OK rows=6')).toBeVisible({ timeout: 20000 });
    await expect(preview.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveCount(1);
    await page.getByRole('button', { name: 'Review the code' }).click();
    await expect(page.locator('pre', { hasText: 'OpenReportRegisterVisual' })).toBeVisible();

    await page.getByRole('button', { name: 'Add to library & insert' }).click();
    await expect(page.getByText(/Added to the workspace library/)).toBeVisible();

    // In the library, namespaced and marked as AI-written…
    const list = await (await page.request.get(`/api/workspaces/${wsId}/visuals`)).json();
    expect(list.visuals.map((v) => [v.id, v.origin])).toEqual([['ai-e2e-probe', 'ai']]);

    // …and on the page, where the policy comes from the header the bundle is
    // served with — not from the card, which is gone from this code path.
    const onCanvas = page.locator('.widget-content').frameLocator('iframe').first();
    await expect(onCanvas.getByText('AI-VISUAL-OK rows=2')).toBeVisible({ timeout: 15000 });
    await expect(onCanvas.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveCount(1);
  } finally {
    await page.request.put('/api/admin/settings/ai', { data: { enabled: false } });
    provider.server.close();
  }
});

test('a question becomes a proposal, applied in one undoable step, on cached data only', async ({ page }) => {
  const provider = await startScriptedProvider();
  try {
    const saved = await page.request.put('/api/admin/settings/ai', {
      data: { provider: 'openai-compat', baseUrl: provider.url, model: 'scripted', enabled: true, dataSharing: 'schema+cache' },
    });
    expect(saved.ok()).toBeTruthy();

    // Browser-side only: the assistant's own read goes server to server over
    // loopback and never crosses this route, so the miss below stays real.
    await page.route('**/api/models/*/query', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ rows: [{ [F.DIM_LABEL]: 'France', [F.MEASURE_LABEL]: 100 }, { [F.DIM_LABEL]: 'Spain', [F.MEASURE_LABEL]: 60 }], rowCount: 2 }),
    }));

    const { tableReportId } = ids();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/edit/${tableReportId}`);
    await page.locator('.widget-content').first().waitFor();
    const before = await page.locator('.widget-content').count();

    // The assistant takes the Data panel's place; the author may still bring
    // Data back by hand, and it stays.
    await expect(page.getByTitle('Collapse panel')).toBeVisible();
    await page.getByRole('button', { name: 'AI assistant' }).click();
    await expect(page.getByTitle('Open data panel')).toBeVisible();
    await page.getByTitle('Open data panel').click();
    await expect(page.getByTitle('Collapse panel')).toBeVisible();
    await page.getByTitle('Collapse panel').click();

    await page.getByPlaceholder('Ask a business question…').fill('Which countries sell the most?');
    await page.getByRole('button', { name: 'Send' }).click();

    await expect(page.getByText('Sales by country (AI)')).toBeVisible({ timeout: 20000 });

    // What the provider was told after its cache read: a miss, and no rows.
    const toolResult = provider.requests[1].messages.find((m) => m.role === 'tool');
    expect(JSON.parse(toolResult.content)).toEqual({ miss: expect.any(String), note: expect.stringMatching(/only read data the cache holds/) });
    // Nothing physical in what left the server.
    const sent = JSON.stringify(provider.requests);
    expect(sent).not.toContain('"expression"');
    expect(sent).not.toContain('"sql"');

    // The card draws the proposed chart itself, before anything is added.
    await expect(page.getByLabel('Visual preview').locator('canvas, svg').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.widget-content')).toHaveCount(before);
    await page.getByRole('button', { name: 'Add visual' }).click();
    await expect(page.locator('.widget-content')).toHaveCount(before + 1);
    // Added, not selected: the configuration panel must not open over the
    // conversation — and an unselected visual still has to load its data.
    await expect(page.getByPlaceholder('Add a title…')).toHaveCount(0);
    await expect(page.locator('.widget-content').last().locator('canvas, svg').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/Added to the page/)).toBeVisible();

    // Undo from the toolbar rather than the keyboard: focus sits in the panel.
    await page.getByRole('button', { name: /undo/i }).first().click();
    await expect(page.locator('.widget-content')).toHaveCount(before);

    // Closing the assistant gives the Data panel its place back.
    await page.getByRole('button', { name: 'Close assistant' }).click();
    await expect(page.getByTitle('Collapse panel')).toBeVisible();
  } finally {
    await page.request.put('/api/admin/settings/ai', { data: { enabled: false } });
    provider.server.close();
  }
});

// With no provider on the instance, the assistant is not hidden: the button
// opens a panel where the user plugs in their OWN provider, for their own use.
// The whole path only exists in a browser against a real server: the form, the
// save-and-test round trip, the status refresh that swaps the form for the chat.
test('without an instance provider, a user plugs in their own and the assistant answers', async ({ page }) => {
  // Answers the connectivity check with `ping`, a question with a bar chart.
  const provider = await startScriptedProvider((body) => (
    body.tools.some((t) => t.function.name === 'ping') ? { name: 'ping', arguments: { ok: true } } : widgetScript(body)
  ));
  try {
    const cleared = await page.request.put('/api/admin/settings/ai', { data: { removeProvider: true, enabled: true, dataSharing: 'schema+cache' } });
    expect(cleared.ok(), await cleared.text()).toBeTruthy();
    await page.request.delete('/api/ai/personal');

    const { tableReportId } = ids();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/edit/${tableReportId}`);
    await page.locator('.widget-content').first().waitFor();

    await page.getByRole('button', { name: 'AI assistant' }).click();
    await expect(page.getByText('Your AI provider')).toBeVisible();
    await expect(page.getByPlaceholder('Ask a business question…')).toBeHidden();

    // The preset is also the wire protocol: the scripted server speaks OpenAI's.
    await page.getByRole('combobox').selectOption('custom');
    await page.getByPlaceholder('https://…').fill(provider.url);
    await page.getByPlaceholder(/^e\.g\. /).fill('scripted');
    await page.getByRole('button', { name: 'Save & test' }).click();

    // Saved, tested, and the panel is now the assistant itself.
    await expect(page.getByPlaceholder('Ask a business question…')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Your AI provider')).toBeHidden();
    const status = await (await page.request.get('/api/ai/status')).json();
    expect(status).toMatchObject({ enabled: true, source: 'personal', dataSharing: 'schema+cache' });

    await page.getByPlaceholder('Ask a business question…').fill('Which countries sell the most?');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByText('Sales by country (AI)')).toBeVisible({ timeout: 20000 });

    // The provider stays one click away, to change or remove.
    await page.getByRole('button', { name: 'Your AI provider' }).click();
    await page.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByRole('button', { name: 'Save & test' })).toBeVisible();
    expect((await (await page.request.get('/api/ai/status')).json()).reason).toBe('setup');
  } finally {
    await page.request.delete('/api/ai/personal');
    await page.request.put('/api/admin/settings/ai', { data: { enabled: false } });
    provider.server.close();
  }
});