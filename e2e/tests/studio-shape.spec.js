// A file dropped in the chat is not a fact table yet: one column per month.
// Asked of the data model, the assistant explains and proposes a recipe (a card the
// user validates), the file is rewritten by the server — months as rows, a
// calendar beside — the model is saved on the new tables, and the assistant
// goes on with the joins, another card. Only a browser holds the chain:
// scripted provider → card → reshape route → model saved → next turn.
const { test, expect } = require('@playwright/test');
const F = require('../fixtures');

const drop = async (locator, files) => {
  const dataTransfer = await locator.evaluateHandle((_el, list) => {
    const dt = new DataTransfer();
    for (const f of list) dt.items.add(new File([f.text], f.name, { type: 'text/csv' }));
    return dt;
  }, files);
  await locator.dispatchEvent('drop', { dataTransfer });
};

function script(body) {
  const last = [...body.messages].reverse().find((m) => m.role === 'user');
  if (/The file is reshaped/.test(last.content)) {
    return {
      name: 'propose_model_changes',
      arguments: {
        reading: { joins: true, fields: false, measures: false, tableRoles: true, layout: false, glossary: false },
        summary: 'Join the budget to the calendar.',
        joins: [{ fromTable: 'budget', fromColumn: 'Month', toTable: 'calendar', toColumn: 'Date', cardinality: 'many-to-one' }],
        tableRoles: [{ table: 'budget', role: 'fact' }, { table: 'calendar', role: 'dimension' }],
      },
    };
  }
  return {
    name: 'propose_file_shape',
    arguments: {
      summary: 'One row per account and month, with a calendar.',
      table: 'budget',
      steps: [
        { op: 'unpivot', keep: ['Compte'], name: 'Month', value: 'Amount' },
        { op: 'map', column: 'Month', values: { 'janv.-24': '2024-01-01', 'févr.-24': '2024-02-01' } },
        { op: 'cast', column: 'Month', type: 'date', format: '%Y-%m-%d' },
        { op: 'cast', column: 'Amount', type: 'number' },
        { op: 'calendar', name: 'calendar', column: 'Month' },
      ],
    },
  };
}

test.afterEach(async ({ page }) => {
  await page.request.put('/api/auth/me/ui-mode', { data: { mode: 'build' } });
});

test('the model assistant reshapes a wide budget file on its card, then joins the new tables', async ({ page }) => {
  const provider = await F.startScriptedProvider(script);
  try {
    await page.request.put('/api/admin/settings/ai', {
      data: { provider: 'openai-compat', baseUrl: provider.url, model: 'scripted', enabled: true, dataSharing: 'schema' },
    });
    await page.goto('/chat');
    await drop(page.locator('main'), [{ name: 'budget.csv', text: 'Compte,janv.-24,févr.-24\n601,100,110\n706,200,220\n' }]);
    await page.getByRole('button', { name: 'Import and build' }).click();
    await expect(page).toHaveURL(/\/studio\/[\w-]+$/, { timeout: 30_000 });
    const reportId = page.url().split('/').pop();
    const report = (await (await page.request.get(`/api/reports/${reportId}`)).json()).report;
    const modelOf = async () => (await (await page.request.get(`/api/models/${report.model_id}`)).json()).model;
    const columnsOf = async (t) => (await (await page.request.get(`/api/models/${report.model_id}/tables/${t}/columns`)).json()).columns.map((c) => c.column_name);
    expect(await columnsOf('budget')).toEqual(['Compte', 'janv.-24', 'févr.-24']);

    await page.getByRole('button', { name: 'Ask the data model' }).click();
    const box = page.getByPlaceholder('Join the tables, flag the columns…');
    await box.fill('Make the budget joinable');
    await page.getByRole('button', { name: 'Send' }).click();

    // The recipe, in words, waits for the user: nothing is rewritten yet.
    await expect(page.getByText('budget: what will be done')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Every column but Compte becomes a row/)).toBeVisible();
    await expect(page.getByText('Tables after: budget, calendar')).toBeVisible();
    expect(provider.requests[0].messages.find((m) => m.role === 'system').content).toContain('Tables of imported files (may be reshaped): "budget"');
    expect(await columnsOf('budget')).toEqual(['Compte', 'janv.-24', 'févr.-24']);

    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByText('File reshaped and the model saved')).toBeVisible({ timeout: 30_000 });
    expect(await columnsOf('budget')).toEqual(['Compte', 'Month', 'Amount']);
    expect(await columnsOf('calendar')).toContain('YearMonth');
    const shaped = await modelOf();
    expect(shaped.selected_tables.sort()).toEqual(['budget', 'calendar']);
    expect(shaped.dimensions.some((d) => d.table === 'budget' && d.column === 'Month')).toBe(true);

    // The assistant was asked to go on: its joins come as the usual card.
    await page.getByRole('button', { name: /^Apply/ }).click({ timeout: 20_000 });
    await expect(page.getByText('Applied and saved to the model')).toBeVisible({ timeout: 15_000 });
    const joined = await modelOf();
    expect(joined.joins).toEqual([expect.objectContaining({ from_table: 'budget', from_column: 'Month', to_table: 'calendar', to_column: 'Date' })]);
    expect(joined.table_positions.budget.tableType).toBe('fact');
  } finally {
    await page.request.put('/api/admin/settings/ai', { data: { enabled: false } });
    provider.server.close();
  }
});
