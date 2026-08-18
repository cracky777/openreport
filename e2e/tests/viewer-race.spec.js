// Guards the lot-4 fix in Viewer: the per-widget fetch had no ordering, so a
// slow response for the previous filter landed after the fast one for the
// current filter and overwrote it — the chart showed a selection the user had
// already moved off.
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const F = require('../fixtures');

const SLOW_MS = 1500;

test('the last filter picked is the one displayed', async ({ page }) => {
  const { reportId } = JSON.parse(fs.readFileSync(F.IDS_FILE, 'utf8'));

  await page.route('**/api/models/*/query', async (route) => {
    const body = route.request().postData() || '';
    const json = (rows) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ rows, rowCount: rows.length }),
    });
    // The slicer's own DISTINCT query — the values it offers.
    if (/"distinct"\s*:\s*true/.test(body)) {
      return json([{ [F.DIM_LABEL]: 'FR' }, { [F.DIM_LABEL]: 'DE' }]);
    }
    // Selecting DE adds to the selection, so the second round carries both.
    // Test it first: it is the round that must win.
    if (body.includes('DE')) return json([{ [F.MEASURE_LABEL]: 222 }]);
    if (body.includes('FR')) {
      // The stale round, deliberately overtaken.
      await new Promise((r) => setTimeout(r, SLOW_MS));
      return json([{ [F.MEASURE_LABEL]: 111 }]);
    }
    return json([{ [F.MEASURE_LABEL]: 0 }]);
  });

  await page.goto(`/view/${reportId}`);
  const fr = page.getByRole('button', { name: 'FR', exact: true });
  const de = page.getByRole('button', { name: 'DE', exact: true });
  await expect(fr).toBeVisible();
  await expect(page.getByText('0', { exact: true })).toBeVisible();

  await fr.click();
  await de.click();

  // Wait past the slow round: if the guard is gone, 111 lands here and wins.
  await page.waitForTimeout(SLOW_MS + 1500);

  await expect(page.getByText('222', { exact: true })).toBeVisible();
  await expect(page.getByText('111', { exact: true })).toHaveCount(0);
});
