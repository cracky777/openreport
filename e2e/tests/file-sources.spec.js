// Imported file sources, seen from the browser.
//
// The journey lists load once per session. A source created behind the page's
// back — an import whose response never came back (proxy timeout), another tab
// — stayed invisible until F5, while re-importing it answered "already
// exists". The list must catch up: on its own after a failed import, and on
// demand through Refresh.
//
// One file is one source; a model on a file reads other files too — linked
// from the new-model form or from the model editor — and joins across them.
const { test, expect } = require('@playwright/test');

const csv = (name) => ({ name, mimeType: 'text/csv', buffer: Buffer.from('id,amount\n1,10\n2,20\n') });

// Created straight through the API: the page open in the browser knows nothing of it.
async function importBehindThePage(page, fileName) {
  const res = await page.request.post('/api/upload', { multipart: { file: csv(fileName) } });
  expect(res.status()).toBe(201);
}

// The three stages are mounted side by side: everything is read inside the
// Data Sources one.
const stage = (page) => page.locator('main').filter({ has: page.getByRole('button', { name: '+ New Connection' }) });
const card = (page, name) => stage(page).getByText(name, { exact: true });
const refresh = (page) => stage(page).getByRole('button', { name: 'Refresh', exact: true });

test('Refresh shows a source created behind the page', async ({ page }) => {
  await page.goto('/datasources');
  await expect(refresh(page)).toBeVisible();

  await importBehindThePage(page, 'refresh-behind.csv');
  await expect(card(page, 'refresh-behind')).toHaveCount(0);

  await refresh(page).click();
  await expect(card(page, 'refresh-behind')).toBeVisible();
});

test('a refused import brings the existing source on screen', async ({ page }) => {
  await page.goto('/datasources');
  await importBehindThePage(page, 'refused-import.csv');
  await expect(card(page, 'refused-import')).toHaveCount(0);

  await stage(page).locator('input[type="file"]').setInputFiles(csv('refused-import.csv'));
  await page.getByRole('dialog').getByRole('button', { name: 'Import', exact: true }).click();

  await expect(page.getByRole('dialog').getByText(/already exists/)).toBeVisible();
  await expect(card(page, 'refused-import')).toBeVisible();
});

test('a file imported from the model editor becomes a source of the model', async ({ page }) => {
  const up = await page.request.post('/api/upload', { multipart: { file: csv('editor-orders.csv') } });
  const dsId = (await up.json()).datasource.id;
  const created = await page.request.post('/api/models', { data: { name: 'editor-multi', datasourceId: dsId } });
  await page.goto(`/models/${(await created.json()).model.id}`);

  await page.getByRole('button', { name: '+ Import a file' }).click();
  await page.locator('input[type="file"][accept*=".csv"]').setInputFiles(csv('editor-customers.csv'));
  await page.getByRole('dialog').getByRole('button', { name: 'Import', exact: true }).click();

  // A source of its own, linked to the model, its table ticked under its name.
  await expect(page.getByRole('button', { name: 'Remove editor-customers from the model' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'editor_customers' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'editor_orders' })).not.toBeChecked();
  const sources = await (await page.request.get('/api/datasources')).json();
  expect(sources.datasources.map((d) => d.name)).toContain('editor-customers');
});

test('the new-model form combines files, and the journey draws both relations', async ({ page }) => {
  await page.goto('/models');
  await importBehindThePage(page, 'form-orders.csv');
  await importBehindThePage(page, 'form-customers.csv');
  const models = page.locator('main').filter({ has: page.getByRole('button', { name: '+ New Model' }) });
  await models.getByRole('button', { name: 'Refresh', exact: true }).click();
  await models.getByRole('button', { name: '+ New Model' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByPlaceholder('e.g. Sales Analysis').fill('form-multi');
  await dialog.locator('select').first().selectOption({ label: 'form-orders (duckdb)' });
  await dialog.getByRole('combobox', { name: 'Also use a data source' }).selectOption({ label: 'form-customers' });
  await dialog.getByRole('button', { name: 'Create & Configure' }).click();

  await expect(page.getByRole('button', { name: 'Remove form-customers from the model' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'form_customers' })).toBeVisible();

  const listed = await (await page.request.get('/api/models')).json();
  const model = listed.models.find((m) => m.name === 'form-multi');
  const customers = (await (await page.request.get('/api/datasources')).json()).datasources.find((d) => d.name === 'form-customers');
  expect(model.linked_datasource_ids).toEqual([customers.id]);
  await page.goto('/models');
  await expect(page.locator(`[data-join-anchor="models:${model.id}"]`)).toHaveAttribute('data-join-also', `sources:${customers.id}`);
});
