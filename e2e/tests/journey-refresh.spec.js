// Coming back to the journey from an editor shows what the editor changed.
//
// The journey's lists are loaded once, above the router, so that moving
// between stages does not refetch them. The editors live outside the journey,
// and returning from one reused those lists as they were before it opened: a
// model renamed in its editor, a report saved in its own, kept their old name
// until the page was reloaded. Here the change is made behind the editor's
// back, through the API, so the only way the new name can reach the column is
// the journey fetching again when it comes back.
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const F = require('../fixtures');

const ids = () => JSON.parse(fs.readFileSync(F.IDS_FILE, 'utf8'));
const stamp = Date.now();

test('back from the model editor, the Models stage shows the model as it now is', async ({ page, request }) => {
  const { datasourceId } = ids();
  const created = await request.post('/api/models', { data: { name: `rf-mod-${stamp}`, datasourceId, description: '' } });
  expect(created.ok(), await created.text()).toBeTruthy();
  const model = (await created.json()).model;

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/models');
  const card = page.locator(`[data-join-anchor="models:${model.id}"]`);
  await expect(card).toContainText(`rf-mod-${stamp}`);

  await page.goto(`/models/${model.id}`);
  await expect(page.getByRole('button', { name: 'Back' })).toBeVisible();
  expect((await request.put(`/api/models/${model.id}`, { data: { name: `rf-mod-renamed-${stamp}` } })).ok()).toBeTruthy();
  await page.getByRole('button', { name: 'Back' }).click();

  await expect(page).toHaveURL(/\/models$/);
  await expect(card).toContainText(`rf-mod-renamed-${stamp}`);
});

test('back from the report editor, the Reports stage shows the report as it now is', async ({ page, request }) => {
  const { modelId } = ids();
  const created = await request.post('/api/reports', { data: { title: `rf-rap-${stamp}`, modelId } });
  expect(created.ok(), await created.text()).toBeTruthy();
  const report = (await created.json()).report;

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  const card = page.locator(`[data-join-anchor="reports:${report.id}"]`);
  await expect(card).toContainText(`rf-rap-${stamp}`);

  await page.goto(`/edit/${report.id}`);
  await expect(page.getByRole('button', { name: 'Back' })).toBeVisible();
  expect((await request.put(`/api/reports/${report.id}`, { data: { title: `rf-rap-renamed-${stamp}` } })).ok()).toBeTruthy();
  await page.getByRole('button', { name: 'Back' }).click();

  await expect(card).toContainText(`rf-rap-renamed-${stamp}`);
});
