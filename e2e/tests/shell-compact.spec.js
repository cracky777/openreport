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

// The compact editor. Its toolbar needs ~1300px on one row and its two side
// panels are sized for a desktop column, so on a phone the bar swallowed a
// quarter of the screen and each panel was about half a screen wide.
const editorToolbarHeight = (page) => page.evaluate(
  () => Math.round(document.querySelector('#root > div > div').getBoundingClientRect().height),
);

test('on a phone the editor toolbar stays out of the way', async ({ page }) => {
  const { reportId } = ids();
  await page.setViewportSize(PHONE);
  await page.goto(`/edit/${reportId}`);
  await expect(page.getByRole('button', { name: /^Save/ })).toBeVisible();

  // Wrapped in full it measured 233px of an 844px screen. The palette — the
  // bulk of it — now sits behind a toggle.
  expect(await editorToolbarHeight(page)).toBeLessThanOrEqual(140);
  const toggle = page.locator('button[aria-expanded]').first();
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  // Folded away, not removed: opening it must reveal the widget types.
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(await editorToolbarHeight(page)).toBeGreaterThan(140);
  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollW).toBeLessThanOrEqual(PHONE.width);
});

test('on a phone the editor panels get the whole sheet', async ({ page }) => {
  const { reportId } = ids();
  await page.setViewportSize(PHONE);
  await page.goto(`/edit/${reportId}`);

  const sheet = page.locator('[data-editor-sheet]');
  await expect(sheet).toHaveCount(1);

  // Selecting a widget is what raises the sheet.
  await page.locator('.widget-content').first().click({ position: { x: 10, y: 10 } });
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Data', exact: true })).toBeVisible();

  // One panel at a time, full width — not two panels of ~210px sharing 390.
  const box = await sheet.boundingBox();
  expect(Math.round(box.width)).toBe(PHONE.width);
  // The panel itself, not the pane that holds it: the pane is full width
  // whatever is inside, so measuring it would pass even with the panels back
  // at their desktop 210/220.
  const widest = await page.evaluate(() => Math.max(
    ...[...document.querySelectorAll('[data-editor-sheet] > div > div')]
      .map((d) => Math.round(d.getBoundingClientRect().width)),
  ));
  expect(widest).toBeGreaterThan(300);
});

