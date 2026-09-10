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
  const seen = { served: 0, cancelled: 0, aborted: 0 };
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
    } catch { seen.aborted += 1; }
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
  seen.aborted = 0;
  // Deselecting for real: the click has to land on the canvas behind the page,
  // and the proof is the per-widget controls going away. A click that misses is
  // what let an earlier version of these tests pass on a broken build.
  const deselect = async () => {
    await page.mouse.click(300, 700);
    await expect.poll(() => page.locator("[title*='Refresh this widget']").count(), { timeout: 5000 }).toBe(0);
  };
  return { seen, field: field.first(), deselect, shown: () => page.locator('.widget-content').first().innerText() };
}

test('deselecting the widget does not cancel its refresh', async ({ page }) => {
  const { seen, field, shown, deselect } = await editorWithSlowQueries(page);
  await field.fill('4');
  await field.press('Enter');
  await page.waitForTimeout(400);
  await deselect();

  // The answer has to LAND, not merely be fetched: gating the commit on the
  // widget still being selected threw it away at the last step, which read as
  // a refresh that never happened.
  // The displayed answer must ADVANCE. Pinning it to the last request number
  // would race: one edit can legitimately fire two queries (the panel's and
  // the editor loop's), and either may be the one that lands last.
  const displayed = async () => {
    const m = (await shown()).match(/answer-(\d+)/);
    return m ? Number(m[1]) : 0;
  };
  await expect.poll(displayed, { timeout: 15000 }).toBeGreaterThan(0);
  expect(seen.cancelled, 'the refresh was cancelled by the deselection').toBe(0);
  expect(seen.aborted, 'a request was aborted by the deselection').toBe(0);
});

test('the answer of a widget refresh lands after the widget is deselected', async ({ page }) => {
  const { seen, shown, deselect } = await editorWithSlowQueries(page);
  const before = seen.served;
  // The per-widget Refresh button, NOT a binding edit: nothing about the
  // binding changes, so the editor's own loop has no reason to pick the widget
  // up. Only the panel's fetch can bring this answer back — which is exactly
  // the path that used to drop it once the widget was no longer selected.
  await page.locator('[title]').filter({ has: page.locator('svg') })
    .and(page.locator("[title*='Refresh this widget']")).first()
    .click();
  await page.waitForTimeout(400);
  await deselect();

  // The number in the answer says WHICH query is on screen: the widget already
  // showed one before the refresh, so "an answer is displayed" proves nothing.
  const displayed = async () => {
    const m = (await shown()).match(/answer-(\d+)/);
    return m ? Number(m[1]) : 0;
  };
  await expect.poll(displayed, { timeout: 15000 }).toBeGreaterThanOrEqual(before + 1);
  expect(seen.cancelled).toBe(0);
  // Nothing was cut mid-flight either: an aborted request is what the refresh
  // dying on deselection actually looked like.
  expect(seen.aborted, 'a request was aborted by the deselection').toBe(0);
});

test('the loading indicator keeps turning after the widget is deselected', async ({ page }) => {
  const { seen, shown, deselect } = await editorWithSlowQueries(page);
  const before = seen.served;
  // The spinner doubles as the cancel button, which is how it is found here.
  const spinner = page.locator("[title*='Cancel']");
  await page.locator("[title*='Refresh this widget']").first().click();
  await expect.poll(() => spinner.count(), { timeout: 5000 }).toBeGreaterThan(0);

  await deselect();
  // An indicator that goes out while the query is still running is what made
  // the refresh look like it had died — and the query really did die when the
  // same wake-up cleared the debounce before the request left.
  expect(await spinner.count(), 'the loading indicator went out on deselection').toBeGreaterThan(0);

  const displayed = async () => {
    const m = (await shown()).match(/answer-(\d+)/);
    return m ? Number(m[1]) : 0;
  };
  await expect.poll(displayed, { timeout: 15000 }).toBeGreaterThanOrEqual(before + 1);
  expect(seen.aborted).toBe(0);
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
