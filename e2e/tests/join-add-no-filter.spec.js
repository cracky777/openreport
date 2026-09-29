// The "+" at the end of a card creates on it; it does not filter on it.
//
// It used to carry `focus=` along with the item to pre-pick, so creating a
// report on a model left the whole journey narrowed to that model. Only a click
// on a name follows a branch. The pre-picked item must survive: it rides on its
// own parameter, not on the focus.
const { test, expect } = require('@playwright/test');

// The crumb that says a branch is highlighted.
const crumb = (page) => page.getByTitle('Clear the highlight');

test('the + on a model card opens a new report on it, unfiltered', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/models');
  await page.getByRole('button', { name: 'Add a report on e2e-model' }).first().click();

  const heading = page.getByRole('heading', { name: /^New Report/ });
  await expect(heading).toBeVisible();
  // The dialog's own model picker, the closest box around the heading holding one.
  const picker = heading.locator('xpath=ancestor::div[.//select][1]').locator('select').first();
  await expect(picker.locator('option:checked')).toHaveText('e2e-model');
  expect(new URL(page.url()).searchParams.get('focus')).toBeNull();
  await expect(crumb(page)).toHaveCount(0);
});

test('the + on a source card opens a new model on it, unfiltered', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/datasources');
  await page.getByRole('button', { name: 'Add a data model on e2e-ds' }).first().click();

  await expect(page.locator('select').filter({ has: page.locator('option:checked', { hasText: 'e2e-ds' }) })).toHaveCount(1);
  expect(new URL(page.url()).searchParams.get('focus')).toBeNull();
  await expect(crumb(page)).toHaveCount(0);
});
