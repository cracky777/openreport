// Compact app chrome. The journey ribbon sizes its column from the measured
// viewport, so whether a stage fits on a phone is a question only a real layout
// engine answers — and it is invisible on a desktop, which is exactly why it
// broke unnoticed.
//
// Without the fix the column is pinned to MIN_COLUMN (360) and inset by
// PEEK (96): it runs from x=96 to x=456 on a 390px screen, so a sixth of every
// stage sits off the right edge while the workspace picker overflows its own
// group and paints over the Explore/Alerts/Admin buttons.
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const F = require('../fixtures');

const ids = () => JSON.parse(fs.readFileSync(F.IDS_FILE, 'utf8'));
const PHONE = { width: 390, height: 800 };

const activePanel = (page) => page.locator('[data-stage-panel][aria-current="page"]');

// The ribbon positions itself from a measured width, so it passes through one
// pre-measurement frame on load. Poll rather than race it.
const settledBox = (page) => expect.poll(async () => {
  const b = await activePanel(page).boundingBox();
  return b ? Math.round(b.x) : null;
});

// The stage sits in the ribbon viewport, which reserves a stable scrollbar
// gutter — so "full width" means the viewport's width, not the window's.
const journeyWidth = (page) => page.evaluate(
  () => document.querySelector('[data-journey-ribbon]').parentElement.clientWidth,
);

test('on a phone the active stage fills the screen', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto('/');

  await settledBox(page).toBe(0);
  const [box, avail] = await Promise.all([activePanel(page).boundingBox(), journeyWidth(page)]);
  expect(Math.abs(box.width - avail)).toBeLessThanOrEqual(1);

  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollW).toBeLessThanOrEqual(PHONE.width);
});

test('on a phone the header controls stay clear of each other', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto('/');

  // The picker used to keep its full width and paint straight over these.
  const picker = await page.locator('header button', { hasText: 'My Reports' }).first().boundingBox();
  for (const name of ['Explore', 'Alerts', 'Admin']) {
    const btn = page.getByRole('button', { name, exact: true });
    await expect(btn).toBeVisible();
    const b = await btn.boundingBox();
    expect(b.x, `${name} starts past the right edge`).toBeLessThan(PHONE.width);
    expect(Math.round(b.x + b.width), `${name} runs off the right edge`).toBeLessThanOrEqual(PHONE.width);
    expect(b.x, `${name} sits under the workspace picker`).toBeGreaterThanOrEqual(picker.x + picker.width - 1);
    // A control the thumb has to hit.
    expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(36);
  }
});

test('on a desktop the peeking ribbon is untouched', async ({ page }) => {
  await page.goto('/');
  // The inset IS the design on a wide screen: it is what the neighbouring
  // stages show through, and what lets a join land on a real card. Compact
  // must not leak upwards and flatten it.
  await settledBox(page).toBe(96);
  const [box, avail] = await Promise.all([activePanel(page).boundingBox(), journeyWidth(page)]);
  expect(Math.round(box.width)).toBe(avail - 2 * 96);
  await expect(page.locator('[data-stage-panel][data-peek]')).not.toHaveCount(0);
});

test('on a phone the editor Save button is on screen', async ({ page }) => {
  const { reportId } = ids();
  await page.setViewportSize(PHONE);
  await page.goto(`/edit/${reportId}`);

  // Unreachable Save is the worst failure of the three: the work cannot be
  // committed at all. It sat a thousand pixels off the right edge.
  const save = page.getByRole('button', { name: /^Save/ });
  await expect(save).toBeVisible();
  const b = await save.boundingBox();
  expect(Math.round(b.x + b.width)).toBeLessThanOrEqual(PHONE.width);

  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollW).toBeLessThanOrEqual(PHONE.width);
});

test('on a phone a journey card fits its column', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto('/');
  await settledBox(page).toBe(0);

  // The cards carried `width: 760` inline, which no stylesheet rule could
  // override — so they hung out of a phone-sized column while the page below
  // them scrolled sideways. Both ends matter: the card must fit, and the
  // column must not have grown to accommodate it.
  const card = page.locator('[data-stage-panel][aria-current="page"] .journey-card').first();
  await expect(card).toBeVisible();
  const [box, avail] = await Promise.all([card.boundingBox(), journeyWidth(page)]);
  expect(box.width).toBeLessThanOrEqual(avail);
  expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width);

  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollW).toBeLessThanOrEqual(PHONE.width);
});

test('on a desktop a journey card keeps its 760px width', async ({ page }) => {
  await page.goto('/');
  await settledBox(page).toBe(96);
  // Fluid up to a cap: the cap is what reproduces the original card exactly.
  const card = page.locator('[data-stage-panel][aria-current="page"] .journey-card').first();
  await expect(card).toBeVisible();
  expect(Math.round((await card.boundingBox()).width)).toBe(760);
});
