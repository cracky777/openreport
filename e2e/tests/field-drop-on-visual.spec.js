// A field dropped straight onto a visual lands in the right well.
//
// The rule that picks the well is unit-tested (utils/widgetFieldDrop); what
// only a browser can show is that the gesture reaches it at all — a native
// drag whose payload the page cannot read until the drop, an overlay that has
// to announce the destination while the field is still in the air, and a
// refetch that has to follow because the binding changed.
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const F = require('../fixtures');

const ids = () => JSON.parse(fs.readFileSync(F.IDS_FILE, 'utf8'));

// A native HTML5 drag, driven by the mouse so the page can be inspected while
// the field is still held.
async function grab(page, label) {
  const row = page.locator('[data-drag-field]', { hasText: label }).first();
  await expect(row).toBeVisible();
  const b = await row.boundingBox();
  await page.mouse.move(Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2));
  await page.mouse.down();
  await page.mouse.move(Math.round(b.x + b.width / 2) + 30, Math.round(b.y + b.height / 2) + 10, { steps: 4 });
}

async function moveOver(page, widget) {
  const b = await widget.boundingBox();
  const to = { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
  // Two moves: the first crosses into the visual, the second settles inside it.
  await page.mouse.move(to.x, to.y - 20, { steps: 6 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
}

test('a dimension dropped on a table becomes a column, and the table refetches', async ({ page }) => {
  const { tableReportId } = ids();
  const asked = [];
  await page.route('**/api/models/*/query', async (route) => {
    try { asked.push(JSON.parse(route.request().postData() || '{}').dimensionNames || []); } catch { /* another shape */ }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ rows: [{ [F.DIM_LABEL]: 'x', [F.SPARE_DIM_LABEL]: 'y', [F.MEASURE_LABEL]: 1 }], rowCount: 1 }),
    });
  });
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/edit/${tableReportId}`);
  const visual = page.locator('.widget-content').first();
  await expect(visual).toBeVisible();
  await page.waitForTimeout(1500);
  asked.length = 0;
  // The visual is not selected, so nothing on screen says "Columns" yet — what
  // appears during the drag can only be the overlay.
  await expect(page.getByText('Columns', { exact: true })).toHaveCount(0);

  await grab(page, F.SPARE_DIM_LABEL);
  await moveOver(page, visual);

  // Announced BEFORE the drop: the whole point is that the user knows where
  // the field is going while they can still change their mind.
  await expect(page.getByText('Columns', { exact: true }).first()).toBeVisible();
  await page.mouse.up();

  // The binding really changed — the server is asked for the new dimension.
  await expect.poll(() => asked.some((d) => d.includes(F.SPARE_DIM)), { timeout: 10000 }).toBe(true);
});

test('a dimension dropped on a slicer swaps the field it filters on', async ({ page }) => {
  const { reportId } = ids();
  const asked = [];
  await page.route('**/api/models/*/query', async (route) => {
    try { asked.push(JSON.parse(route.request().postData() || '{}').dimensionNames || []); } catch { /* another shape */ }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ rows: [{ [F.DIM_LABEL]: 'a', [F.SPARE_DIM_LABEL]: 'b' }], rowCount: 1 }),
    });
  });
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/edit/${reportId}`);
  // The slicer, not the scorecard: its well holds ONE field, so the drop has
  // to swap what is there rather than add next to it.
  const slicer = page.locator('.widget-content').nth(1);
  await expect(slicer).toBeVisible();
  await page.waitForTimeout(1500);
  asked.length = 0;

  await grab(page, F.SPARE_DIM_LABEL);
  await moveOver(page, slicer);
  await expect(page.getByText('Filter field', { exact: true }).first()).toBeVisible();
  await page.mouse.up();

  await expect.poll(() => asked.some((d) => d.includes(F.SPARE_DIM)), { timeout: 10000 }).toBe(true);
  // Swapped, not added: the column it filtered on before is gone.
  const last = asked[asked.length - 1];
  expect(last).not.toContain(F.DIM);
});

test('a visual with no well for the field says so instead of guessing', async ({ page }) => {
  const { reportId } = ids();
  const asked = [];
  await page.route('**/api/models/*/query', (route) => {
    try { asked.push(JSON.parse(route.request().postData() || '{}')); } catch { /* another shape */ }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ value: 7 }) });
  });
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/edit/${reportId}`);
  const card = page.locator('.widget-content').first();
  await expect(card).toBeVisible();
  await page.waitForTimeout(1500);

  // A scorecard reads a dimension only to compare two periods, so a plain
  // string column has nowhere to go. Silently filling the comparison slot with
  // it would produce a broken visual and no explanation.
  await grab(page, F.SPARE_DIM_LABEL);
  await moveOver(page, card);
  await expect(page.getByText('No slot for this field')).toBeVisible();
  await page.mouse.up();

  // Nothing was written: the refused field never reaches the server, in the
  // comparison slot or anywhere else.
  await page.waitForTimeout(800);
  expect(JSON.stringify(asked)).not.toContain(F.SPARE_DIM);
  // And the overlay clears on release rather than staying stuck over the visual.
  await expect(page.getByText('No slot for this field')).toHaveCount(0);
});
