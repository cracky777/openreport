// The tours (components/Tour): on arrival in the app, in the report editor and
// in the model editor, bubbles point at where things are. They come back on
// every arrival until "Don't show this tutorial again" is ticked; "Show me
// around" replays them. The shared session starts with them off: each test
// here turns its tour back on.
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const F = require('../fixtures');

const ids = () => JSON.parse(fs.readFileSync(F.IDS_FILE, 'utf8'));

async function turnOn(page, tour) {
  const me = await (await page.request.get('/api/auth/me')).json();
  await page.addInitScript((k) => {
    if (!sessionStorage.getItem('tour-on')) {
      localStorage.removeItem(k);
      sessionStorage.setItem('tour-on', '1');
    }
  }, `openreport.${tour}TourOff.${(me.user || me).id}`);
}

test('the report editor tour walks through the editor, and stops for good when asked', async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ baseURL, storageState: F.AUTH_STATE });
  try {
    const page = await ctx.newPage();
    await turnOn(page, 'editor');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/edit/${ids().reportId}`);

    const bubble = page.getByRole('dialog', { name: 'Add a visual' });
    await expect(bubble).toBeVisible();
    await expect(bubble.getByText(/^1 of \d+$/)).toBeVisible();
    await bubble.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByRole('dialog', { name: 'Your fields' })).toBeVisible();
    await page.getByRole('dialog', { name: 'Your fields' }).getByRole('button', { name: 'Back' }).click();

    // Closed without the flag: back on the next arrival.
    await page.getByRole('button', { name: 'Skip the tour' }).click();
    await expect(page.getByRole('dialog', { name: 'Your fields' })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('dialog', { name: 'Add a visual' })).toBeVisible();

    // Flagged: never again for this user — still on demand.
    await page.getByLabel("Don't show this tutorial again").check();
    await page.getByRole('button', { name: 'Skip the tour' }).click();
    await page.reload();
    await expect(page.locator('.widget-content').first()).toBeVisible();
    await page.waitForTimeout(1000);
    await expect(page.getByRole('dialog', { name: 'Add a visual' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Show me around' }).click();
    await expect(page.getByRole('dialog', { name: 'Add a visual' })).toBeVisible();
  } finally {
    await ctx.close();
  }
});

test('arriving in the app, the tour points at the stages, where reports are made and where to ask', async ({ page }) => {
  await turnOn(page, 'home');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  // One bubble per stage, then the rest.
  for (const stage of ['Data Sources', 'Data Models', 'Reports']) {
    const bubble = page.getByRole('dialog', { name: stage });
    await expect(bubble).toBeVisible();
    await bubble.getByRole('button', { name: 'Next' }).click();
  }
  await expect(page.getByRole('dialog', { name: 'Where you work' })).toBeVisible();
  await page.getByRole('dialog', { name: 'Where you work' }).getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('dialog', { name: 'Create a report' })).toBeVisible();
  // No checklist any more.
  await expect(page.getByRole('region', { name: 'Get started' })).toHaveCount(0);

  // Not flagged: back on the next arrival on Reports.
  await page.getByRole('button', { name: 'Skip the tour' }).click();
  await page.locator('header').getByRole('button', { name: 'Data Sources' }).click();
  await page.locator('header').getByRole('button', { name: 'Reports', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Data Sources' })).toBeVisible();
});

test('the model editor tour explains each of its steps, then what follows', async ({ page }) => {
  await turnOn(page, 'model');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/models/${ids().modelId}`);
  for (const step of ['1. Tables', '2. Schema & Joins', '3. Dimensions & Measures']) {
    const bubble = page.getByRole('dialog', { name: step });
    await expect(bubble).toBeVisible();
    await bubble.getByRole('button', { name: 'Next' }).click();
  }
  // The assistant's bubble only when the AI is on (it points at its button).
  await expect(page.getByRole('dialog', { name: /^(Or ask the assistant|Build a report on it)$/ })).toBeVisible();
});
