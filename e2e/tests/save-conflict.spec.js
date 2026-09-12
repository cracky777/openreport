// Guards the lot-4 fix in useSaveAndDirtyTracking: `proceed()` used to sit in a
// `finally`, so "Save and leave" navigated away whether or not the save landed.
// On a 409 the edits were gone and the error message went with the page.
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const F = require('../fixtures');

const ids = () => JSON.parse(fs.readFileSync(F.IDS_FILE, 'utf8'));

// The editor stamps its "last saved" snapshot at the very end of its load
// chain: it fetches the report, then the model, and only then records the
// baseline (pages/Editor.jsx, in the `load()` effect). Typing before that stamp
// lands makes the edit part of the baseline, so nothing reads as dirty and the
// guard never fires.
//
// The title appears long before the stamp, so asserting on it proves nothing,
// and `networkidle` is a guess: it fires after 500ms of quiet, which a slow
// runner can produce in the gap BETWEEN the report response and the model
// request. Waiting for the model response instead is exact — it is the last
// thing that happens before the baseline is recorded.
async function openEditor(page, reportId, expectedTitle) {
  await page.route('**/api/models/*/query', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ rows: [], rowCount: 0 }),
  }));
  const modelLoaded = page.waitForResponse(
    (r) => /\/api\/models\/[^/]+$/.test(r.url()) && r.request().method() === 'GET',
  );
  await page.goto(`/edit/${reportId}`);
  // Both, and in this order. The response alone is too early: it resolves
  // before the editor's own `await` continuation runs and records the
  // baseline. `networkidle` alone is too vague: on a slow runner it can fire in
  // the gap between the report response and the model request, before the chain
  // has even reached the model.
  await modelLoaded;
  await page.waitForLoadState('networkidle');
  if (expectedTitle) await expect(page.getByPlaceholder('Report title')).toHaveValue(expectedTitle);
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

test('a save that lands does leave', async ({ page, request }) => {
  // The other half — without it, a blocker that never proceeds would satisfy
  // the test above just as well.
  //
  // Its own report, created here rather than taken from the seed: this test
  // renames what it opens and the rename sticks, so a shared fixture satisfies
  // it exactly once. The second run — a CI retry, for instance — opened a
  // report already carrying the new name and failed on the precondition,
  // reporting that instead of whatever went wrong the first time.
  const { modelId } = ids();
  const created = await request.post('/api/reports', {
    data: { title: `Rapport e2e a renommer ${Date.now()}`, modelId },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const reportId = (await created.json()).report.id;

  const title = await openEditor(page, reportId);

  await title.fill('Rapport e2e bis renomme');
  await title.blur();

  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: 'Unsaved changes' })).toBeVisible();
  await page.getByRole('button', { name: 'Save and leave' }).click();

  await expect(page).not.toHaveURL(new RegExp(`/edit/${reportId}$`));
});
