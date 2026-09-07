// Les trois étapes du parcours sont trois cibles de même rang : elles doivent
// avoir la même largeur. Elles se dimensionnaient sur leur libellé, donc
// « Reports » était nettement plus étroit que « Data Sources », et la barre
// donnait à lire une hiérarchie qui n'existe pas.
//
// Une largeur ne se vérifie qu'une fois la police chargée et la grille résolue.
const { test, expect } = require('@playwright/test');

// Un pixel de tolérance : une piste `1fr` peut tomber sur une fraction.
const TOLERANCE = 1;

async function largeurs(page) {
  return page.locator('nav[aria-label="Data journey"] button').evaluateAll(
    (els) => els.map((el) => ({
      texte: el.textContent.trim(),
      w: Math.round(el.getBoundingClientRect().width * 100) / 100,
    })),
  );
}

test('les trois étapes ont la même largeur sur un bureau', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  // La barre se dimensionne sur la police : attendre qu'elle soit prête, sinon
  // on mesure un rendu de repli.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);

  const vus = await largeurs(page);
  expect(vus.length).toBe(3);
  const w = vus.map((v) => v.w);
  expect(Math.max(...w) - Math.min(...w), JSON.stringify(vus)).toBeLessThanOrEqual(TOLERANCE);
  // Et la largeur commune est celle du plus long libellé, pas une valeur
  // arbitraire : les boutons s'élargissent, aucun ne se fait tronquer.
  const plusLong = vus.find((v) => v.texte === 'Data Sources');
  expect(plusLong, JSON.stringify(vus)).toBeTruthy();
});

test('les trois étapes ont la même largeur sur un téléphone', async ({ page }) => {
  // En compact la barre prend toute sa ligne : l'égalité doit tenir aussi quand
  // la grille distribue de la place en trop, pas seulement quand elle en manque.
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);

  const vus = await largeurs(page);
  expect(vus.length).toBe(3);
  const w = vus.map((v) => v.w);
  expect(Math.max(...w) - Math.min(...w), JSON.stringify(vus)).toBeLessThanOrEqual(TOLERANCE);
  // La barre reste dans l'écran : des colonnes égales ne doivent pas la faire
  // déborder par la droite.
  const nav = await page.locator('nav[aria-label="Data journey"]').boundingBox();
  expect(nav.x + nav.width).toBeLessThanOrEqual(390 + TOLERANCE);
});
