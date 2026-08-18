// Guards the lot-4 fix in Editor: the /cache-schedules/warming poll effect
// depended on the whole `history` object. Every layout mutation changes its
// identity, so the effect was torn down and re-run — one GET per resize gesture,
// one per frame of a drag. It now reads history through a ref and depends on
// [id] alone.
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const F = require('../fixtures');

test('resizing a widget fires no cache-warming requests', async ({ page }) => {
  const { reportId } = JSON.parse(fs.readFileSync(F.IDS_FILE, 'utf8'));

  let warmingCalls = 0;
  await page.route('**/api/cache-schedules/warming*', (route) => {
    warmingCalls += 1;
    // Idle: the poll loop stops instead of re-arming, so anything counted after
    // the page settles came from a remount.
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ reportIds: [], progress: {} }),
    });
  });
  await page.route('**/api/models/*/query', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ rows: [{ [F.MEASURE_LABEL]: 1 }], rowCount: 1 }),
  }));

  await page.goto(`/edit/${reportId}`);
  await expect(page.getByPlaceholder('Report title')).toHaveValue('Rapport e2e');
  // Let the mount-time poll land before the count matters.
  await page.waitForTimeout(1500);
  const atRest = warmingCalls;

  // Handles only exist on the selected widget.
  const widget = page.locator('.widget-content').first();
  await widget.click();
  const handle = page.locator('.resize-handle').nth(7); // south-east corner
  await expect(handle).toBeVisible();

  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  // Several moves on purpose: the bug fired once per frame, so a single-step
  // drag would have understated it.
  for (let i = 1; i <= 12; i += 1) {
    await page.mouse.move(box.x + box.width / 2 + i * 8, box.y + box.height / 2 + i * 4);
  }
  await page.mouse.up();
  await page.waitForTimeout(1500);

  expect(warmingCalls - atRest,
    `a resize gesture triggered ${warmingCalls - atRest} /warming request(s)`).toBe(0);
});
