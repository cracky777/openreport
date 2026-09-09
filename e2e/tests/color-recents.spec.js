// Picking one of the recent colours must apply THAT colour, and file nothing else.
//
// The hex field is autofocused, so clicking a swatch blurs it first. The blur
// handler filed whatever the field held — the colour the picker had opened on —
// which pushed that colour to the head of the recents. The list then reordered
// under the cursor between the mousedown and the click, so the click landed on
// no button at all: the swatch the user aimed at was never applied, and an
// unwanted colour had been recorded.
//
// Focus and event ordering exist only in a browser; nothing below the DOM can
// see this.
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const F = require('../fixtures');

const ids = () => JSON.parse(fs.readFileSync(F.IDS_FILE, 'utf8'));
const SEEDED = ['#111111', '#222222', '#333333', '#444444'];
const STORE = 'openreport.recentColors';

const recents = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '[]'), STORE);
// The hex field mirrors the colour the picker currently holds.
const shown = (page) => page.evaluate(() => document.querySelector('input[value^="#"]')?.value);

async function openPicker(page) {
  const { reportId } = ids();
  await page.route('**/api/models/*/query', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ rows: [], rowCount: 0 }),
  }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/edit/${reportId}`);
  await page.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [STORE, SEEDED]);
  await page.reload();
  await page.locator('.widget-content').first().click({ position: { x: 30, y: 30 } });
  // Container > Background: it opens on white, so a colour wrongly filed on
  // blur is unmistakable in the list. The section remembers whether it was
  // left open, so it is unfolded only when its controls are absent.
  const swatch = page.locator('[aria-label="Pick a color"]').last();
  if (await swatch.count() === 0) await page.getByText('Container', { exact: true }).first().click();
  await swatch.click();
  await expect.poll(() => shown(page)).toBe('#ffffff');
}

test('clicking a recent colour applies it and files nothing else', async ({ page }) => {
  await openPicker(page);
  // The last one: the furthest from the head, so any insertion shifts it.
  const swatches = page.locator('[aria-label^="Use #"]');
  await swatches.nth(await swatches.count() - 1).click();

  expect(await shown(page)).toBe('#444444');
  // Moved to the head, and the white the picker opened on is nowhere in it.
  expect(await recents(page)).toEqual(['#444444', '#111111', '#222222', '#333333']);
});

test('a hex typed by hand is remembered when the picker is closed', async ({ page }) => {
  await openPicker(page);
  await page.locator('input[value^="#"]').first().fill('#0f9d58');
  // Clicking away unmounts the popover on mousedown, so the field's blur never
  // dispatches — the draft has to be committed on the way out.
  await page.mouse.click(700, 500);

  expect((await recents(page))[0]).toBe('#0f9d58');
});
