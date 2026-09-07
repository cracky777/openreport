// « Le problème vient des lignes qui ne sont pas visibles par l'écran. »
//
// Les colonnes voisines étaient coupées à la hauteur d'un écran, pour que la
// colonne en cours seule décide de la longueur de défilement. Mais une carte
// coupée n'est pas dans le document visible, et la couche de liens ne trace
// rien vers une carte absente : passé une liste d'un écran, des relations bien
// réelles n'avaient plus aucun trait. Vu de l'utilisateur : « ce modèle a deux
// rapports et je ne vois qu'une ligne » — et c'était exact.
//
// Les trois colonnes forment donc un seul ensemble : chacune se rend tout
// entière, la plus longue donne sa hauteur, et le parcours complet se parcourt.
//
// Rien de tout ça hors d'un navigateur : c'est une propriété de mise en page.
const { test, expect } = require('@playwright/test');

// De quoi déborder largement d'un écran — c'est la seule condition du défaut.
const MODELES = 14;
// Un modèle sur deux en porte deux : la forme exacte du signalement.
const DEUX = (i) => i % 2 === 0;

async function seed(page) {
  let relations = { sources: 0, reports: 0 };
  for (let i = 0; i < MODELES; i += 1) {
    const ds = await page.request.post('/api/datasources', {
      data: { name: `w-src-${i}`, dbType: 'postgres', host: `w${i}.invalid`, port: 5432, dbName: 'd', dbUser: 'u', dbPassword: 'p' },
    });
    expect(ds.ok(), await ds.text()).toBeTruthy();
    const m = await page.request.post('/api/models', {
      data: { name: `w-mod-${i}`, datasourceId: (await ds.json()).datasource.id, description: '' },
    });
    expect(m.ok(), await m.text()).toBeTruthy();
    const modelId = (await m.json()).model.id;
    relations.sources += 1;
    for (let j = 0; j < (DEUX(i) ? 2 : 1); j += 1) {
      const r = await page.request.post('/api/reports', { data: { title: `w-rap-${i}-${j}`, modelId, layout: [], widgets: {} } });
      expect(r.ok(), await r.text()).toBeTruthy();
      relations.reports += 1;
    }
  }
  return relations;
}

// Ce que la page rend : le nombre de cartes de chaque colonne, et le nombre de
// courbes. Les cartes sont comptées dans le document — une carte coupée hors de
// sa colonne n'y est plus, et c'est précisément ce qu'il faut détecter.
function releve() {
  const layer = document.querySelector('[data-join-layer]');
  const host = layer && layer.parentElement;
  if (!host) return { erreur: 'couche absente' };
  const cartes = (stage) => [...host.querySelectorAll(`[data-join-anchor^="${stage}:"]`)];
  const coupee = (el) => {
    const pan = el.closest('[data-stage-panel]');
    if (!pan) return false;
    const r = el.getBoundingClientRect();
    const p = pan.getBoundingClientRect();
    return r.bottom <= p.top || r.top >= p.bottom;
  };
  const toutes = [...cartes('sources'), ...cartes('models'), ...cartes('reports')];
  const ds = [...layer.querySelectorAll('svg > path[d]')].map((n) => n.getAttribute('d'));
  return {
    sources: cartes('sources').length,
    models: cartes('models').length,
    reports: cartes('reports').length,
    // Aucune carte ne doit sortir de sa colonne : c'est la coupure elle-même.
    coupees: toutes.filter(coupee).length,
    courbes: ds.length,
    // Deux courbes identiques ne font qu'une tache : elles compteraient pour
    // deux tout en n'en montrant qu'une.
    distinctes: new Set(ds).size,
  };
}

test('le parcours entier est traçable, même sur plusieurs écrans', async ({ page }) => {
  const attendu = await seed(page);

  // Une fenêtre ordinaire : les colonnes font plusieurs fois sa hauteur. C'est
  // le cas courant, pas un cas limite — quatorze modèles suffisent.
  await page.setViewportSize({ width: 1440, height: 800 });

  for (const route of ['/', '/models', '/datasources']) {
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const vu = await page.evaluate(releve);
    expect(vu.erreur, route).toBeUndefined();

    // Les trois colonnes se rendent tout entières, celle en cours comme ses
    // voisines. Sans le correctif les voisines s'arrêtent à un écran.
    expect(vu.coupees, `${route} : des cartes sortent de leur colonne`).toBe(0);
    expect(vu.sources, route).toBeGreaterThanOrEqual(attendu.sources);
    expect(vu.models, route).toBeGreaterThanOrEqual(attendu.sources);
    expect(vu.reports, route).toBeGreaterThanOrEqual(attendu.reports);

    // Le cœur : autant de traits que de relations. Une source par modèle, plus
    // un modèle par rapport. Sans le correctif il en manque la moitié, et c'est
    // exactement ce qui se lisait comme « je ne vois qu'une ligne sur deux ».
    expect(vu.courbes, `${route} : des relations ne sont pas tracées`)
      .toBeGreaterThanOrEqual(attendu.sources + attendu.reports);
    // Et chacun se voit : deux courbes superposées n'en montrent qu'une.
    expect(vu.distinctes, `${route} : des courbes se recouvrent`).toBe(vu.courbes);
  }
});
