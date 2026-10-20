// A design request is about the whole report: the assistant is shown the look
// of the other pages, restyles a chart there, the card names the page, and
// Save writes it to that page — the page shown left as it was. Only a
// browser holds the chain: the context the studio sends, the provider's
// reading of it, the card, the working copy and the save.
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const F = require('../fixtures');

const ids = () => JSON.parse(fs.readFileSync(F.IDS_FILE, 'utf8'));
const chart = (title) => ({ type: 'bar', dataBinding: { selectedDimensions: [F.DIM], selectedMeasures: [F.MEASURE] }, config: { title } });

// Renames the first chart of the first OTHER page the prompt lists.
function script(body) {
  const system = body.messages.find((m) => m.role === 'system').content;
  const other = system.slice(system.indexOf('OTHER pages'));
  const widgetId = other.match(/"widgets":\[\{"id":"([^"]+)"/)[1];
  return {
    name: 'propose_design_changes',
    arguments: {
      reading: { layout: false, colors: false, theme: false },
      summary: 'Rename the chart of the second page.',
      ops: [{ op: 'update_config', widgetId, set: { title: 'Renamed on page two' } }],
    },
  };
}

test('a design change lands on another page of the report, named on the card, written by Save', async ({ page }) => {
  const provider = await F.startScriptedProvider(script);
  try {
    await page.request.put('/api/admin/settings/ai', {
      data: { provider: 'openai-compat', baseUrl: provider.url, model: 'scripted', enabled: true, dataSharing: 'schema' },
    });
    await page.route('**/api/models/*/query', (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ rows: [{ [F.DIM_LABEL]: 'France', [F.MEASURE_LABEL]: 100 }], rowCount: 1 }),
    }));
    const { modelId } = ids();
    const made = await page.request.post('/api/reports', { data: { title: `Two pages ${Date.now()}`, modelId } });
    const reportId = (await made.json()).report.id;
    const pages = [
      { id: 'page-1', name: 'Page 1', layout: [{ i: 'w-one', x: 40, y: 40, w: 500, h: 300, z: 1 }], widgets: { 'w-one': chart('Page one chart') } },
      { id: 'page-2', name: 'Page 2', layout: [{ i: 'w-two', x: 40, y: 40, w: 500, h: 300, z: 1 }], widgets: { 'w-two': chart('Page two chart') } },
    ];
    await page.request.put(`/api/reports/${reportId}`, { data: { settings: {}, layout: pages[0].layout, widgets: pages[0].widgets, pages } });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/studio/${reportId}`);
    await page.locator('.widget-content').first().waitFor();
    await page.getByPlaceholder('Ask for a visual, a change, or the look of the page…').fill('Rename the chart on the second page');
    await page.getByRole('button', { name: 'Send' }).click();
    // The card names the page the change is for.
    await expect(page.getByText('Page two chart · Page 2')).toBeVisible({ timeout: 20000 });
    await page.getByRole('button', { name: /^Apply/ }).click();
    await expect(page.getByText(/Applied/)).toBeVisible();

    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    const saved = (await (await page.request.get(`/api/reports/${reportId}`)).json()).report;
    expect(saved.settings.pages[1].widgets['w-two'].config.title).toBe('Renamed on page two');
    expect(saved.settings.pages[0].widgets['w-one'].config.title).toBe('Page one chart');
  } finally {
    await page.request.put('/api/admin/settings/ai', { data: { enabled: false } });
    provider.server.close();
  }
});
