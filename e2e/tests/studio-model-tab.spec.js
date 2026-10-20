// The model assistant inside the studio's one conversation: asked (target
// button pressed) to join two tables the column names do not join, it
// proposes the join, the card is applied, and the model is saved at once — no
// model editor. Only a browser holds the chain: the saved model read as a
// draft, the scripted provider, the card and the save.
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

// On the model assistant's route: joins orders2 to the linked people table,
// whose name (alias__people) it reads in the draft the prompt shows.
function script(body) {
  const system = body.messages.find((m) => m.role === 'system').content;
  const people = system.match(/(\w+__people)\b/)[1];
  return {
    name: 'propose_model_changes',
    arguments: {
      reading: { joins: true, fields: false, measures: false, tableRoles: false, layout: false, glossary: false },
      summary: 'Join the orders to the people who placed them.',
      joins: [{ fromTable: 'orders2', fromColumn: 'cust', toTable: people, toColumn: 'pid', cardinality: 'many-to-one' }],
    },
  };
}

test.afterEach(async ({ page }) => {
  await page.request.put('/api/auth/me/ui-mode', { data: { mode: 'build' } });
});

test('the model assistant of the studio joins two tables on its word, and saves the model', async ({ page }) => {
  const provider = await F.startScriptedProvider(script);
  try {
    await page.request.put('/api/admin/settings/ai', {
      data: { provider: 'openai-compat', baseUrl: provider.url, model: 'scripted', enabled: true, dataSharing: 'schema' },
    });
    // Two files whose column names do not join: cust and pid.
    await page.goto('/chat');
    await drop(page.locator('main'), [csv('orders2.csv', 'id,cust,amount\n1,10,100\n2,11,250\n'), csv('people.csv', 'pid,name\n10,Acme\n11,Globex\n')]);
    await page.getByRole('button', { name: 'Import 2 files' }).click();
    await expect(page).toHaveURL(/\/studio\/[\w-]+$/, { timeout: 30_000 });
    const reportId = page.url().split('/').pop();
    const report = (await (await page.request.get(`/api/reports/${reportId}`)).json()).report;
    const modelOf = async () => (await (await page.request.get(`/api/models/${report.model_id}`)).json()).model;
    expect((await modelOf()).joins).toHaveLength(0);

    await page.getByRole('button', { name: 'Ask the data model' }).click();
    const box = page.getByPlaceholder('Join the tables, flag the columns…');
    // Meanwhile the report assistant saved a measure on the same model (as its
    // cards do): the model card must build on the model as saved now, not on
    // the copy read before — that copy once erased such measures.
    const before = await modelOf();
    const margin = { name: '_calc.margin', label: 'Margin', table: 'orders2', column: 'amount', aggregation: 'avg' };
    await page.request.put(`/api/models/${report.model_id}`, { data: { measures: [...before.measures, margin] } });
    await box.fill('Join the orders to the people');
    await page.getByRole('button', { name: 'Send' }).click();
    await page.getByRole('button', { name: /^Apply/ }).click({ timeout: 20_000 });
    await expect(page.getByText(/Applied|applied/).first()).toBeVisible({ timeout: 15_000 });

    const model = await modelOf();
    expect(model.measures.map((m) => m.name)).toContain('_calc.margin');
    expect(model.joins).toHaveLength(1);
    expect(model.joins[0]).toMatchObject({ from_table: 'orders2', from_column: 'cust', to_column: 'pid' });
    expect(model.joins[0].to_table).toMatch(/__people$/);

    // The model assistant's turns sit in the one thread, tagged.
    await expect(page.getByText('Join the orders to the people', { exact: true })).toBeVisible();
    await expect(page.getByText('Applied and saved to the model')).toBeVisible();
    await expect(page.getByText('Data model').first()).toBeVisible();
  } finally {
    await page.request.put('/api/admin/settings/ai', { data: { enabled: false } });
    provider.server.close();
  }
});

// The other way round: asked of the data model for something that belongs to
// the report (a calculated measure), the model assistant hands it over and the
// report's assistant receives the request by itself, in the same conversation.
test('a report request asked of the data model is passed on to the report assistant', async ({ page }) => {
  const toolNames = (body) => (body.tools || []).map((t) => (t.function || t).name);
  const provider = await F.startScriptedProvider((body) => {
    if (toolNames(body).includes('hand_to_report')) {
      return { name: 'hand_to_report', arguments: { summary: 'The report assistant adds the margin.', request: 'Add a margin measure: amount minus cost' } };
    }
    const system = body.messages.find((m) => m.role === 'system').content;
    const measure = system.match(/"name":"([^"]+\.amount_sum)"/)[1];
    return { name: 'propose_widgets', arguments: { reading: { scope: 'precise' }, widgets: [{ type: 'scorecard', title: 'Margin (e2e)', answers: 'figure', rationale: 'The figure asked for.', binding: { selectedMeasures: [measure] } }] } };
  });
  try {
    await page.request.put('/api/admin/settings/ai', {
      data: { provider: 'openai-compat', baseUrl: provider.url, model: 'scripted', enabled: true, dataSharing: 'schema' },
    });
    await page.goto('/chat');
    await drop(page.locator('main'), [csv('orders3.csv', 'id,amount,cost\n1,100,60\n2,250,100\n')]);
    await page.getByRole('button', { name: 'Import and build' }).click();
    await expect(page).toHaveURL(/\/studio\/[\w-]+$/, { timeout: 30_000 });

    await page.getByRole('button', { name: 'Ask the data model' }).click();
    const box = page.getByPlaceholder('Join the tables, flag the columns…');
    await box.fill('Add a margin column: amount minus cost');
    const before = provider.requests.length;
    await page.getByRole('button', { name: 'Send' }).click();

    // No card to press: the request goes to the report assistant as the user's own words.
    await expect(page.getByText('Handed to the report assistant.')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Add a margin measure: amount minus cost', { exact: true })).toBeVisible();
    await expect.poll(() => provider.requests.length, { timeout: 15_000 }).toBeGreaterThan(before + 1);
    const last = provider.requests[provider.requests.length - 1];
    expect(toolNames(last)).toContain('propose_widgets');
    expect(last.messages.filter((m) => m.role === 'user').pop().content).toContain('Add a margin measure: amount minus cost');
    await expect(page.getByRole('button', { name: 'Add visual' })).toBeVisible({ timeout: 20_000 });
  } finally {
    await page.request.put('/api/admin/settings/ai', { data: { enabled: false } });
    provider.server.close();
  }
});
