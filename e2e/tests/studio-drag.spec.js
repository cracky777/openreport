// The author moves a visual by hand on the studio's page (asked by Jonathan:
// not everything goes through the assistant). The canvas there edits the
// layout only; the gesture lands in the working copy as one undo step, and
// Save writes it. Only a browser holds the chain: the drag, the viewer's own
// page state, the working copy, the save.
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const F = require('../fixtures');

const ids = () => JSON.parse(fs.readFileSync(F.IDS_FILE, 'utf8'));
const FRAME = 'div[style*="position: absolute"]';

test('a visual dragged on the studio page moves in the working copy, is undone, redone, and written by Save', async ({ page }) => {
  const { tableReportId } = ids();
  const saved = async () => (await (await page.request.get(`/api/reports/${tableReportId}`)).json()).report;
  const before = await saved();
  try {
    await page.route('**/api/models/*/query', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ rows: [{ [F.DIM_LABEL]: 'France', [F.MEASURE_LABEL]: 100 }], rowCount: 1 }),
    }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/studio/${tableReportId}`);
    await page.locator('.widget-content').first().waitFor();
    const layoutOf = async () => (await saved()).settings.pages[0].layout;
    const [first] = await layoutOf();

    // Grab the frame's top strip (the content area cancels a drag), move it right and down.
    const box = await page.evaluate((frame) => {
      const r = document.querySelector('.widget-content').closest(frame).getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width };
    }, FRAME);
    const gx = box.left + box.width / 2;
    const gy = box.top + 4;
    await page.mouse.move(gx, gy);
    await page.mouse.down();
    await page.mouse.move(gx + 120, gy + 160, { steps: 15 });
    await page.mouse.up();

    // In hand: the page shows it moved, the report is not written.
    const moved = await page.evaluate((frame) => document.querySelector('.widget-content').closest(frame).getBoundingClientRect().top, FRAME);
    expect(moved).toBeGreaterThan(box.top + 100);
    expect((await layoutOf())[0]).toEqual(first);
    const save = page.getByRole('button', { name: 'Save', exact: true });
    await expect(save).toBeEnabled();

    // One undo step: back, then forward.
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => page.evaluate((frame) => document.querySelector('.widget-content').closest(frame).getBoundingClientRect().top, FRAME)).toBeLessThan(box.top + 20);
    await page.getByRole('button', { name: 'Redo' }).click();
    await expect.poll(() => page.evaluate((frame) => document.querySelector('.widget-content').closest(frame).getBoundingClientRect().top, FRAME)).toBeGreaterThan(box.top + 100);

    await save.click();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    const [after] = await layoutOf();
    expect(after.i).toBe(first.i);
    expect(after.y).toBeGreaterThan(first.y + 100);
    expect(after.x).toBeGreaterThan(first.x + 80);
  } finally {
    await page.request.put(`/api/reports/${tableReportId}`, { data: { title: before.title, layout: before.layout, widgets: before.widgets, settings: before.settings } });
  }
});
