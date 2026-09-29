// La vue d'ensemble : les trois étapes à la fois, réduites pour tenir dans
// l'écran, avec leurs liaisons. Le ruban est mis à l'échelle ; la couche de
// liens mesure les cartes à l'écran et doit dessiner dans les unités du ruban,
// sans quoi chaque courbe serait réduite une seconde fois et partirait loin de
// ses cartes. Rien de tout ça hors d'un navigateur.
const { test, expect } = require('@playwright/test');

test('la vue d\'ensemble montre les trois étapes et leurs liaisons, puis rend la main', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/models');
  await expect(page.locator('[data-join-anchor^="models:"]').first()).toBeVisible();

  await page.getByRole('button', { name: 'Overview' }).click();
  const ribbon = page.locator('[data-journey-ribbon][data-overview]');
  await expect(ribbon).toHaveCount(1);
  // Les traits gardent leurs compteurs, pas le nom de leur origine.
  await expect(page.locator('[data-join-layer] button', { hasText: 'e2e-model' })).toHaveCount(0);
  await expect(page.locator('[data-join-layer] button', { hasText: /reports?$/ }).first()).toBeVisible();
  // Aucune étape n'est sélectionnée : la vue d'ensemble n'en est pas une.
  await expect(page.locator('header [aria-current="page"]')).toHaveCount(0);

  // Les trois colonnes tiennent dans la largeur de la fenêtre.
  const panels = page.locator('[data-stage-panel]');
  await expect(panels).toHaveCount(3);
  for (const box of await panels.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()))) {
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(1600);
  }

  // Chaque courbe part d'une carte et arrive sur une autre : ses extrémités,
  // ramenées à l'écran, tombent sur le bord des cartes qu'elle relie.
  const curves = page.locator('[data-join-layer] svg > path[d]');
  await expect(curves.first()).toBeAttached();
  const onEdges = await page.evaluate(() => {
    const layer = document.querySelector('[data-join-layer]');
    const host = layer.parentElement;
    const box = host.getBoundingClientRect();
    const scale = box.width / host.offsetWidth;
    const cards = [...host.querySelectorAll('[data-join-anchor]')].map((el) => el.getBoundingClientRect());
    return [...layer.querySelectorAll('svg > path[d]')].map((p) => {
      const n = p.getAttribute('d').match(/-?\d+(\.\d+)?/g).map(Number);
      const start = { x: box.left + n[0] * scale, y: box.top + n[1] * scale };
      const end = { x: box.left + n[n.length - 2] * scale, y: box.top + n[n.length - 1] * scale };
      const near = (pt, edge) => cards.some((r) => Math.abs(r[edge] - pt.x) < 2 && pt.y >= r.top - 1 && pt.y <= r.bottom + 1);
      return near(start, 'right') && near(end, 'left');
    });
  });
  expect(onEdges.length).toBeGreaterThan(0);
  expect(onEdges.every(Boolean)).toBe(true);

  // Échap rend l'étape ; un clic sur une colonne y mène.
  await page.keyboard.press('Escape');
  await expect(ribbon).toHaveCount(0);
  await expect(page.locator('header [aria-current="page"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Overview' }).click();
  await page.locator('[data-stage-panel][aria-label="Data Sources"]').click({ position: { x: 20, y: 20 } });
  await expect(page).toHaveURL(/\/datasources/);
  await expect(page.locator('[data-journey-ribbon][data-overview]')).toHaveCount(0);
});
