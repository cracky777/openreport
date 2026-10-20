// After a file is added to the model from the conversation, the visuals the
// assistant proposes on its data must draw in the studio's viewer, and the
// visuals already on the page must keep their data.
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

// Field names as the prompt's schema spells them (alias__table.column).
const fieldNamed = (body, column) => {
  const system = body.messages.find((m) => m.role === 'system').content;
  const m = system.match(new RegExp(`"name":"([^"]*\\.${column})"`));
  return m ? m[1] : null;
};

const script = (body) => {
  const users = body.messages.filter((m) => m.role === 'user').map((m) => String(m.content));
  const last = users[users.length - 1] || '';
  if (/^Orders table/.test(last)) {
    return { name: 'propose_widgets', arguments: { reading: { scope: 'precise' }, widgets: [{ type: 'table', title: 'Orders (e2e)', rationale: 'Lists the orders.', answers: 'detail', binding: { selectedDimensions: [fieldNamed(body, 'order_id')], selectedMeasures: [fieldNamed(body, 'amount_sum')] } }] } };
  }
  if (/I added/.test(last)) {
    return { name: 'propose_widgets', arguments: { reading: { scope: 'precise' }, widgets: [{ type: 'table', title: 'Countries (e2e)', rationale: 'Lists the countries.', answers: 'detail', binding: { selectedDimensions: [fieldNamed(body, 'country')], selectedMeasures: [fieldNamed(body, 'amount_sum')] } }] } };
  }
  return { name: 'propose_action', arguments: { userAsked: 'do', action: 'add_file_to_model', summary: 'Add the customers file.', request: 'Sales by customer country' } };
};

test.afterEach(async ({ page }) => {
  await page.request.put('/api/auth/me/ui-mode', { data: { mode: 'build' } });
});

test('visuals on a file added from the conversation draw their data, and the others keep theirs', async ({ page }) => {
  const provider = await F.startScriptedProvider(script);
  try {
    await page.request.put('/api/admin/settings/ai', {
      data: { provider: 'openai-compat', baseUrl: provider.url, model: 'scripted', enabled: true, dataSharing: 'schema' },
    });
    await page.goto('/chat');
    await drop(page.locator('main'), [csv('fact_orders_data.csv', 'order_id,client_id,amount\n1,10,100\n2,11,250\n')]);
    await page.getByRole('button', { name: 'Import and build' }).click();
    await expect(page).toHaveURL(/\/studio\/[\w-]+$/, { timeout: 30_000 });

    // A first visual on the file's own data, drawn with its rows.
    const ask = async (text) => {
      await page.getByPlaceholder('Ask for a visual, a change, or the look of the page…').fill(text);
      await page.getByRole('button', { name: 'Send' }).click();
    };
    await ask('Orders table');
    // The card's preview draws the rows before the visual is added.
    await expect(page.getByLabel('Visual preview')).toContainText('250', { timeout: 20_000 });
    await page.getByRole('button', { name: 'Add visual' }).click({ timeout: 20_000 });
    // The visual's frame: the nearest box holding both its title and its content.
    const frameOf = (title) => page.getByText(title, { exact: true }).last().locator('xpath=ancestor::div[.//div[contains(@class, "widget-content")]][1]').locator('.widget-content');
    const orders = frameOf('Orders (e2e)');
    await expect(orders).toHaveCount(1);
    await expect(orders).toContainText('2', { timeout: 15_000 });

    // The customers file, added through the card.
    await ask('Sales by customer country');
    const zone = page.getByLabel('Drop the file here');
    await expect(zone).toBeVisible({ timeout: 20_000 });
    await drop(zone, [csv('dim_clients.csv', 'id,name,country\n10,Acme,FR\n11,Globex,DE\n')]);
    await page.getByRole('button', { name: 'Add to the model' }).click();
    await page.getByRole('button', { name: /^Confirm/ }).click({ timeout: 30_000 });

    // The assistant goes on: a visual on the new table, drawn with its rows;
    // the first visual still shows its own.
    await expect(page.getByLabel('Visual preview').last()).toContainText('FR', { timeout: 20_000 });
    await page.getByRole('button', { name: 'Add visual' }).click({ timeout: 20_000 });
    const countries = frameOf('Countries (e2e)');
    await expect(countries).toHaveCount(1);
    await expect(countries).toContainText('FR', { timeout: 15_000 });
    await expect(countries).toContainText('DE');
    await expect(orders).toContainText('2');
  } finally {
    await page.request.put('/api/admin/settings/ai', { data: { enabled: false } });
    provider.server.close();
  }
});
