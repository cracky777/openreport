// The journey ribbon slides when the user moves from one stage to another —
// and only then. Arriving from another page used to play the slide too: the
// shell mounts, then settles as the viewport is measured and the permissions
// bring Sources / Models onto the ribbon, and each settle was animated.
//
// Counted on the ribbon itself: every CSS transition it runs is recorded, so
// "did it slide" is a fact about the page, not a guess from a screenshot.
const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__ribbonSlides = 0;
    document.addEventListener('transitionrun', (e) => {
      if (e.target instanceof Element && e.target.hasAttribute('data-journey-ribbon') && e.propertyName === 'transform') {
        window.__ribbonSlides += 1;
      }
    }, true);
  });
});

// In-app navigation, as a link or the back button would do it: the shell is
// mounted fresh by the router, not by a page load.
async function goInApp(page, path) {
  await page.evaluate((to) => {
    window.history.pushState({}, '', to);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}

test('arriving on a stage from another page does not slide; moving between stages does', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/alerts');
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => { window.__ribbonSlides = 0; });

  await goInApp(page, '/models');
  await expect(page.locator('[data-journey-ribbon]')).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(900);
  expect(await page.evaluate(() => window.__ribbonSlides), 'the ribbon slid on arrival').toBe(0);

  await page.locator('nav[aria-label="Data journey"] button', { hasText: 'Reports' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(() => page.evaluate(() => window.__ribbonSlides)).toBeGreaterThan(0);
});
