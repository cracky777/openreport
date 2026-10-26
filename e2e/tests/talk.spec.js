// Let's Talk, the fourth way into the chat home (components/Talk/TalkConversation):
// a conversation about a model with no report, the assistant's visual drawn in
// the conversation, the model kept in the address so a reload finds the thread.
const { test, expect } = require('@playwright/test');
const F = require('../fixtures');

// Answers with a bar chart straight away.
const script = () => ({
  name: 'propose_widgets',
  arguments: {
    widgets: [{
      type: 'bar',
      title: 'Sales by country (talk)',
      rationale: 'Ranks countries by sales.',
      binding: { selectedDimensions: [F.DIM], selectedMeasures: [F.MEASURE] },
    }],
  },
});

test.afterEach(async ({ page }) => {
  await page.request.put('/api/auth/me/ui-mode', { data: { mode: 'build' } });
});

test("a message typed with no card picked opens Let's Talk: asked once the model is picked, the visual drawn in the thread", async ({ page }) => {
  const provider = await F.startScriptedProvider(script);
  try {
    const saved = await page.request.put('/api/admin/settings/ai', {
      data: { provider: 'openai-compat', baseUrl: provider.url, model: 'scripted', enabled: true, dataSharing: 'schema+cache' },
    });
    expect(saved.ok()).toBeTruthy();
    await page.route('**/api/models/*/query', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ rows: [{ [F.DIM_LABEL]: 'France', [F.MEASURE_LABEL]: 100 }, { [F.DIM_LABEL]: 'Spain', [F.MEASURE_LABEL]: 60 }], rowCount: 2 }),
    }));

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/chat');
    // Typed with no card picked: a conversation, on the model picked next.
    await page.getByLabel('Describe the report you want').fill('Which countries sell the most?');
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
    // Several models (other specs add theirs): which one is asked; a single one opens at once.
    const which = page.getByText('Which data model is your question about? Pick it above.');
    await which.or(page.getByRole('button', { name: 'New conversation' })).first().waitFor();
    if (await which.isVisible()) await page.getByRole('button', { name: 'e2e-model' }).click();
    await expect(page).toHaveURL(/\/chat\?talk=[\w-]+$/);

    await expect(page.getByText('Which countries sell the most?')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add to report' })).toBeVisible({ timeout: 20000 });
    await expect(page.locator('canvas').first()).toBeVisible();
    // No title over the chart: the answer already says what it draws.
    await expect(page.getByText('Sales by country (talk)')).toHaveCount(0);
    // Asked as a conversation, not as the panel's terse visual-only answer.
    const system = provider.requests[0].messages[0].content;
    expect(system).toContain('This is a conversation');

    // Reloaded: the same model, the same thread.
    await page.reload();
    await expect(page.getByRole('button', { name: 'Add to report' })).toBeVisible({ timeout: 20000 });
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page).toHaveURL(/\/chat$/);
    await expect(page.getByRole('button', { name: /Let's Talk/ })).toBeVisible();
  } finally {
    await page.request.put('/api/admin/settings/ai', { data: { enabled: false } });
    provider.server.close();
  }
});
