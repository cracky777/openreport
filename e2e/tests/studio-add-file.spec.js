// Data the model lacks, added from the conversation: the assistant hands over
// a card, the file is dropped on it, linked to the model, and the join found
// from the column names is confirmed by the user — no model editor. Only a
// browser holds the chain: the scripted provider, the card, the upload, the
// link, the detection and the save, then the assistant asked to go on.
const { test, expect } = require('@playwright/test');
const F = require('../fixtures');

const csv = (name, text) => ({ name, text });
const drop = async (locator, files) => {
  const dataTransfer = await locator.evaluateHandle((_el, list) => {
    const dt = new DataTransfer();
    for (const f of list) dt.items.add(new File([f.text], f.name, { type: 'text/csv' }));
    return dt;
  }, files);
  await locator.dispatchEvent('drop', { dataTransfer });
};

// Asked anything, proposes to add a file to the model.
const script = () => ({
  name: 'propose_action',
  arguments: { userAsked: 'do', action: 'add_file_to_model', summary: 'Add the customers file.', request: 'Sales by customer country' },
});

test.afterEach(async ({ page }) => {
  await page.request.put('/api/auth/me/ui-mode', { data: { mode: 'build' } });
});

test('a file dropped on the card joins the model, once the user confirms the join', async ({ page }) => {
  const provider = await F.startScriptedProvider(script);
  try {
    await page.request.put('/api/admin/settings/ai', {
      data: { provider: 'openai-compat', baseUrl: provider.url, model: 'scripted', enabled: true, dataSharing: 'schema' },
    });
    // A model on a file, made from the chat home.
    await page.goto('/chat');
    await drop(page.locator('main'), [csv('fact_sales.csv', 'order_id,customer_id,amount\n1,10,100\n2,11,250\n')]);
    await page.getByRole('button', { name: 'Import and build' }).click();
    await expect(page).toHaveURL(/\/studio\/[\w-]+$/, { timeout: 30_000 });

    await page.getByPlaceholder('Ask for a visual, a change, or the look of the page…').fill('Sales by customer country');
    await page.getByRole('button', { name: 'Send' }).click();
    const zone = page.getByLabel('Drop the file here');
    await expect(zone).toBeVisible({ timeout: 20_000 });
    await drop(zone, [csv('dim_customers.csv', 'id,name,country\n10,Acme,FR\n11,Globex,DE\n')]);
    await page.getByRole('button', { name: 'Add to the model' }).click();

    // The join found, for the user to confirm.
    await expect(page.getByText('fact_sales.customer_id')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('dim_customers.id')).toBeVisible();
    const turnsBefore = provider.requests.length;
    await page.getByRole('button', { name: /^Confirm/ }).click();
    await expect(page.getByText('dim_customers in the model')).toBeVisible({ timeout: 15_000 });

    const reportId = page.url().split('/').pop();
    const report = (await (await page.request.get(`/api/reports/${reportId}`)).json()).report;
    const model = (await (await page.request.get(`/api/models/${report.model_id}`)).json()).model;
    expect(model.selected_tables).toHaveLength(2);
    expect(model.joins).toHaveLength(1);
    expect(model.joins[0]).toMatchObject({ from_column: 'customer_id', to_column: 'id' });
    expect(model.dimensions.some((d) => d.column === 'country')).toBe(true);
    // The assistant is told, and asked to go on.
    await expect.poll(() => provider.requests.length, { timeout: 15_000 }).toBeGreaterThan(turnsBefore);
    const last = provider.requests[provider.requests.length - 1].messages.filter((m) => m.role === 'user').pop();
    expect(last.content).toMatch(/dim_customers/);
    expect(last.content).toMatch(/customer_id/);
  } finally {
    await page.request.put('/api/admin/settings/ai', { data: { enabled: false } });
    provider.server.close();
  }
});

// No join from the column names: the studio offers the model assistant,
// which gets the request in the same conversation, with the model read again.
test('no join found: the model assistant is asked to find one, in the same conversation', async ({ page }) => {
  const provider = await F.startScriptedProvider(script);
  try {
    await page.request.put('/api/admin/settings/ai', {
      data: { provider: 'openai-compat', baseUrl: provider.url, model: 'scripted', enabled: true, dataSharing: 'schema' },
    });
    await page.goto('/chat');
    await drop(page.locator('main'), [csv('fact_orders.csv', 'order_id,region_code,amount\n1,10,100\n2,11,250\n')]);
    await page.getByRole('button', { name: 'Import and build' }).click();
    await expect(page).toHaveURL(/\/studio\/[\w-]+$/, { timeout: 30_000 });

    await page.getByPlaceholder('Ask for a visual, a change, or the look of the page…').fill('Sales by region');
    await page.getByRole('button', { name: 'Send' }).click();
    const zone = page.getByLabel('Drop the file here');
    await expect(zone).toBeVisible({ timeout: 20_000 });
    await drop(zone, [csv('dim_regions.csv', 'code,label\nN,North\nS,South\n')]);
    await page.getByRole('button', { name: 'Add to the model' }).click();

    await expect(page.getByText('No join found from the column names')).toBeVisible({ timeout: 30_000 });
    const turnsBefore = provider.requests.length;
    await page.getByRole('button', { name: 'Ask the assistant to join it' }).click();
    // The card, applied, stays in the one thread; the model assistant's turn joins it.
    await expect(page.getByText('dim_regions in the model')).toBeVisible({ timeout: 15_000 });

    // The model holds the table, with no join; the model assistant is asked,
    // on a draft that shows the new table.
    const reportId = page.url().split('/').pop();
    const report = (await (await page.request.get(`/api/reports/${reportId}`)).json()).report;
    const model = (await (await page.request.get(`/api/models/${report.model_id}`)).json()).model;
    expect(model.selected_tables).toHaveLength(2);
    expect(model.joins).toHaveLength(0);
    await expect.poll(() => provider.requests.length, { timeout: 15_000 }).toBeGreaterThan(turnsBefore);
    const req = provider.requests[provider.requests.length - 1];
    const last = req.messages.filter((m) => m.role === 'user').pop();
    expect(last.content).toMatch(/dim_regions/);
    expect(last.content).toMatch(/no join/);
    expect(JSON.stringify(req)).toMatch(/dim_regions/); // the draft sent to the model assistant lists the new table
    expect(req.tools.some((t) => (t.function || t).name === 'propose_file_shape')).toBe(true);
  } finally {
    await page.request.put('/api/admin/settings/ai', { data: { enabled: false } });
    provider.server.close();
  }
});
