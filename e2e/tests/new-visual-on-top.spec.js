// A visual that arrives lands above the others.
//
// Added at the default layer, a new visual sat behind any visual once brought
// to front — covered, it looked as if the add had done nothing.
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const F = require('../fixtures');

const ids = () => JSON.parse(fs.readFileSync(F.IDS_FILE, 'utf8'));
const TITLE = 'Rapport e2e premier plan';

// Every visual on the canvas: its layer, and whether it is the one in front.
const layers = (page) => page.locator('.widget-content').evaluateAll((els) => els.map((el) => {
  let n = el;
  while (n && !(n.style && n.style.zIndex)) n = n.parentElement;
  return { front: el.innerText.includes('In front'), z: n ? Number(n.style.zIndex) : null };
}));

test('an added or pasted visual is above one brought to front', async ({ page, request }) => {
  const { modelId } = ids();
  const created = await request.post('/api/reports', { data: { title: TITLE, modelId } });
  const reportId = (await created.json()).report.id;
  // Covers the middle of the page, where a new visual is placed.
  const widgets = { front: { type: 'text', config: {}, data: { text: 'In front' } } };
  const layout = [{ i: 'front', x: 200, y: 150, w: 740, h: 500, z: 5 }];
  await request.put(`/api/reports/${reportId}`, {
    data: { title: TITLE, settings: {}, layout, widgets, pages: [{ id: 'page-1', name: 'Page 1', layout, widgets }] },
  });

  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(`/edit/${reportId}`);
  await expect(page.getByText('In front', { exact: true })).toBeVisible();
  expect(await layers(page)).toEqual([{ front: true, z: 5 }]);

  await page.getByRole('button', { name: 'Add Scorecard' }).click();
  await expect(page.locator('.widget-content')).toHaveCount(2);
  const added = (await layers(page)).find((l) => !l.front);
  expect(added.z).toBeGreaterThan(5);

  // Copy the one in front, paste: the copy goes above everything too.
  // Now covered in its middle by the scorecard: picked up by a corner.
  await page.locator('.widget-content', { hasText: 'In front' }).click({ position: { x: 12, y: 12 } });
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  await expect(page.locator('.widget-content')).toHaveCount(3);
  const copies = (await layers(page)).filter((l) => l.front).map((l) => l.z);
  expect(Math.max(...copies)).toBeGreaterThan(added.z);
});
