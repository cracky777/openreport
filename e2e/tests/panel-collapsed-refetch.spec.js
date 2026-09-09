// Editing a widget's binding must refetch, whether or not the Data panel is open.
//
// The Data panel owns the ONLY fetch loop that reacts to a widget's own binding
// — the editor's main loop watches the report filters and the refresh counter,
// never a binding. Collapsing the panel unmounted that loop, so every edit made
// from the property panel next door (a Top N, a row limit, a measure filter)
// changed the SQL and refetched nothing: the visual kept showing the previous
// answer until an explicit refresh, which is what made it look like the values
// of the previous query had leaked into the table.
//
// Only a browser can catch this: it is a mounted/unmounted component owning an
// effect, and the symptom is the ABSENCE of a request.
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const F = require('../fixtures');

const ids = () => JSON.parse(fs.readFileSync(F.IDS_FILE, 'utf8'));

// Each response echoes the Top N it was asked for, so what the table shows
// names the query it is showing — a stale visual is unambiguous.
async function openTableEditor(page) {
  const { tableReportId } = ids();
  let queries = 0;
  await page.route('**/api/models/*/query', (route) => {
    queries++;
    let n = 'none';
    try {
      const body = JSON.parse(route.request().postData() || '{}');
      const f = (body.widgetFilters || []).find((x) => x.op === 'top_n');
      if (f) n = f.value === '' ? 'unset' : String(f.value);
    } catch { /* not the main query body — the echo just stays 'none' */ }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ rows: [{ Country: `N=${n}`, Sales: 1 }], rowCount: 1 }),
    });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/edit/${tableReportId}`);
  await page.locator('.widget-content').first().click({ position: { x: 30, y: 30 } });
  const nInput = page.locator('input[placeholder="N (e.g. 10)"]');
  if (await nInput.count() === 0) await page.getByText('Filters', { exact: true }).first().click();
  await nInput.first().waitFor();
  return {
    nInput: nInput.first(),
    // The field commits when it is left, not on each keystroke — Enter is the
    // keyboard way out.
    commit: () => nInput.first().press('Enter'),
    shown: () => page.locator('.widget-content').first().innerText(),
  };
}

test('typing the N refetches with the panel open', async ({ page }) => {
  const { nInput, shown, commit } = await openTableEditor(page);
  await nInput.fill('5');
  await commit();
  await expect.poll(shown).toContain('N=5');
});

test('typing the N refetches with the panel collapsed', async ({ page }) => {
  const { nInput, shown, commit } = await openTableEditor(page);
  await nInput.fill('5');
  await commit();
  await expect.poll(shown).toContain('N=5');

  await page.click('[title="Collapse panel"]');
  await nInput.fill('9');
  await commit();
  await expect.poll(shown).toContain('N=9');
});

test('the click that deselects the widget still commits and refetches', async ({ page }) => {
  const { nInput, shown } = await openTableEditor(page);
  // The natural gesture: type the N, then click the report to see the result.
  // That one click commits the field AND unmounts the panel that was about to
  // fetch — the visual used to keep showing the previous answer.
  await nInput.fill('7');
  await page.mouse.click(700, 800);
  await expect.poll(shown).toContain('N=7');
});
