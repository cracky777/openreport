// A measure bound to a Text visual is printed where the text says "#tag".
//
// The measure goes in through the Measures well of the Text's Fields section
// (here, straight in the saved binding); the text names it by its tag. The
// visual queries the measure like a scorecard would and prints the answer in
// the tag's place, formatted, while the rest of the text stays as typed. The
// panel spells the tag so the author does not have to guess the folding.
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const F = require('../fixtures');

const ids = () => JSON.parse(fs.readFileSync(F.IDS_FILE, 'utf8'));
const TEXT_ID = 'w-text-tag';

test('a #tag prints the bound measure inside the text', async ({ page, request }) => {
  const { modelId } = ids();
  const created = await request.post('/api/reports', { data: { title: 'Rapport e2e texte tag', modelId } });
  const reportId = (await created.json()).report.id;
  const widgets = {
    [TEXT_ID]: {
      type: 'text', config: {},
      dataBinding: { selectedMeasures: [F.MEASURE] },
      data: { text: 'Total: #Sales EUR', runs: [{ text: 'Total: ' }, { text: '#Sales', bold: true }, { text: ' EUR' }] },
    },
  };
  const layout = [{ i: TEXT_ID, x: 40, y: 40, w: 400, h: 120 }];
  await request.put(`/api/reports/${reportId}`, {
    data: { title: 'Rapport e2e texte tag', settings: {}, layout, widgets, pages: [{ id: 'page-1', name: 'Page 1', layout, widgets }] },
  });

  const asked = [];
  await page.route('**/api/models/*/query', (route) => {
    try { asked.push(JSON.parse(route.request().postData() || '{}')); } catch { /* another shape */ }
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ rows: [{ [F.MEASURE_LABEL]: 1234 }], rowCount: 1 }),
    });
  });

  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(`/edit/${reportId}`);

  // The text queries its measure with no grain, and the value takes the
  // tag's place — the bold run prints the number, the others stay as typed.
  await expect.poll(() => asked.some((q) => (q.measureNames || []).includes(F.MEASURE) && !(q.dimensionNames || []).length)).toBe(true);
  const text = page.getByText(/Total: 1[,   ]?234 EUR/).first();
  await expect(text).toBeVisible();
  await expect(text.locator('span').nth(1)).toHaveCSS('font-weight', '700');

  // The panel shows the well and spells the tag to type.
  await text.click();
  await expect(page.getByTestId('text-measure-tags')).toContainText('#sales');

  // Editing shows the tag, not the value: the author edits what they wrote.
  await text.dblclick();
  const editor = page.locator('[contenteditable="plaintext-only"]');
  await expect(editor).toHaveText('Total: #Sales EUR');
});
