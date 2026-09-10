// The separator of a merged block is at the block's own layer.
//
// The seam is drawn by the canvas rather than by either widget — one element
// covering the junction, so the two frames read as a single card. It was drawn
// in a pass of its own, after every widget and at a fixed z-index, which made
// it the one thing a widget laid on top of the block could not hide: the
// separator was painted across the widget covering it.
//
// The layer is not the z-index alone. Widgets all sit at z 1 until someone
// reorders them, and at a tie it is document order that decides — which is
// exactly the case a report produces, since an added widget is given no z at
// all. So the answer has to be read the way the browser reads it, and only a
// browser can be asked.
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const F = require('../fixtures');

const ids = () => JSON.parse(fs.readFileSync(F.IDS_FILE, 'utf8'));

const SEPARATOR = 'rgb(220, 38, 38)';
const WIDGET_ON_TOP = 'rgb(22, 163, 74)';

// Injected into the page: which of two elements the browser paints on top.
// The node that carries the layer is the nearest ancestor with a z-index of
// its own; equal layers are settled by document order, later winning.
const STACKING = `{
  stackNode(el) {
    let n = el;
    while (n && n !== document.body) {
      if (getComputedStyle(n).zIndex !== 'auto') return n;
      n = n.parentElement;
    }
    return document.body;
  },
  find(color) {
    return [...document.querySelectorAll('div')].find((d) => getComputedStyle(d).backgroundColor === color) || null;
  },
  above(a, b) {
    const na = this.stackNode(a);
    const nb = this.stackNode(b);
    const za = Number(getComputedStyle(na).zIndex) || 0;
    const zb = Number(getComputedStyle(nb).zIndex) || 0;
    if (za !== zb) return za > zb;
    return !!(nb.compareDocumentPosition(na) & Node.DOCUMENT_POSITION_FOLLOWING);
  },
  overlap(a, b) {
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    return ra.left < rb.right && ra.right > rb.left && ra.top < rb.bottom && ra.bottom > rb.top;
  },
}`;

const openMergeReport = async (page) => {
  const { mergeReportId } = ids();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/edit/${mergeReportId}`);
  await page.waitForTimeout(1200);
};

test('a widget laid over a merged block hides its separator', async ({ page }) => {
  await openMergeReport(page);

  const seen = await page.evaluate(([sep, over, src]) => {
    // eslint-disable-next-line no-eval
    const S = eval(`(${src})`);
    const line = S.find(sep);
    const covering = S.find(over);
    if (!line || !covering) return { line: !!line, covering: !!covering };
    return {
      line: true,
      covering: true,
      overlaps: S.overlap(line, covering),
      widgetAbove: S.above(covering, line),
    };
  }, [SEPARATOR, WIDGET_ON_TOP, STACKING]);

  // The fixture has to pose the problem before the answer means anything.
  expect(seen.line, 'the separator is not drawn at all').toBe(true);
  expect(seen.covering, 'the widget laid on top is not drawn at all').toBe(true);
  expect(seen.overlaps, 'the widget does not cover the seam in this fixture').toBe(true);

  expect(seen.widgetAbove, 'the separator is painted over the widget covering it').toBe(true);
});

test('the separator still covers the frames of its own block', async ({ page }) => {
  await openMergeReport(page);

  // Putting the seam back in the stack must not push it under the very frames
  // it exists to mask — the doubled border at the junction.
  const seen = await page.evaluate(([sep, src]) => {
    // eslint-disable-next-line no-eval
    const S = eval(`(${src})`);
    const cover = S.find(sep).parentElement;
    const r = cover.getBoundingClientRect();
    // A member of the block, taken far enough left of the seam to be past the
    // widget that covers it (100 page-px wide, straddling the seam).
    const member = document.elementFromPoint(Math.round(r.left) - 120, Math.round(r.top + r.height / 2));
    return { seamAbove: S.above(cover, member), sameLayer: S.stackNode(cover) !== S.stackNode(member) };
  }, [SEPARATOR, STACKING]);

  expect(seen.sameLayer, 'the seam and the frame resolved to the same node').toBe(true);
  expect(seen.seamAbove, 'the seam no longer masks the frames it joins').toBe(true);
});
