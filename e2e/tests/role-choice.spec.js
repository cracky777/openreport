// The first arrival on the app asks how the user works (Jonathan: "I want to
// construct my report" → Build, "I want to talk to my data" → the assistant),
// once, and only when the assistant answers: the side picked is kept on the
// account, the next visit opens on it without asking again.
const { test, expect } = require('@playwright/test');
const F = require('../fixtures');

async function freshUser(page, browser, baseURL) {
  const email = `first-visit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@open-report.local`;
  const created = await page.request.post('/api/admin/users', { data: { email, password: 'Password-1234!', displayName: 'First visit', role: 'editor' } });
  expect(created.status()).toBe(201);
  const ctx = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const user = await ctx.newPage();
  await user.setViewportSize({ width: 1440, height: 900 });
  expect((await user.request.post('/api/auth/login', { data: { email, password: 'Password-1234!' } })).ok()).toBeTruthy();
  return { ctx, user, id: (await created.json()).user?.id };
}

test.describe('the first-visit choice', () => {
  let provider;
  test.beforeAll(async () => { provider = await F.startScriptedProvider(() => ({ text: 'Hello' })); });
  test.afterAll(() => provider.server.close());
  test.beforeEach(async ({ page }) => {
    await page.request.put('/api/admin/settings/ai', {
      data: { provider: 'openai-compat', baseUrl: provider.url, model: 'scripted', enabled: true, dataSharing: 'schema' },
    });
  });
  test.afterEach(async ({ page }) => { await page.request.put('/api/admin/settings/ai', { data: { enabled: false } }); });

  test('"I want to talk to my data" opens the assistant, and the next visit goes straight there', async ({ page, browser, baseURL }) => {
    const { ctx, user } = await freshUser(page, browser, baseURL);
    try {
      await user.goto('/');
      const dialog = user.getByRole('dialog', { name: 'How would you like to work ?' });
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: /I want to talk to my data/ }).click();
      await expect(user).toHaveURL(/\/chat/);
      await user.goto('/');
      await expect(user).toHaveURL(/\/chat/);
      await expect(user.getByRole('dialog', { name: 'How would you like to work ?' })).toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });

  test('"I want to build my report manually" stays on Build and is not asked again', async ({ page, browser, baseURL }) => {
    const { ctx, user } = await freshUser(page, browser, baseURL);
    try {
      await user.goto('/');
      const dialog = user.getByRole('dialog', { name: 'How would you like to work ?' });
      await dialog.getByRole('button', { name: /I want to build my report manually/ }).click();
      await expect(dialog).toHaveCount(0);
      await expect(user).not.toHaveURL(/\/chat/);
      await user.reload();
      await expect(user.getByRole('button', { name: /Reports/ }).first()).toBeVisible();
      await expect(user.getByRole('dialog', { name: 'How would you like to work ?' })).toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });
});

test('without the assistant, nothing is asked: the app opens on Build', async ({ page, browser, baseURL }) => {
  await page.request.put('/api/admin/settings/ai', { data: { enabled: false } });
  const { ctx, user } = await freshUser(page, browser, baseURL);
  try {
    await user.goto('/');
    await expect(user.getByRole('button', { name: /Reports/ }).first()).toBeVisible();
    await expect(user.getByRole('dialog', { name: 'How would you like to work ?' })).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});