test('on a wide desktop the editor toolbar is still one row', async ({ page }) => {
  const { reportId } = ids();
  // Explicit: this toolbar needs ~1440px for a single row, so the width has to
  // be stated rather than inherited from the runner's default.
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/edit/${reportId}`);
  await expect(page.getByRole('button', { name: /^Save/ })).toBeVisible();
  expect(await editorToolbarHeight(page)).toBeLessThanOrEqual(70);
  // The palette is laid out flat, with no toggle to hide it, and the side
  // panels sit beside the canvas rather than in a sheet.
  await expect(page.locator('button[aria-expanded]')).toHaveCount(0);
  await expect(page.locator('[data-editor-sheet]')).toHaveCount(0);
});

test('on a laptop the editor Save button is on screen', async ({ page }) => {
  const { reportId } = ids();
  // An invariant, not a regression: a single row wants ~1440px, so a 1366
  // laptop is the width where the bar starts having to give — by wrapping now,
  // by squeezing its controls before. Either way Save stays reachable.
  const LAPTOP = { width: 1366, height: 768 };
  await page.setViewportSize(LAPTOP);
  await page.goto(`/edit/${reportId}`);

  const save = page.getByRole('button', { name: /^Save/ });
  await expect(save).toBeVisible();
  const b = await save.boundingBox();
  expect(Math.round(b.x + b.width)).toBeLessThanOrEqual(LAPTOP.width);

  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollW).toBeLessThanOrEqual(LAPTOP.width);
});

// Dragging a field with a finger. The panels use HTML5 drag-and-drop, which no
// mobile browser fires from a touch — so on a phone a field could not be moved
// at all. utils/touchDrag replays the contract over pointer events, and because
// the sheet shows one panel at a time, lifting a field in Data has to bring
// Settings — where the drop zones live — forward under the finger.
//
// Only a browser can answer this: it turns on pointer event sequencing, a
// long-press timer, and hit-testing with elementFromPoint.
// Real touch input, through the browser, NOT dispatched PointerEvents.
//
// The difference is the whole point of this test. A synthetic PointerEvent
// bypasses the two browser behaviours that actually broke this feature: the
// implicit pointer capture on the element the finger went down on, and the
// browser deciding mid-gesture that a drag is a scroll and answering with
// `pointercancel`. Dispatched events cannot reproduce either, so a spec built
// on them passes against code that fails on a real phone.
const finger = (cdp, type, x, y) => cdp.send('Input.dispatchTouchEvent', {
  type,
  touchPoints: type === 'touchEnd' ? [] : [{ x: Math.round(x), y: Math.round(y), id: 1 }],
});

const activeSheetTab = (page) => page.evaluate(() => {
  const t = [...document.querySelectorAll('[data-editor-sheet] button')].find((b) => b.getAttribute('aria-current'));
  return t ? t.textContent : null;
});

test('on a phone a field can be dragged into a zone with one finger', async ({ page, context }) => {
  const { reportId } = ids();
  const cdp = await context.newCDPSession(page);
  await page.setViewportSize(PHONE);
  await page.goto(`/edit/${reportId}`);

  // The slicer's zone takes dimensions, and City is bound to nothing.
  await page.locator('.widget-content').nth(1).click({ position: { x: 10, y: 10 } });
  await expect(page.getByRole('button', { name: 'Data', exact: true })).toBeVisible();

  const zoneBefore = await page.evaluate(() => {
    const z = [...document.querySelectorAll('[data-touch-drop]')].find((d) => d.getBoundingClientRect().height > 0);
    return z ? z.innerText : '';
  });
  expect(zoneBefore).not.toContain(F.SPARE_DIM_LABEL);

  await page.getByRole('button', { name: 'Data', exact: true }).click();
  expect(await activeSheetTab(page)).toBe('Data');

  const row = page.locator('[data-editor-sheet] [draggable="true"]', { hasText: F.SPARE_DIM_LABEL }).first();
  await expect(row).toBeVisible();
  const from = await row.boundingBox();

  // A press is a scroll until it has held still, so the drag only begins after
  // the long-press delay.
  const fromX = from.x + from.width / 2;
  const fromY = from.y + from.height / 2;
  await finger(cdp, 'touchStart', fromX, fromY);
  await expect.poll(() => activeSheetTab(page)).toBe('Settings');

  const zone = await page.evaluate(() => {
    const z = [...document.querySelectorAll('[data-touch-drop]')].find((d) => d.getBoundingClientRect().height > 0);
    const r = z.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  });
  // Travel in steps, the way a finger does — one jump would not give the
  // browser the chance to mistake the drag for a pan.
  for (let i = 1; i <= 5; i += 1) {
    await finger(cdp, 'touchMove', fromX + ((zone.x - fromX) * i) / 5, fromY + ((zone.y - fromY) * i) / 5);
  }
  // The gesture must still be ours: a cancelled pointer means the browser took
  // it for scrolling and the ghost died halfway.
  expect(await page.evaluate(() => [...document.body.children].some((c) => c.style && c.style.zIndex === '10000')))
    .toBe(true);
  await finger(cdp, 'touchEnd', zone.x, zone.y);

  // The field landed, and the ghost that followed the finger is gone.
  await expect.poll(async () => page.evaluate(() => {
    const z = [...document.querySelectorAll('[data-touch-drop]')].find((d) => d.getBoundingClientRect().height > 0);
    return z ? z.innerText : '';
  })).toContain(F.SPARE_DIM_LABEL);
  expect(await page.evaluate(() => [...document.body.children].some((c) => c.style && c.style.zIndex === '10000'))).toBe(false);
});

// NOT COVERED HERE: reordering a chip WITHIN a zone by touch.
//
// The behaviour is fixed and was verified by driving real touch input against a
// running editor — three moves (last to top, first to bottom, and one into the
// middle), plus an instrumented run confirming the insertion index the zone
// receives. What would not land is the automated guard: CDP touch coordinates
// and getBoundingClientRect disagree by roughly 9% once the spec resizes a
// viewport or turns on mobile emulation, so the press repeatedly opened on the
// wrong element — a harness problem that produced a red test about a green
// feature. The external drop above exercises the same drag layer end to end;
// the missing piece is only the in-zone insertion index.
