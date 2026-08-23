// Small-screen viewer: below the width threshold the read-only canvas stops
// scaling the pixel page down and stacks the widgets in one column, slicers
// first. Only a real layout engine can tell whether that happened — the
// decision hinges on the measured container width, and so does the result.
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const F = require('../fixtures');

const ids = () => JSON.parse(fs.readFileSync(F.IDS_FILE, 'utf8'));
const PHONE = { width: 390, height: 800 };

async function mockQueries(page) {
  await page.route('**/api/models/*/query', (route) => {
    const body = route.request().postData() || '';
    const rows = /"distinct"\s*:\s*true/.test(body)
      ? [{ [F.DIM_LABEL]: 'FR' }, { [F.DIM_LABEL]: 'DE' }]
      : [{ [F.MEASURE_LABEL]: 0 }];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows, rowCount: rows.length }) });
  });
}

// The seed places the scorecard (y=40) ABOVE the slicer (y=280): on the
// desktop canvas that is what shows; stacked, the slicer must come first.
async function verticalOrder(page) {
  const fr = page.getByRole('button', { name: 'FR', exact: true });
  const zero = page.getByText('0', { exact: true });
  await expect(fr).toBeVisible();
  await expect(zero).toBeVisible();
  const [a, b] = await Promise.all([fr.boundingBox(), zero.boundingBox()]);
  return a.y < b.y ? 'slicer-first' : 'scorecard-first';
}

test('on a phone the widgets stack full-width with the slicer on top', async ({ page }) => {
  const { reportId } = ids();
  await page.setViewportSize(PHONE);
  await mockQueries(page);
  await page.goto(`/view/${reportId}`);

  await expect(page.locator('[data-stacked="1"]')).toHaveCount(1);
  expect(await verticalOrder(page)).toBe('slicer-first');

  // Both widgets span the column: viewport 390 − outer pad 2×12 − inner pad 2×12.
  const widths = [];
  for (const el of await page.locator('.widget-content').all()) widths.push((await el.boundingBox()).width);
  expect(widths).toHaveLength(2);
  for (const w of widths) expect(Math.abs(w - 342)).toBeLessThanOrEqual(2);
  // And nothing overflows sideways — the whole point of not scaling.
  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollW).toBeLessThanOrEqual(PHONE.width);
});

test('on a desktop the pixel canvas is untouched', async ({ page }) => {
  const { reportId } = ids();
  await mockQueries(page);
  await page.goto(`/view/${reportId}`);
  await expect(page.locator('[data-stacked="1"]')).toHaveCount(0);
  expect(await verticalOrder(page)).toBe('scorecard-first');
});

test('a report set to "scale" keeps its page on a phone', async ({ page }) => {
  const { reportId } = ids();
  const get = await page.request.get(`/api/reports/${reportId}`);
  const report = (await get.json()).report;
  const put = (settings) => page.request.put(`/api/reports/${reportId}`, {
    data: { title: report.title, settings, layout: report.layout, widgets: report.widgets, pages: report.pages },
  });
  expect((await put({ ...(report.settings || {}), smallScreens: 'scale' })).ok()).toBeTruthy();
  try {
    await page.setViewportSize(PHONE);
    await mockQueries(page);
    await page.goto(`/view/${reportId}`);
    await expect(page.getByRole('button', { name: 'FR', exact: true })).toBeVisible();
    await expect(page.locator('[data-stacked="1"]')).toHaveCount(0);
    expect(await verticalOrder(page)).toBe('scorecard-first');
  } finally {
    expect((await put(report.settings || {})).ok()).toBeTruthy();
  }
});
