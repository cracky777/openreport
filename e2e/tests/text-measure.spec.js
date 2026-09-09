// A measure that returns text is shown as text, in every visual that can show it.
//
// A custom-SQL measure can perfectly well return a formatted duration
// ("164j 08:02:17"), a label or a status. The scorecard pulled the digits OUT
// of such a value — `String(v).replace(/[^\d.-]/g, '')` — so that duration was
// rendered as 164 080 217: a number the user had never computed, right-aligned
// and thousands-separated, with nothing to suggest it was wrong.
//
// Only a browser shows what the widget actually paints, which is the whole
// point of this one.
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const F = require('../fixtures');

const ids = () => JSON.parse(fs.readFileSync(F.IDS_FILE, 'utf8'));
const DUREE = '164j 08:02:17';

async function openWith(page, value) {
  const { reportId } = ids();
  await page.route('**/api/models/*/query', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ rows: [{ [F.MEASURE_LABEL]: value }], rowCount: 1 }),
  }));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/view/${reportId}`);
  const card = page.locator('.widget-content').first();
  await card.waitFor();
  return () => card.innerText();
}

test('a formatted duration is displayed as it comes', async ({ page }) => {
  const shown = await openWith(page, DUREE);
  await expect.poll(shown).toContain(DUREE);
  // The number the digit-extraction used to produce.
  await expect.poll(shown).not.toContain('164 080 217');
});

test('a table cell keeps the whole value, and does not pass for a number', async ({ page }) => {
  const { tableReportId } = ids();
  await page.route('**/api/models/*/query', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      rows: [{ [F.DIM_LABEL]: 'France', [F.MEASURE_LABEL]: DUREE }],
      rowCount: 1,
    }),
  }));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/view/${tableReportId}`);
  const cell = page.locator('td', { hasText: DUREE }).first();
  await cell.waitFor();
  // parseFloat read the leading digits: the cell showed 164, right-aligned.
  await expect(cell).toHaveText(DUREE);
  await expect(cell).toHaveCSS('text-align', 'left');
});

test('a numeric string is still read as a number', async ({ page }) => {
  // What a driver hands back for a NUMERIC column — this must keep its
  // formatting rather than fall through to raw text.
  const shown = await openWith(page, '1234.5');
  await expect.poll(shown).toContain('1');
  await expect.poll(shown).not.toContain('1234.5');
});
