// Following a join highlights a branch; it no longer hides the rest.
//
// A click on a name or a count on a join used to narrow every column to the
// branch, so the other cards vanished and the columns reshuffled under the
// user. Now every card stays where it was: what the branch reaches keeps its
// look, the rest is greyed out, and so are the curves that run to it.
const { test, expect } = require('@playwright/test');

const stamp = Date.now();

async function seed(request, tag = 'hl') {
  const out = [];
  for (let i = 0; i < 2; i += 1) {
    const ds = await request.post('/api/datasources', {
      data: { name: `${tag}-src-${i}-${stamp}`, dbType: 'postgres', host: `h${i}.invalid`, port: 5432, dbName: 'd', dbUser: 'u', dbPassword: 'p' },
    });
    expect(ds.ok(), await ds.text()).toBeTruthy();
    const dsId = (await ds.json()).datasource.id;
    const m = await request.post('/api/models', {
      data: { name: `${tag}-mod-${i}-${stamp}`, datasourceId: dsId, description: '' },
    });
    expect(m.ok(), await m.text()).toBeTruthy();
    const model = (await m.json()).model;
    const r = await request.post('/api/reports', { data: { title: `${tag}-rap-${i}-${stamp}`, modelId: model.id, layout: [], widgets: {} } });
    expect(r.ok(), await r.text()).toBeTruthy();
    out.push({ dsId, model, report: (await r.json()).report });
  }
  return out;
}

const card = (page, key) => page.locator(`[data-join-anchor="${key}"]`);

test('following a join greys out what the branch does not reach, and hides nothing', async ({ page, request }) => {
  const [a, b] = await seed(request);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/models');
  await expect(card(page, `models:${a.model.id}`)).toBeVisible();

  // The count parked past model A's card: "1 report".
  await card(page, `models:${a.model.id}`).scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const tally = page.locator('[data-join-layer] button', { hasText: /^1 report$/ });
  const aBox = await card(page, `models:${a.model.id}`).boundingBox();
  // The tally on A's row, not on another model's.
  let target = null;
  for (const t of await tally.all()) {
    const bx = await t.boundingBox();
    if (bx && Math.abs((bx.y + bx.height / 2) - (aBox.y + aBox.height / 2)) < 6) { target = t; break; }
  }
  expect(target, 'the count next to model A').not.toBeNull();
  await target.click();
  await expect(page).toHaveURL(/\/\?focus=models%3A|\/\?focus=models:/);

  // Both reports are still there, B's greyed out, A's as it was.
  const repA = card(page, `reports:${a.report.id}`);
  const repB = card(page, `reports:${b.report.id}`);
  await expect(repA).toHaveCount(1);
  await expect(repB).toHaveCount(1);
  await expect(repA).not.toHaveAttribute('data-journey-dim', '');
  await expect(repB).toHaveAttribute('data-journey-dim', '');
  expect(Number(await repB.evaluate((el) => getComputedStyle(el).opacity))).toBeLessThan(0.5);
  expect(Number(await repA.evaluate((el) => getComputedStyle(el).opacity))).toBe(1);

  // The other columns keep every card too, and grey the same way.
  await expect(card(page, `models:${b.model.id}`)).toHaveAttribute('data-journey-dim', '');
  await expect(card(page, `models:${a.model.id}`)).not.toHaveAttribute('data-journey-dim', '');
  await expect(card(page, `sources:${b.dsId}`)).toHaveAttribute('data-journey-dim', '');

  // The crumb says so, and clears it.
  const active = page.locator('[data-stage-panel][aria-current="page"]');
  await active.getByTitle('Clear the highlight').click();
  await expect(page.locator('[data-journey-dim]')).toHaveCount(0);
});

// Nothing moves, so the branch can sit far down a long column: arriving on it
// scrolls its first card into view.
test('arriving on a highlight scrolls its first card into view', async ({ page, request }) => {
  const [a, b] = await seed(request, 'sc');
  // A dozen reports on A push B's, which follows them, well below the fold.
  for (let i = 0; i < 12; i += 1) {
    const r = await request.post('/api/reports', { data: { title: `sc-pad-${i}-${stamp}`, modelId: a.model.id, layout: [], widgets: {} } });
    expect(r.ok(), await r.text()).toBeTruthy();
  }
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/?focus=models:${b.model.id}`);

  const repB = card(page, `reports:${b.report.id}`);
  await expect(repB).toHaveCount(1);
  await expect(repB).not.toHaveAttribute('data-journey-dim', '');
  await expect.poll(async () => {
    const r = await repB.boundingBox();
    return !!r && r.y >= 0 && r.y + r.height <= 900;
  }, { message: 'the highlighted report is on screen' }).toBe(true);
});

// A click anywhere lets go of the highlight; walking the journey keeps it.
test('a click elsewhere clears the highlight, the stage switcher keeps it', async ({ page, request }) => {
  const [, b] = await seed(request, 'ck');
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/?focus=models:${b.model.id}`);
  await expect(page.locator('[data-journey-dim]').first()).toBeAttached();

  // Another stage, the same branch.
  await page.locator('header').getByRole('button', { name: 'Data Models' }).click();
  await expect(page).toHaveURL(/\/models\?focus=models/);
  await expect(page.locator('[data-journey-dim]').first()).toBeAttached();

  // Empty header space, between the workspace picker and the stage switcher.
  await page.mouse.click(420, 28);
  await expect(page).not.toHaveURL(/focus=/);
  await expect(page.locator('[data-journey-dim]')).toHaveCount(0);
});
