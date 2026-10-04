// A field dropped on an empty spot of the page becomes a visual there: a
// measure a scorecard, a dimension a table (utils/fieldVisuals). A dashed
// frame says what and where while the field is in the air; the new visual
// offers "Show as"; a dimension dropped on a scorecard turns it into a chart.
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const F = require('../fixtures');

const ids = () => JSON.parse(fs.readFileSync(F.IDS_FILE, 'utf8'));

async function grab(page, label) {
  const row = page.locator('[data-drag-field]', { hasText: label }).first();
  await expect(row).toBeVisible();
  const b = await row.boundingBox();
  await page.mouse.move(Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2));
  await page.mouse.down();
  await page.mouse.move(Math.round(b.x + b.width / 2) - 30, Math.round(b.y + b.height / 2) + 10, { steps: 4 });
}

// A report of its own, empty: the editor saves as it goes, so a visual made
// by one test would sit where the next one drops. Removed by `done`.
async function openEditor(page) {
  const created = await page.request.post('/api/reports', { data: { title: `Drop ${Date.now()}`, modelId: ids().modelId } });
  const reportId = (await created.json()).report.id;
  await page.route('**/api/models/*/query', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ rows: [{ [F.DIM_LABEL]: 'FR', [F.MEASURE_LABEL]: 3 }], rowCount: 1 }),
  }));
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/edit/${reportId}`);
  const canvas = page.locator('[data-tour="canvas"]');
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(800);
  const b = await canvas.boundingBox();
  return { spot: { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + 220) }, done: () => page.request.delete(`/api/reports/${reportId}`) };
}

async function dropMeasureOnPage(page, spot) {
  const before = await page.locator('.widget-content').count();
  await grab(page, F.MEASURE_LABEL);
  await page.mouse.move(spot.x, spot.y - 20, { steps: 6 });
  await page.mouse.move(spot.x, spot.y, { steps: 4 });
  await expect(page.getByText('New scorecard')).toBeVisible();
  await page.mouse.up();
  await expect(page.locator('.widget-content')).toHaveCount(before + 1);
}

test('a measure dropped on an empty spot of the page becomes a scorecard there, then shown as a table', async ({ page }) => {
  const { spot, done } = await openEditor(page);
  await dropMeasureOnPage(page, spot);

  const showAs = page.getByRole('toolbar', { name: 'Show as' });
  await expect(showAs.getByRole('button', { name: 'Card' })).toHaveAttribute('aria-pressed', 'true');
  await showAs.getByRole('button', { name: 'Table' }).click();
  await expect(showAs.getByRole('button', { name: 'Table' })).toHaveAttribute('aria-pressed', 'true');

  // Selection elsewhere: the bar goes.
  await page.mouse.click(spot.x, spot.y + 500);
  await expect(showAs).toHaveCount(0);
  await done();
});

test('a dimension dropped on that scorecard turns it into a bar chart of it', async ({ page }) => {
  const { spot, done } = await openEditor(page);
  await dropMeasureOnPage(page, spot);

  await grab(page, F.DIM_LABEL);
  await page.mouse.move(spot.x, spot.y - 20, { steps: 6 });
  await page.mouse.move(spot.x, spot.y, { steps: 4 });
  await expect(page.getByText('Axis — as a bar chart').first()).toBeVisible();
  // Over a visual, the page's own "new visual" frame stays out of the way —
  // also once the pointer has settled there.
  await page.waitForTimeout(300);
  await expect(page.getByText('New table')).toHaveCount(0);
  await page.mouse.up();

  const showAs = page.getByRole('toolbar', { name: 'Show as' });
  await expect(showAs.getByRole('button', { name: 'Bar' })).toHaveAttribute('aria-pressed', 'true');
  await expect(showAs.getByRole('button', { name: 'Pie' })).toBeVisible();
  await done();
});

// "Suggest" hands the visual's fields to the editor's assistant, in Visuals mode.
test('Suggest on the new visual asks the assistant which visual fits its fields', async ({ page }) => {
  const provider = await F.startScriptedProvider(() => ({ name: 'read_help', arguments: { topics: ['visuals'] } }));
  try {
    await page.request.put('/api/admin/settings/ai', {
      data: { provider: 'openai-compat', baseUrl: provider.url, model: 'scripted', enabled: true, dataSharing: 'schema' },
    });
    const { spot, done } = await openEditor(page);
    await dropMeasureOnPage(page, spot);
    await page.getByRole('toolbar', { name: 'Show as' }).getByRole('button', { name: 'Suggest' }).click();
    await expect(page.getByText(`Which visual best shows ${F.MEASURE_LABEL}? Propose it.`)).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('tab', { name: 'Visuals' })).toHaveAttribute('aria-selected', 'true');
    await done();
  } finally {
    await page.request.put('/api/admin/settings/ai', { data: { enabled: false } });
    provider.server.close();
  }
});
