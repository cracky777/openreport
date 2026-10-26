// The chat face of the app (the studio without a report, pages/AiStudio.jsx +
// AiPanel/StartConversation.jsx): Build and Chat side by side, each sliding
// the other in, the side the account remembers, and files dropped into the conversation that become a
// model and a report without the journey's screens, the studio opening on it.
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const F = require('../fixtures');

const ids = () => JSON.parse(fs.readFileSync(F.IDS_FILE, 'utf8'));

const csv = (name, text) => ({ name, text });
// Files reach the chat home by drag and drop only: a drop on the page, as a user does it.
const drop = async (page, files) => {
  const dataTransfer = await page.evaluateHandle((list) => {
    const dt = new DataTransfer();
    for (const f of list) dt.items.add(new File([f.text], f.name, { type: 'text/csv' }));
    return dt;
  }, files);
  await page.locator('main').dispatchEvent('drop', { dataTransfer });
};
const ORDERS = 'order_id,customer_id,amount\n1,10,100\n2,11,250\n3,10,75\n';
const CUSTOMERS = 'id,name,country\n10,Acme,FR\n11,Globex,DE\n';

// The seeded account is shared by every spec: it leaves as it came, on Build.
test.afterEach(async ({ page }) => {
  await page.request.put('/api/auth/me/ui-mode', { data: { mode: 'build' } });
});

test('the Assistant bar slides the chat home in, the Build bar slides Build back, and the account remembers the side', async ({ page }) => {
  // The bar shows while the assistant is on or waits for a provider; other
  // specs leave it switched off.
  await page.request.put('/api/admin/settings/ai', { data: { removeProvider: true, enabled: true } });
  await page.goto('/');
  await page.getByRole('button', { name: 'Assistant', exact: true }).click();
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.getByLabel('Describe the report you want')).toBeVisible();
  // Remembered: the root opens on the chat home now.
  await page.goto('/');
  await expect(page).toHaveURL(/\/chat$/);
  await page.getByRole('button', { name: 'Build', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('button', { name: '+ New Connection' }).first()).toBeVisible();
});

test('the chat home opens on cards: the reports of the workspace, then one card to create a report from files or a model', async ({ page }) => {
  await page.goto('/chat');
  await page.getByRole('button', { name: /Continue a report/ }).click();
  await expect(page.getByRole('button', { name: 'Rapport e2e', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Create a report/ }).click();
  await expect(page.getByRole('button', { name: 'Rapport e2e', exact: true })).toHaveCount(0);
  await expect(page.getByText('Start from the beginning')).toBeVisible();
  await page.getByRole('button', { name: 'e2e-model' }).click();
  await expect(page).toHaveURL(/\/studio\/[\w-]+$/, { timeout: 30_000 });
});

test('a file dropped on the chat home becomes a model and a report, open in the studio', async ({ page }) => {
  await page.goto('/chat');
  await drop(page, [csv(`chat-orders-${Date.now()}.csv`, ORDERS)]);
  await page.getByRole('button', { name: 'Import and build' }).click();
  await expect(page).toHaveURL(/\/studio\/[\w-]+$/, { timeout: 30_000 });
  await expect(page.getByText('AI studio')).toBeVisible();
});

test('two files become one model, joined by their column names', async ({ page }) => {
  // Named as a user would: the join is found from "customer_id" and the customers table.
  await page.goto('/chat');
  await drop(page, [csv('orders.csv', ORDERS), csv('customers.csv', CUSTOMERS)]);
  await page.getByRole('button', { name: 'Import 2 files' }).click();
  await expect(page).toHaveURL(/\/studio\/[\w-]+$/, { timeout: 30_000 });
  const reportId = page.url().split('/').pop();
  const report = (await (await page.request.get(`/api/reports/${reportId}`)).json()).report;
  const model = (await (await page.request.get(`/api/models/${report.model_id}`)).json()).model;
  expect(model.selected_tables).toHaveLength(2);
  expect(model.joins.length).toBeGreaterThanOrEqual(1);
  expect(model.joins[0]).toMatchObject({ from_column: 'customer_id', to_column: 'id' });
});

// Both the chat home and the studio are one page: a report opened after
// another one must not inherit its working copy (the viewer kept showing the
// previous report's pages) nor its conversation.
test('a report opened from the conversation after another one shows its own pages', async ({ page }) => {
  await page.request.put('/api/auth/me/ui-mode', { data: { mode: 'chat' } });
  const { tableReportId } = ids();
  await page.goto(`/studio/${tableReportId}`);
  // The table report: one visual.
  await expect(page.locator('.widget-content')).toHaveCount(1);
  await page.getByTitle('Back', { exact: true }).click();
  await expect(page).toHaveURL(/\/chat$/);
  await page.getByRole('button', { name: /Continue a report/ }).click();
  await page.getByRole('button', { name: 'Rapport e2e', exact: true }).click();
  await expect(page).toHaveURL(/\/studio\/[\w-]+$/);
  expect(page.url()).not.toContain(tableReportId);
  // That report's two visuals, not the previous report's one.
  await expect(page.locator('.widget-content')).toHaveCount(2);
  await expect(page.getByText('Rapport e2e tableau')).toHaveCount(0);
});
