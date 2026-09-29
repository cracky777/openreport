// Deux façons de se déplacer dans le parcours qui n'existaient pas.
//
// La bande qui dépasse à gauche et à droite montre l'étape voisine sans y
// mener : il fallait remonter au sélecteur du haut. On clique désormais là où
// elle se trouve. Et ce qu'elle montre ne réagit plus : viser le bouton d'une
// carte dont quatre-vingt-seize pixels dépassent tenait du hasard.
//
// Le filtre du parcours, lui, ne s'effaçait que. Poser la même question sur la
// branche d'à côté demandait de tout rouvrir et de reparcourir la liste ; il se
// modifie maintenant là où il se lit.
const { test, expect } = require('@playwright/test');

async function seed(page) {
  const ids = [];
  for (let i = 0; i < 3; i += 1) {
    const ds = await page.request.post('/api/datasources', {
      data: { name: `nav-src-${i}`, dbType: 'postgres', host: `n${i}.invalid`, port: 5432, dbName: 'd', dbUser: 'u', dbPassword: 'p' },
    });
    expect(ds.ok(), await ds.text()).toBeTruthy();
    const m = await page.request.post('/api/models', {
      data: { name: `nav-mod-${i}`, datasourceId: (await ds.json()).datasource.id, description: '' },
    });
    expect(m.ok(), await m.text()).toBeTruthy();
    const modelId = (await m.json()).model.id;
    ids.push(modelId);
    const r = await page.request.post('/api/reports', { data: { title: `nav-rap-${i}`, modelId, layout: [], widgets: {} } });
    expect(r.ok(), await r.text()).toBeTruthy();
  }
  return ids;
}

const panneau = (page, label) => page.locator(`[data-stage-panel][aria-label="${label}"]`);

// Une hauteur où, à cette abscisse, la bande est bien ce qu'on touche : le nom
// d'origine d'un trait peut s'y poser, et cliquer un nom suit le trait.
const hauteurLibre = (page, x) => page.evaluate((px) => {
  for (let y = 200; y < 880; y += 10) {
    const e = document.elementFromPoint(px, y);
    if (e && !e.closest('[data-join-layer] button') && e.closest('[data-stage-panel][data-peek]')) return y;
  }
  return null;
}, x);

test('cliquer la bande de gauche ou de droite mène à son étape', async ({ page }) => {
  await seed(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/models');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1200);

  // Le clic tombe sur le bord même de l'écran, là où la bande dépasse — c'est
  // le geste décrit, pas un clic au centre d'un panneau qu'on aurait cherché.
  const gauche = await panneau(page, 'Data Sources').boundingBox();
  expect(gauche.x, 'la bande de gauche doit dépasser à gauche').toBeLessThan(0);
  const yg = await hauteurLibre(page, 4);
  expect(yg, 'un point libre de la bande de gauche').not.toBeNull();
  await page.mouse.click(4, yg);
  await page.waitForURL(/\/datasources/);

  await page.waitForTimeout(1200);
  // Le bord droit du parcours, pas celui de la fenêtre : le rail de l'assistant
  // s'y range dès que l'IA est disponible, et sa gouttière de défilement aussi.
  const bord = await page.locator('[data-journey-ribbon]').evaluate((el) => {
    const vp = el.parentElement;
    return vp.getBoundingClientRect().left + vp.clientWidth;
  });
  const droite = await panneau(page, 'Data Models').boundingBox();
  expect(droite.x + droite.width, 'la bande de droite doit dépasser à droite').toBeGreaterThan(bord);
  const yd = await hauteurLibre(page, bord - 4);
  expect(yd, 'un point libre de la bande de droite').not.toBeNull();
  await page.mouse.click(bord - 4, yd);
  await page.waitForURL(/\/models/);
});

test('ce que montre la bande ne réagit pas au clic', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/models');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1200);

  // Une carte de la bande est bien rendue — elle doit l'être, c'est ce qui
  // permet de tracer les traits — mais elle n'accepte plus le clic.
  const carteBande = panneau(page, 'Data Sources').locator('[data-join-anchor^="sources:"]').first();
  await expect(carteBande).toHaveCount(1);
  const inerte = await carteBande.evaluate((el) => {
    // `pointer-events` est porté par l'enveloppe de la bande, pas par la carte.
    let n = el;
    while (n && n !== document.body) {
      if (getComputedStyle(n).pointerEvents === 'none') return true;
      n = n.parentElement;
    }
    return false;
  });
  expect(inerte, 'la bande doit être inerte').toBe(true);
});

test('le filtre affiché se change sans être effacé', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // On arrive filtré sur une branche, comme après avoir suivi un trait.
  const cible = await page.request.get('/api/models');
  const mods = (await cible.json()).models.filter((m) => m.name.startsWith('nav-mod-'));
  expect(mods.length).toBeGreaterThanOrEqual(2);

  await page.goto(`/models?focus=models:${mods[0].id}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1200);

  // Les trois étapes restent montées, donc trois fils d'Ariane existent — seul
  // celui de l'étape en cours est atteignable, les autres sont dans une bande
  // inerte. Le test vise donc l'étape en cours, comme la souris.
  const actif = page.locator('[data-stage-panel][aria-current="page"]');
  const crumb = actif.getByTitle('Highlight something else');
  await expect(crumb).toContainText(mods[0].name);

  // Le nom porte le choix : on ouvre, on prend une autre branche, et l'URL
  // suit — sans passer par « tout afficher » entre les deux.
  await crumb.click();
  await actif.getByRole('option', { name: mods[1].name, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`focus=models%3A${mods[1].id}`));
  await expect(actif.getByTitle('Highlight something else')).toContainText(mods[1].name);
});
