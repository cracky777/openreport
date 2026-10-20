// The AI studio keeps the assistant's changes in hand: the viewer shows the
// working copy at once, Ctrl+Z / Ctrl+Y walk it back and forth, and only Save
// writes the report. Only a browser holds all three at once: the embedded
// viewer drawing an unsaved document, the window's shortcuts, the PUT.
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const F = require('../fixtures');

const ids = () => JSON.parse(fs.readFileSync(F.IDS_FILE, 'utf8'));

// Proposes a bar chart straight away.
const script = () => ({
  name: 'propose_widgets',
  arguments: {
    widgets: [{
      type: 'bar',
      title: 'Sales by country (studio)',
      rationale: 'Ranks countries by sales.',
      binding: { selectedDimensions: [F.DIM], selectedMeasures: [F.MEASURE] },
    }],
  },
});

test('a card applied in the studio is undone, redone, then written by Save', async ({ page }) => {
  const provider = await F.startScriptedProvider(script);
  try {
    const saved = await page.request.put('/api/admin/settings/ai', {
      data: { provider: 'openai-compat', baseUrl: provider.url, model: 'scripted', enabled: true, dataSharing: 'schema+cache' },
    });
    expect(saved.ok()).toBeTruthy();
    await page.route('**/api/models/*/query', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ rows: [{ [F.DIM_LABEL]: 'France', [F.MEASURE_LABEL]: 100 }, { [F.DIM_LABEL]: 'Spain', [F.MEASURE_LABEL]: 60 }], rowCount: 2 }),
    }));

    const { tableReportId } = ids();
    // The report as the server holds it: how many visuals on its first page.
    const savedCount = async () => {
      const r = (await (await page.request.get(`/api/reports/${tableReportId}`)).json()).report;
      const pages = r.settings?.pages;
      return Object.keys((pages && pages.length ? pages[0].widgets : r.widgets) || {}).length;
    };
    const before = await savedCount();

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/studio/${tableReportId}`);
    await page.locator('.widget-content').first().waitFor();
    await expect(page.locator('.widget-content')).toHaveCount(before);
    const save = page.getByRole('button', { name: 'Save', exact: true });
    await expect(save).toBeDisabled();

    await page.getByPlaceholder('Ask for a visual, a change, or the look of the page…').fill('Which countries sell the most?');
    await page.getByRole('button', { name: 'Send' }).click();
    await page.getByRole('button', { name: 'Add visual' }).click({ timeout: 20000 });
    await expect(page.locator('.widget-content')).toHaveCount(before + 1);
    await expect(page.getByText('Sales by country (studio)').last()).toBeVisible();
    // In hand, not written.
    expect(await savedCount()).toBe(before);
    await expect(save).toBeEnabled();

    await page.keyboard.press('Control+z');
    await expect(page.locator('.widget-content')).toHaveCount(before);
    await expect(save).toBeDisabled();
    await page.keyboard.press('Control+y');
    await expect(page.locator('.widget-content')).toHaveCount(before + 1);

    await save.click();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    expect(await savedCount()).toBe(before + 1);
    await expect(save).toBeDisabled();
  } finally {
    await page.request.put('/api/admin/settings/ai', { data: { enabled: false } });
    provider.server.close();
  }
});
