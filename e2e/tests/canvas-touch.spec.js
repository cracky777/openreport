// The report canvas under a finger.
//
// react-draggable cancels `touchstart` on everything it can drag. On a phone
// that meant every visual was a trap: a swipe meant to scroll the page dragged
// the visual under it instead, and the cancelled touch never became a click, so
// a tap could not select anything — the settings sheet never opened. The
// resize handles listened to the mouse only and measured ~3px once the page was
// scaled to fit the screen.
//
// Now a finger only moves a visual it has selected first, and resizes it by
// round grips sized in screen pixels. A desktop keeps the mouse path untouched,
// which the last test holds.
//
// Real touch input through CDP, paced like a finger: dispatched PointerEvents
// skip the browser's own arbitration between scroll, drag and click, which is
// precisely what broke here. Moves are paced, or they read as a fling.
//
// Never tap right after a swipe here: under CDP emulation Chrome drops the
// click of such a tap about one time in three — on a blank page too, so it is
// the harness and not the editor. The swipe over an unselected visual is
// therefore checked last, on a second visual.
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const F = require('../fixtures');

const ids = () => JSON.parse(fs.readFileSync(F.IDS_FILE, 'utf8'));

const fingerOf = (page, cdp) => async (type, x, y) => {
  if (type === 'touchMove') await page.waitForTimeout(16);
  await cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: type === 'touchEnd' ? [] : [{ x: Math.round(x), y: Math.round(y), id: 1 }],
  });
};

const swipe = async (page, finger, from, dx, dy) => {
  await finger('touchStart', from.x, from.y);
  for (let i = 1; i <= 8; i += 1) await finger('touchMove', from.x + (dx * i) / 8, from.y + (dy * i) / 8);
  await finger('touchEnd');
  // A finger lifts before it lands again; a gesture fired the same instant
  // lands in the tail of this one.
  await page.waitForTimeout(500);
};

// A report of its own: the seeded one is rearranged by the specs before this.
// Titles are unique per workspace, and a run can repeat.
async function ownReport(request, name) {
  const { modelId } = ids();
  const title = `${name} ${Date.now()}`;
  const created = await request.post('/api/reports', { data: { title, modelId } });
  const reportId = (await created.json()).report.id;
  const widgets = {
    'w-touch': { type: 'bar', config: {}, dataBinding: {} },
    'w-other': { type: 'bar', config: {}, dataBinding: {} },
  };
  const layout = [
    { i: 'w-touch', x: 40, y: 40, w: 400, h: 240 },
    // Clear of where the first one is moved and grown to.
    { i: 'w-other', x: 40, y: 560, w: 200, h: 200 },
  ];
  await request.put(`/api/reports/${reportId}`, {
    data: { title, settings: {}, layout, widgets, pages: [{ id: 'page-1', name: 'Page 1', layout, widgets }] },
  });
  return reportId;
}

const center = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

test.describe('on a touch phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('a visual is tapped to select, then moved and resized with a finger', async ({ page, context, request }) => {
    const reportId = await ownReport(request, 'Rapport e2e tactile');
    const finger = fingerOf(page, await context.newCDPSession(page));
    await page.goto(`/edit/${reportId}`);

    const frame = page.locator('[data-touch-drop="visual"]').first();
    const other = page.locator('[data-touch-drop="visual"]').nth(1);
    await expect(frame).toBeVisible();
    const start = await frame.boundingBox();

    // A tap selects: the settings sheet rises.
    const settings = page.getByRole('button', { name: 'Settings', exact: true });
    await expect(settings).toHaveCount(0);
    await finger('touchStart', start.x + 10, start.y + 10);
    await finger('touchEnd');
    await expect(settings).toBeVisible();

    // Selected, it follows the finger — and stays selected.
    await swipe(page, finger, center(start), 60, 60);
    const moved = await frame.boundingBox();
    expect(moved.x - start.x).toBeGreaterThan(40);
    expect(moved.y - start.y).toBeGreaterThan(40);
    await expect(settings).toBeVisible();

    // Four grips a finger can land on, whatever the page scale.
    const grips = page.locator('.resize-handle');
    await expect(grips).toHaveCount(4);
    const se = await grips.nth(3).boundingBox();
    expect(Math.round(se.width)).toBeGreaterThanOrEqual(28);

    await swipe(page, finger, center(se), 30, 30);
    const resized = await frame.boundingBox();
    expect(resized.width - moved.width).toBeGreaterThan(15);
    expect(resized.height - moved.height).toBeGreaterThan(15);
    expect(Math.round(resized.x)).toBe(Math.round(moved.x));

    // A swipe across a visual nobody selected is the page's, not the visual's:
    // the canvas may scroll under it, the visual's place on the page stays.
    const translate = () => other.evaluate((el) => {
      const m = new DOMMatrix(getComputedStyle(el).transform);
      return { x: m.e, y: m.f };
    });
    const otherAt = await translate();
    await swipe(page, finger, center(await other.boundingBox()), -60, -60);
    expect(await translate()).toEqual(otherAt);
  });
});

test('on a desktop a mouse still drags an unselected visual, with the fine handles', async ({ page, request }) => {
  const reportId = await ownReport(request, 'Rapport e2e souris');
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/edit/${reportId}`);

  // The frame's own translate: page coordinates, immune to selection chrome.
  const pagePos = () => page.evaluate(() => {
    const m = new DOMMatrix(getComputedStyle(document.querySelector('[data-touch-drop="visual"]')).transform);
    return { x: m.e, y: m.f };
  });
  const frame = page.locator('[data-touch-drop="visual"]').first();
  await expect(frame).toBeVisible();
  const before = await pagePos();
  const b = await frame.boundingBox();
  // The frame's top strip, as canvas-scale.spec grabs it.
  const from = { x: b.x + b.width / 2, y: b.y + 4 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 100, from.y + 80, { steps: 8 });
  await page.mouse.up();
  const after = await pagePos();
  expect(after.x - before.x).toBeGreaterThan(60);
  expect(after.y - before.y).toBeGreaterThan(40);

  // Eight edge and corner handles, none of the finger grips.
  await expect(page.locator('.resize-handle')).toHaveCount(8);
  expect(Math.round((await page.locator('.resize-handle').nth(7).boundingBox()).width)).toBeLessThan(12);
});
