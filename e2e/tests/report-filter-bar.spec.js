// The report filter bar takes a field two more ways than its "+" list: a
// field dragged out of the Data panel and dropped on the bar starts a rule
// on it, and the "+" list itself is searched by typing rather than scrolled.
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
  await page.mouse.move(Math.round(b.x + b.width / 2) + 30, Math.round(b.y + b.height / 2) + 10, { steps: 4 });
}

test.beforeEach(async ({ page, request }, info) => {
  const { modelId } = ids();
  // A title of its own per test: the server refuses a title already taken.
  const title = `Rapport e2e barre de filtres ${info.workerIndex}-${Date.now()}`;
  const created = await request.post('/api/reports', { data: { title, modelId } });
  const reportId = (await created.json()).report.id;
  // One rule already there: the bar opens by itself with the report.
  await request.put(`/api/reports/${reportId}`, {
    data: {
      title, layout: [], widgets: {},
      settings: { reportFilters: [{ field: F.DIM, isMeasure: false, op: 'in', value: '', values: ['a'] }], pages: [{ id: 'page-1', name: 'Page 1', layout: [], widgets: {} }] },
    },
  });
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/edit/${reportId}`);
  await expect(page.getByTestId('report-filter-bar')).toBeVisible();
});

test('a field dropped on the bar becomes a report filter', async ({ page }) => {
  const bar = page.getByTestId('report-filter-bar');
  await grab(page, F.SPARE_DIM_LABEL);
  const b = await bar.boundingBox();
  await page.mouse.move(Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2) - 10, { steps: 6 });
  await page.mouse.move(Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2), { steps: 4 });
  // The bar says it will take the field while it is held over it.
  await expect(bar.getByText('Drop the field here to filter the report on it')).toBeVisible();
  await page.mouse.up();

  // The rule opens for editing, and once saved it sits in the chip row.
  await expect(page.getByText('Edit filter', { exact: true })).toBeVisible();
  await page.getByTitle('Save without refetching visuals (changes apply on next refresh)').click();
  await expect(bar.getByText(F.SPARE_DIM_LABEL)).toBeVisible();
});

test('the "+" list is searched by typing', async ({ page }) => {
  const bar = page.getByTestId('report-filter-bar');
  await page.getByTitle('Add a report filter').click();
  const search = page.getByRole('textbox', { name: 'Search a field' });
  await expect(search).toBeFocused();
  await search.fill(F.SPARE_DIM_LABEL.slice(0, 3));
  // Only the fields whose label matches remain, and Enter takes the first.
  await expect(page.getByRole('button', { name: F.SPARE_DIM_LABEL, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: F.MEASURE_LABEL, exact: true })).toHaveCount(0);
  await search.press('Enter');
  await expect(page.getByText('Edit filter', { exact: true })).toBeVisible();
  await page.getByTitle('Save without refetching visuals (changes apply on next refresh)').click();
  await expect(bar.getByText(F.SPARE_DIM_LABEL)).toBeVisible();
});
