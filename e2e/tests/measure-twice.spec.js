// One visual can carry the same measure twice, aggregated differently.
//
// A field well refused a measure already in it, and the per-widget aggregation
// override is keyed by measure name — so one column could never be both summed
// and averaged in the same visual. The second entry is a variant whose name
// carries its aggregation, "<base>@@agg:<fn>", which is what keeps the two
// apart all the way to the SELECT list.
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const F = require('../fixtures');

const ids = () => JSON.parse(fs.readFileSync(F.IDS_FILE, 'utf8'));
const VARIANT = `${F.MEASURE}@@agg:avg`;

test('both entries are queried, and both are shown', async ({ page }) => {
  const { twiceReportId } = ids();
  const asked = [];
  await page.route('**/api/models/*/query', (route) => {
    try {
      const body = JSON.parse(route.request().postData() || '{}');
      if (Array.isArray(body.measureNames)) asked.push(body.measureNames.slice());
    } catch { /* an auxiliary query with another body shape */ }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        rows: [{ [F.DIM_LABEL]: 'France', [F.MEASURE_LABEL]: 100, [`${F.MEASURE_LABEL} (avg)`]: 25 }],
        rowCount: 1,
      }),
    });
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/view/${twiceReportId}`);
  await page.locator('.widget-content').first().waitFor();

  await expect.poll(() => asked.length).toBeGreaterThan(0);
  expect(asked[asked.length - 1]).toEqual([F.MEASURE, VARIANT]);

  // Two columns, told apart by the aggregation each one carries.
  const shown = await page.locator('.widget-content').first().innerText();
  expect(shown).toContain(F.MEASURE_LABEL);
  expect(shown).toContain(`${F.MEASURE_LABEL} (avg)`);
  expect(shown).toContain('100');
  expect(shown).toContain('25');
});
