// Changer de compte dans le même onglet. Le workspace ouvert vit au-dessus du
// routeur, et il survivait à la déconnexion : un compte neuf se connectait
// « dans » le workspace qu'avait ouvert le compte précédent — un workspace où il
// n'a aucun rôle —, ne voyait rien et ne pouvait rien créer. Seul un
// rechargement de la page l'en sortait.
//
// Dans un contexte à part : se déconnecter y ferme sa propre session, pas celle
// que partagent les autres specs.
const { test, expect } = require('@playwright/test');
const F = require('../fixtures');

test('un compte qui se connecte après un autre, dans le même onglet, arrive sur son My Reports', async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  try {
    const page = await ctx.newPage();
    expect((await page.request.post('/api/auth/login', { data: F.USER })).ok()).toBeTruthy();
    const name = `Admin only ${Date.now()}`;
    expect((await page.request.post('/api/workspaces', { data: { name } })).ok()).toBeTruthy();
    const email = `switch-editor-${Date.now()}@open-report.local`;
    const password = 'Password-1234!';
    expect((await page.request.post('/api/admin/users', { data: { email, password, displayName: 'Switch editor', role: 'editor' } })).status()).toBe(201);

    // L'admin ouvre son workspace, puis se déconnecte.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await page.locator('header').getByRole('button', { name: 'My Reports' }).click();
    await page.getByRole('button', { name }).first().click();
    await expect(page.locator('header').getByRole('button', { name })).toBeVisible();
    await page.locator('header').getByRole('button', { name: 'Account' }).click();
    await page.getByRole('button', { name: 'Logout' }).click();

    // Le nouveau compte, sans recharger.
    await page.getByPlaceholder('Email').fill(email);
    await page.getByPlaceholder('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('header').getByRole('button', { name: 'My Reports' })).toBeVisible();
    await expect(page.locator('header').getByRole('button', { name })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '+ New Report' })).toBeVisible();
  } finally {
    await ctx.close();
  }
});
