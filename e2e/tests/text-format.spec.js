// The Text visual's formatting toolbar, on the production build.
//
// Reported working in development and not in the cloud, which serves a
// production build: this runs the same gestures against one.
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const F = require('../fixtures');

const ids = () => JSON.parse(fs.readFileSync(F.IDS_FILE, 'utf8'));
const TEXT_ID = 'w-text-format';

test('bold and size applied from the toolbar show while editing and after', async ({ page, request }) => {
  const { modelId } = ids();
  const created = await request.post('/api/reports', { data: { title: 'Rapport e2e texte formate', modelId } });
  const reportId = (await created.json()).report.id;
  const widgets = { [TEXT_ID]: { type: 'text', config: {}, data: { text: 'Hello world' } } };
  const layout = [{ i: TEXT_ID, x: 40, y: 40, w: 400, h: 120 }];
  await request.put(`/api/reports/${reportId}`, {
    data: { title: 'Rapport e2e texte formate', settings: {}, layout, widgets, pages: [{ id: 'page-1', name: 'Page 1', layout, widgets }] },
  });

  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(`/edit/${reportId}`);
  const shown = page.getByText('Hello world').first();
  await shown.dblclick();
  const editor = page.locator('[contenteditable="plaintext-only"]');
  await expect(editor).toBeVisible();

  // Nothing selected formats the whole text.
  await page.getByRole('button', { name: 'Bold' }).click();
  await page.getByRole('spinbutton', { name: 'Font size' }).fill('30');

  const span = editor.locator('span').first();
  await expect(span).toHaveCSS('font-weight', '700');
  await expect(span).toHaveCSS('font-size', '30px');

  await editor.press('Control+Enter');
  const display = page.getByText('Hello world').first();
  await expect(display).toHaveCSS('font-weight', '700');
  await expect(display).toHaveCSS('font-size', '30px');
});
