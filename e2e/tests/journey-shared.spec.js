// « Quand je partage un modèle de données et son rapport à un workspace, il
// perd ses relations. »
//
// La couche de liens traçait ses courbes depuis la liste des rapports que le
// graphe détient — ceux dont on est l'auteur — alors que la colonne Rapports
// montre ce que le workspace contient : le rapport d'un collègue, un rapport
// partagé. Leurs cartes étaient là, sans aucun trait. Et la source d'un modèle
// seulement partagé n'est pas partagée avec lui : sans carte, le trait du
// modèle n'avait nulle part où arriver.
//
// Désormais chaque carte dit de qui elle dépend, et la source non partagée se
// montre verrouillée — son nom, rien à ouvrir. Rien de tout ça hors d'un
// navigateur : c'est ce que la page rend.
const { test, expect } = require('@playwright/test');

test('un modèle et son rapport partagés gardent leurs relations', async ({ page, browser, baseURL }) => {
  // Bob, un second compte, bâtit source, modèle et rapport chez lui.
  const bobCtx = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const bob = bobCtx.request;
  const reg = await bob.post('/api/auth/register', { data: { email: 'bob-shared@open-report.local', password: 'bob-password-1234', displayName: 'Bob' } });
  expect(reg.ok(), await reg.text()).toBeTruthy();
  const ds = await bob.post('/api/datasources', {
    data: { name: 'bob-src', dbType: 'postgres', host: 'bob.invalid', port: 5432, dbName: 'd', dbUser: 'u', dbPassword: 'p' },
  });
  expect(ds.ok(), await ds.text()).toBeTruthy();
  const m = await bob.post('/api/models', { data: { name: 'bob-model', datasourceId: (await ds.json()).datasource.id, description: '' } });
  expect(m.ok(), await m.text()).toBeTruthy();
  const modelId = (await m.json()).model.id;
  const r = await bob.post('/api/reports', { data: { title: 'bob-report', modelId, layout: [], widgets: {} } });
  expect(r.ok(), await r.text()).toBeTruthy();
  const reportId = (await r.json()).report.id;

  // L'équipe : un workspace de l'admin où Bob est éditeur. Bob y partage son
  // modèle et son rapport — pas sa source.
  const ws = await page.request.post('/api/workspaces', { data: { name: 'Shared journey' } });
  expect(ws.ok(), await ws.text()).toBeTruthy();
  const wsId = (await ws.json()).workspace.id;
  const add = await page.request.post(`/api/workspaces/${wsId}/members`, { data: { email: 'bob-shared@open-report.local', role: 'editor' } });
  expect(add.ok(), await add.text()).toBeTruthy();
  expect((await bob.put(`/api/models/${modelId}/shares`, { data: { workspaceIds: [wsId] } })).ok()).toBeTruthy();
  const share = await bob.put(`/api/reports/${reportId}/shares`, { data: { workspaceIds: [wsId] } });
  expect(share.ok(), await share.text()).toBeTruthy();
  await bobCtx.close();

  // L'admin ouvre ce workspace.
  const me = await (await page.request.get('/api/auth/me')).json();
  const userId = (me.user || me).id;
  await page.addInitScript(([key, id]) => { window.localStorage.setItem(key, id); }, [`openreport.lastWorkspace.${userId}`, wsId]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/models');

  const host = page.locator('[data-join-layer]');
  await expect(page.locator(`[data-join-anchor="reports:${reportId}"]`)).toHaveCount(1);
  await expect(page.locator(`[data-join-anchor="models:${modelId}"]`)).toHaveCount(1);
  // La source n'est pas partagée : une carte verrouillée, sans rien à ouvrir.
  const locked = page.locator('[data-join-anchor^="sources:"]', { hasText: 'Not shared with this workspace' });
  await expect(locked).toHaveCount(1);
  await expect(locked.locator('button')).toHaveCount(0);

  // Source → modèle et modèle → rapport : deux courbes.
  await expect(host.locator('svg > path[d]')).toHaveCount(2);

  // Son menu entier s'y fait d'ici ; seule la suppression reste chez lui.
  await page.goto('/');
  const card = page.locator(`[data-join-anchor="reports:${reportId}"]`);
  await expect(card).toHaveCount(1);
  // La corbeille porte un sens interdit ; le survol dit pourquoi, le clic ne fait rien.
  const bin = card.locator('button[aria-disabled="true"][aria-label^="Delete report"]');
  await expect(bin).toHaveCount(1);
  await expect(bin).toHaveAttribute('title', 'Cannot delete it because it is shared');
  await bin.click({ force: true });
  await expect(card.locator('button[title="Click again to confirm"]')).toHaveCount(0);
  await card.locator('button[title="More actions"]').click();
  for (const item of ['Rename', 'Duplicate', 'Export report', 'Move to workspace', 'Share report', 'Schedule refresh']) {
    await expect(card.getByRole('button', { name: item })).toBeVisible();
  }
});
