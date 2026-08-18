// Guards the lot-4 fix in useSaveAndDirtyTracking: `proceed()` used to sit in a
// `finally`, so "Save and leave" navigated away whether or not the save landed.
// On a 409 the edits were gone and the error message went with the page.
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const F = require('../fixtures');

const ids = () => JSON.parse(fs.readFileSync(F.IDS_FILE, 'utf8'));

// The editor stamps its "last saved" snapshot at the END of a load chain
// (report → model → widget queries). Typing before that stamp lands makes the
// edit part of the baseline, and nothing is dirty — so wait for the chain to go
// quiet, then edit.
async function openEditor(page, reportId, expectedTitle) {
  await page.route('**/api/models/*/query', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ rows: [], rowCount: 0 }),
  }));
  await page.goto(`/edit/${reportId}`);
  await expect(page.getByPlaceholder('Report title')).toHaveValue(expectedTitle);
  await page.waitForLoadState('networkidle');
  return page.getByPlaceholder('Report title');
}

test('a save refused on the title keeps the editor open', async ({ page }) => {
  const { reportId } = ids();
  const title = await openEditor(page, reportId, 'Rapport e2e');

  // Take the title another report already holds — the server answers 409.
  await title.fill(F.TAKEN_TITLE);
  await title.blur();

  const conflict = page.waitForResponse(
    (r) => r.url().includes(`/api/reports/${reportId}`) && r.request().method() === 'PUT' && r.status() === 409,
  );

  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: 'Unsaved changes' })).toBeVisible();
  await page.getByRole('button', { name: 'Save and leave' }).click();
  await conflict;

  // The whole point: the save was refused, so no navigation.
  await expect(page).toHaveURL(new RegExp(`/edit/${reportId}$`));
  // And the reason is still on screen, where the user can read it.
  await expect(page.getByText(/already exists|Save failed/i).first()).toBeVisible();
});

test('a save that lands does leave', async ({ page }) => {
  // The other half — without it, a blocker that never proceeds would satisfy
  // the test above just as well.
  const { renameReportId } = ids();
  const title = await openEditor(page, renameReportId, 'Rapport e2e bis');

  await title.fill('Rapport e2e bis renomme');
  await title.blur();

  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: 'Unsaved changes' })).toBeVisible();
  await page.getByRole('button', { name: 'Save and leave' }).click();

  await expect(page).not.toHaveURL(new RegExp(`/edit/${renameReportId}$`));
});
