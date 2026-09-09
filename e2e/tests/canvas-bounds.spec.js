// A widget may not be parked on the backdrop around the page.
//
// The canvas is a fixed page floating on the editor's background, and nothing
// stopped a drag at its edge: a widget pulled past the right or bottom margin
// stayed there, visible while authoring and gone from every export, since the
// print renderer and the small-screen stack only know about the page.
//
// Only a real browser can catch this: the limit is enforced by react-draggable
// (which keeps the slack between cursor and widget) and by the grid snapping
// that rounds the drop afterwards, neither of which exists in a unit test.
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const F = require('../fixtures');

const ids = () => JSON.parse(fs.readFileSync(F.IDS_FILE, 'utf8'));
const VIEWPORT = { width: 1280, height: 900 };
const FRAME = 'div[style*="position: absolute"]';

// The widget's box and the page it must stay inside, both in screen pixels —
// comparing them needs no knowledge of the canvas scale.
const boxes = (page) => page.evaluate((frame) => {
  const el = document.querySelector('.widget-content').closest(frame);
  const r = el.getBoundingClientRect();
  const p = el.parentElement.getBoundingClientRect();
  return {
    widget: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
    page: { left: p.left, top: p.top, right: p.right, bottom: p.bottom },
  };
}, FRAME);

const barVisible = (page) => page.evaluate(() => !!document.querySelector('[title="Send to back"]'));

async function openEditorWithSelection(page) {
  const { reportId } = ids();
  await page.route('**/api/models/*/query', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ rows: [], rowCount: 0 }),
  }));
  await page.setViewportSize(VIEWPORT);
  await page.goto(`/edit/${reportId}`);
  await page.locator('.widget-content').first().click({ position: { x: 30, y: 30 } });
  await expect.poll(() => barVisible(page)).toBe(true);
}

// A pixel of tolerance: the frame carries a 1px border, and the browser rounds
// its rect to fractions of a device pixel.
const TOL = 1.5;

test('a widget dragged past the page corner stops at it', async ({ page }) => {
  await openEditorWithSelection(page);
  const { widget } = await boxes(page);

  const gx = widget.left + (widget.right - widget.left) / 2;
  const gy = widget.top + 4; // the frame, not `.widget-content` — that one cancels the drag
  await page.mouse.move(gx, gy);
  await page.mouse.down();
  // Well past the bottom-right corner of the page, and of the window.
  await page.mouse.move(gx + 2000, gy + 1500, { steps: 25 });
  await page.mouse.up();

  const after = await boxes(page);
  expect(after.widget.right).toBeLessThanOrEqual(after.page.right + TOL);
  expect(after.widget.bottom).toBeLessThanOrEqual(after.page.bottom + TOL);
});

test('a widget dragged past the origin stops at it', async ({ page }) => {
  await openEditorWithSelection(page);
  const { widget } = await boxes(page);

  const gx = widget.left + (widget.right - widget.left) / 2;
  const gy = widget.top + 4;
  await page.mouse.move(gx, gy);
  await page.mouse.down();
  await page.mouse.move(gx - 2000, gy - 1500, { steps: 25 });
  await page.mouse.up();

  const after = await boxes(page);
  expect(after.widget.left).toBeGreaterThanOrEqual(after.page.left - TOL);
  expect(after.widget.top).toBeGreaterThanOrEqual(after.page.top - TOL);
});

test('the arrow keys stop at the page edge too', async ({ page }) => {
  await openEditorWithSelection(page);
  // Shift moves ten grid cells a press: enough to run off a 1140px page.
  for (let i = 0; i < 12; i++) await page.keyboard.press('Shift+ArrowRight');
  for (let i = 0; i < 8; i++) await page.keyboard.press('Shift+ArrowDown');

  const after = await boxes(page);
  expect(after.widget.right).toBeLessThanOrEqual(after.page.right + TOL);
  expect(after.widget.bottom).toBeLessThanOrEqual(after.page.bottom + TOL);
});

test('a widget resized past the page edge stops at it', async ({ page }) => {
  await openEditorWithSelection(page);
  const { widget } = await boxes(page);

  // East edge handle, dragged far beyond the page's right margin.
  await page.mouse.move(widget.right - 2, widget.top + (widget.bottom - widget.top) / 2);
  await page.mouse.down();
  await page.mouse.move(widget.right + 2000, widget.top + (widget.bottom - widget.top) / 2, { steps: 20 });
  await page.mouse.up();

  const after = await boxes(page);
  expect(after.widget.right).toBeLessThanOrEqual(after.page.right + TOL);
  // Still resized, not merely refused: the widget grew up to the margin.
  expect(after.widget.right).toBeGreaterThan(widget.right);
});
