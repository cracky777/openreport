// A filter on a measure can be told which aggregation to compare against.
//
// The server already filters on the very expression the visual displays: a
// measure shown as an average is filtered as one, via the widget's
// `measureAggOverrides`. But a measure used ONLY in a filter has no chip in a
// field well, so there was nowhere to set that — a "Top 5 by average duration"
// could only ever be "by total duration".
//
// The picker writes to the same per-widget override the chips use, so the
// filter and the displayed measure can never disagree.
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const F = require('../fixtures');

const ids = () => JSON.parse(fs.readFileSync(F.IDS_FILE, 'utf8'));
const AGG_PICKER = '[title="Aggregation this filter compares against"]';

test('a measure filter carries its aggregation into the query', async ({ page }) => {
  const { tableReportId } = ids();
  const queries = [];
  await page.route('**/api/models/*/query', (route) => {
    try {
      const body = JSON.parse(route.request().postData() || '{}');
      if ((body.widgetFilters || []).some((f) => f.isMeasure)) {
        queries.push({ agg: body.measureAggOverrides || null });
      }
    } catch { /* an auxiliary query with another body shape */ }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ rows: [{ Country: 'x', Sales: 1 }], rowCount: 1 }),
    });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/edit/${tableReportId}`);
  await page.locator('.widget-content').first().click({ position: { x: 30, y: 30 } });

  const nInput = page.locator('input[placeholder="N (e.g. 10)"]');
  if (await nInput.count() === 0) await page.getByText('Filters', { exact: true }).first().click();
  await nInput.first().waitFor();
  // A rule with no N is dropped from the query — give it one first.
  await nInput.first().fill('5');
  await nInput.first().press('Enter');
  await expect.poll(() => queries.length).toBeGreaterThan(0);

  const picker = page.locator(AGG_PICKER);
  await expect(picker).toHaveCount(1);
  // Opens on the measure's own aggregation, not on a hardcoded default.
  await expect(picker).toHaveValue('sum');

  queries.length = 0;
  await picker.selectOption('avg');
  // The change refetches, and the override rides along — it is what the server
  // builds both the HAVING and the SELECT from.
  await expect.poll(() => queries.length).toBeGreaterThan(0);
  expect(queries[queries.length - 1].agg).toEqual({ [F.MEASURE]: 'avg' });
});
