// Help from the header: the user guide, and beside it — when the account has
// the assistant — the Help assistant, answered from the same guide with no
// data tool (server helpAssistant). Questions about data are Chat's.
const { test, expect } = require('@playwright/test');
const F = require('../fixtures');

const withProvider = async (page, script, run) => {
  const provider = await F.startScriptedProvider(script);
  try {
    await page.request.put('/api/admin/settings/ai', {
      data: { provider: 'openai-compat', baseUrl: provider.url, model: 'scripted', enabled: true, dataSharing: 'schema' },
    });
    await run(provider);
  } finally {
    await page.request.put('/api/admin/settings/ai', { data: { enabled: false } });
    provider.server.close();
  }
};

test('the Help button opens the guide with the assistant beside it, and a suggested question is answered from the guide', async ({ page }) => {
  await withProvider(page, () => ({ name: 'read_help', arguments: { topics: ['sharing'] } }), async (provider) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Help' }).click();
    await expect(page).toHaveURL(/\/help$/);
    await expect(page.getByRole('heading', { name: 'Public links and embedding' })).toBeVisible();
    const panel = page.getByRole('complementary', { name: 'Help assistant' });

    await panel.getByRole('button', { name: 'How do I share a report with my team?' }).click();
    await expect(panel.getByText('How do I share a report with my team?')).toBeVisible();
    await expect(panel.getByText('Here is a bar chart.')).toBeVisible({ timeout: 20000 });

    // The guide, and the cards that bring data in: no data tool.
    expect(provider.requests[0].tools.map((t) => t.function.name)).toEqual(['read_help', 'propose_action']);
    const guide = provider.requests[1].messages.find((m) => m.role === 'tool');
    expect(JSON.parse(guide.content).help).toMatch(/## sharing/);
  });
});

// "How do I create a connection?": the steps, and a card that opens the form.
// The connection details are typed there, never in the chat.
test('asked how to connect a database, Help explains and hands over the connection form', async ({ page }) => {
  const script = (body) => (body.messages.some((m) => m.role === 'tool')
    ? { name: 'propose_action', arguments: { userAsked: 'how', action: 'connect_database', summary: 'Open the connection form.' } }
    : { name: 'read_help', arguments: { topics: ['datasources'] } });
  await withProvider(page, script, async (provider) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/help');
    const panel = page.getByRole('complementary', { name: 'Help assistant' });
    await panel.getByLabel('Your question').fill('Comment créer une connexion ?');
    await panel.getByRole('button', { name: 'Send' }).click();
    await panel.getByRole('button', { name: 'Connect a database' }).click({ timeout: 20000 });
    await expect(page.getByRole('dialog').getByText('Host', { exact: true })).toBeVisible();
    expect(provider.requests[0].tools.map((t) => t.function.name)).toEqual(['read_help', 'propose_action']);
  });
});

// Without the assistant, Help is the user guide alone: the same help.md, readable and searchable.
test('without the assistant, Help opens the user guide alone, searchable', async ({ page }) => {
  await page.request.put('/api/admin/settings/ai', { data: { enabled: false } });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Help' }).click();
  await expect(page).toHaveURL(/\/help$/);
  await expect(page.getByRole('heading', { name: 'Public links and embedding' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Help assistant' })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Topics' }).getByText('Row-level security (RLS)')).toBeVisible();

  await page.getByLabel('Search the guide').fill('public link');
  await expect(page.getByRole('heading', { name: 'Public links and embedding' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Row-level security (RLS)' })).toHaveCount(0);
});
