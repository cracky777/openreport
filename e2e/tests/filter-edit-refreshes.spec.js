// Editing a widget's filter takes the same path as its Refresh button.
//
// The two are supposed to bring back the same rows, and they did not: the
// button refetches that widget with the server's result cache bypassed, while
// a rule edit went through the panel's own fetch without it. A visual could
// therefore keep the values of the rule before, and only a manual refresh put
// it right — which is exactly how the difference was noticed.
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const F = require('../fixtures');

const ids = () => JSON.parse(fs.readFileSync(F.IDS_FILE, 'utf8'));

test('a rule edit refetches that widget, cache bypassed, with the new rule', async ({ page }) => {
  const { tableReportId } = ids();
  const seen = [];
  await page.route('**/api/models/*/query', (route) => {
    try {
      const body = JSON.parse(route.request().postData() || '{}');
      const rules = (body.widgetFilters || []).filter((f) => f.op === 'top_n');
      if (rules.length > 0) seen.push({ bypass: body.bypassCache === true, n: String(rules[0].value) });
    } catch { /* an auxiliary query with another body shape */ }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ rows: [{ [F.DIM_LABEL]: 'x', [F.MEASURE_LABEL]: 1 }], rowCount: 1 }),
    });
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/edit/${tableReportId}`);
  await page.locator('.widget-content').first().click({ position: { x: 30, y: 30 } });
  const field = page.locator('input[placeholder="N (e.g. 10)"]');
  if (await field.count() === 0) await page.getByText('Filters', { exact: true }).first().click();
  await field.first().waitFor();
  await page.waitForTimeout(2500);

  seen.length = 0;
  await field.first().fill('3');
  await field.first().press('Enter');

  await expect.poll(() => seen.length).toBeGreaterThan(0);
  // Every query carries the NEW rule, and none of them may be answered from
  // the cache — the button's guarantee, now the edit's too.
  for (const q of seen) {
    expect(q.n).toBe('3');
    expect(q.bypass, 'the edit did not bypass the result cache').toBe(true);
  }
});
