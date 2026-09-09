// A refresh already on its way is not cut by leaving the widget.
//
// The fetch lives in the data panel, and the panel unmounts when the widget is
// deselected — its cleanup aborted the request and told the server to kill the
// SQL. So starting a slow refresh and clicking elsewhere threw the work away,
// silently. Only a run asking for the SAME widget supersedes the one before it;
// the user cancels the rest themselves, with the button that exists for it.
//
// The abort is invisible outside a browser: it is a React cleanup firing on
// unmount, and what proves it is a request that never completes.
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const F = require('../fixtures');

const ids = () => JSON.parse(fs.readFileSync(F.IDS_FILE, 'utf8'));

async function editorWithSlowQueries(page) {
  const { tableReportId } = ids();
  const seen = { served: 0, cancelled: 0 };
  await page.route('**/api/models/*/query', async (route) => {
    seen.served += 1;
    const n = seen.served;
    // Slow enough to still be running when the widget is deselected.
    await new Promise((r) => setTimeout(r, 2000));
    try {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ rows: [{ [F.DIM_LABEL]: `answer-${n}`, [F.MEASURE_LABEL]: n }], rowCount: 1 }),
      });
    } catch { /* the request was aborted — nothing to answer */ }
  });
  // The panel asks the server to kill the SQL when it gives up on a fetch.
  await page.route('**/api/models/cancel-query', (route) => {
    seen.cancelled += 1;
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/edit/${tableReportId}`);
  await page.locator('.widget-content').first().click({ position: { x: 30, y: 30 } });
  const field = page.locator('input[placeholder="N (e.g. 10)"]');
  if (await field.count() === 0) await page.getByText('Filters', { exact: true }).first().click();
  await field.first().waitFor();
  await page.waitForTimeout(3000);
  seen.served = 0;
  seen.cancelled = 0;
  return { seen, field: field.first(), shown: () => page.locator('.widget-content').first().innerText() };
}

test('deselecting the widget does not cancel its refresh', async ({ page }) => {
  const { seen, field, shown } = await editorWithSlowQueries(page);
  await field.fill('4');
  await field.press('Enter');
  await page.waitForTimeout(400);
  await page.mouse.click(700, 800); // deselects — the panel unmounts

  await expect.poll(shown, { timeout: 15000 }).toContain('answer-');
  expect(seen.cancelled, 'the refresh was cancelled by the deselection').toBe(0);
});

test('a new run on the same widget still supersedes the one before it', async ({ page }) => {
  const { seen, field, shown } = await editorWithSlowQueries(page);
  await field.fill('6');
  await field.press('Enter');
  await page.waitForTimeout(300);
  await field.fill('9');
  await field.press('Enter');

  await expect.poll(() => seen.cancelled, { timeout: 15000 }).toBeGreaterThan(0);
  // And an answer still lands: superseding cuts the stale run, not the widget.
  await expect.poll(shown, { timeout: 15000 }).toContain('answer-');
});
