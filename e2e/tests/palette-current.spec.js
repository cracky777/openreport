// Selecting a visual lights up the palette button it was made from, as Power
// BI does, so the user can tell what a visual is — and which button changes it.
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const F = require('../fixtures');

const ids = () => JSON.parse(fs.readFileSync(F.IDS_FILE, 'utf8'));

test('the selected visual marks its palette button, and only that one', async ({ page }) => {
  const { reportId } = ids();
  await page.route('**/api/models/*/query', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ value: 7 }),
  }));
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/edit/${reportId}`);
  const card = page.getByRole('button', { name: 'Add Scorecard' });
  const filter = page.getByRole('button', { name: 'Add Filter' });
  await expect(card).toHaveAttribute('aria-pressed', 'false');

  // The fixture: a scorecard, then a slicer.
  await page.locator('.widget-content').first().click({ position: { x: 30, y: 30 } });
  await expect(card).toHaveAttribute('aria-pressed', 'true');
  await expect(filter).toHaveAttribute('aria-pressed', 'false');

  await page.locator('.widget-content').nth(1).click({ position: { x: 30, y: 30 } });
  await expect(filter).toHaveAttribute('aria-pressed', 'true');
  await expect(card).toHaveAttribute('aria-pressed', 'false');
  // A hover leaves it marked: the mouse-out must not wipe the highlight.
  await filter.hover();
  await page.mouse.move(5, 500);
  await expect(filter).toHaveCSS('background-color', /rgb/);
  await expect(filter).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
});
