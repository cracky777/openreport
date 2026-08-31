// Moving and resizing a widget on a canvas that is scaled to fit.
//
// The report is a fixed page (1280px by default) shrunk to the space the editor
// leaves it — `fitToWidth`, the default view mode — so the editor is ALWAYS
// scaled at ordinary window sizes. Pointer deltas are screen pixels, the layout
// is page pixels, and the two were treated as one: a gesture moved the widget by
// the raw distance, i.e. only `scale` of what the cursor did. The visual crawled
// behind the mouse, and on a long move the cursor left it behind entirely — so
// the click that ends the gesture landed on the canvas, which deselects, and the
// configuration bar vanished on drop.
//
// Both halves were needed. `scale` alone changed nothing measurable: the grid
// react-draggable enforces is in SCREEN pixels, applied to the raw delta before
// the scale is divided out, so a page-pixel grid rounded the correction away and
// the widget still advanced exactly the raw distance.
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const F = require('../fixtures');

const ids = () => JSON.parse(fs.readFileSync(F.IDS_FILE, 'utf8'));
// Narrow enough that the page has to be scaled down to fit. A wider window
// would test nothing: at scale 1 every unit agrees.
const SCALED = { width: 1280, height: 900 };

const FRAME = 'div[style*="position: absolute"]';

// The widget's own translate — page coordinates, which is what the layout
// stores. Immune to the canvas scrolling under it.
const pagePos = (page) => page.evaluate((frame) => {
  const m = new DOMMatrix(getComputedStyle(document.querySelector('.widget-content').closest(frame)).transform);
  return { x: m.e, y: m.f };
}, FRAME);

const pageWidth = (page) => page.evaluate((frame) => parseFloat(
  getComputedStyle(document.querySelector('.widget-content').closest(frame)).width,
), FRAME);

const canvasScale = (page) => page.evaluate((frame) => {
  let n = document.querySelector('.widget-content').closest(frame).parentElement;
  let s = 1;
  while (n) { const t = getComputedStyle(n).transform; if (t && t !== 'none') s *= new DOMMatrix(t).a; n = n.parentElement; }
  return s;
}, FRAME);

const frameBox = (page) => page.evaluate((frame) => {
  const r = document.querySelector('.widget-content').closest(frame).getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
}, FRAME);

const barVisible = (page) => page.evaluate(() => !!document.querySelector('[title="Send to back"]'));

async function openEditorWithSelection(page) {
  const { reportId } = ids();
  await page.route('**/api/models/*/query', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ rows: [], rowCount: 0 }),
  }));
  await page.setViewportSize(SCALED);
  await page.goto(`/edit/${reportId}`);
  await page.locator('.widget-content').first().click({ position: { x: 30, y: 30 } });
  await expect.poll(() => barVisible(page)).toBe(true);
  const scale = await canvasScale(page);
  // Guard the guard: if the canvas ever stops scaling here, these tests would
  // pass on a bug.
  expect(scale).toBeLessThan(0.95);
  return scale;
}

test('a dragged widget travels as far as the cursor', async ({ page }) => {
  const scale = await openEditorWithSelection(page);
  const before = await pagePos(page);
  const box = await frameBox(page);

  const [SX, SY] = [300, 100]; // screen pixels
  const gx = box.x + box.w / 2;
  const gy = box.y + 4; // the frame, not `.widget-content` — that one cancels the drag
  await page.mouse.move(gx, gy);
  await page.mouse.down();
  await page.mouse.move(gx + SX, gy + SY, { steps: 20 });
  await page.mouse.up();

  const after = await pagePos(page);
  const GRID = 20; // one snap cell of tolerance, in page pixels
  expect(Math.abs((after.x - before.x) - SX / scale)).toBeLessThanOrEqual(GRID);
  expect(Math.abs((after.y - before.y) - SY / scale)).toBeLessThanOrEqual(GRID);
});

test('a widget stays selected after being moved', async ({ page }) => {
  await openEditorWithSelection(page);
  const box = await frameBox(page);
  const gx = box.x + box.w / 2;
  const gy = box.y + 4;

  // Far enough that a widget lagging the cursor would be left behind it.
  await page.mouse.move(gx, gy);
  await page.mouse.down();
  await page.mouse.move(gx + 520, gy + 120, { steps: 20 });
  await page.mouse.up();

  await expect.poll(() => barVisible(page)).toBe(true);
});

test('a resized widget follows its handle', async ({ page }) => {
  const scale = await openEditorWithSelection(page);
  const before = await pageWidth(page);
  const box = await frameBox(page);

  const DX = 120; // screen pixels
  await page.mouse.move(box.x + box.w - 2, box.y + box.h / 2); // east edge handle
  await page.mouse.down();
  await page.mouse.move(box.x + box.w - 2 + DX, box.y + box.h / 2, { steps: 12 });
  await page.mouse.up();

  const after = await pageWidth(page);
  expect(Math.abs((after - before) - DX / scale)).toBeLessThanOrEqual(20);
});
