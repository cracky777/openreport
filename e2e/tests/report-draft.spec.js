// A new report belongs where it was created, and only once it is saved.
//
// Created from the "New report" dialog, a report used to be written for good
// before the editor even opened: leaving without saving left an empty card in
// the list. And the model editor's "+ New Report" gave no workspace at all, so
// the server filed the report under My Reports whatever workspace was open.
// A blank report is now a draft: listed nowhere, deleted when its editor is
// left unsaved, placed in the open workspace from every entry point.
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const F = require('../fixtures');

const ids = () => JSON.parse(fs.readFileSync(F.IDS_FILE, 'utf8'));

// A workspace of its own, the seed model shared into it, and open in the header.
async function openWorkspace(page, request, tag) {
  const { modelId } = ids();
  const name = `WS ${tag} ${Date.now()}`;
  const ws = (await (await request.post('/api/workspaces', { data: { name } })).json()).workspace;
  expect((await request.put(`/api/models/${modelId}/shares`, { data: { workspaceIds: [ws.id] } })).ok()).toBeTruthy();
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  await page.locator('header').getByRole('button', { name: 'My Reports' }).click();
  await page.getByRole('button', { name }).first().click();
  await expect(page.locator('header').getByRole('button', { name })).toBeVisible();
  return { ws, modelId };
}

async function createFromDialog(page, title) {
  await page.getByRole('button', { name: '+ New Report' }).click();
  await page.getByPlaceholder('Report title').fill(title);
  // The last one: a greyed neighbouring column can show the same empty-state card.
  await page.getByRole('button', { name: /Existing Model/ }).last().click();
  await page.locator('select', { has: page.locator('option', { hasText: 'Select a model...' }) }).selectOption({ label: 'e2e-model' });
  await page.getByRole('button', { name: 'Create Report' }).click();
  await page.waitForURL(/\/edit\//);
  return page.url().split('/edit/')[1];
}

const reportStatus = async (request, id) => (await request.get(`/api/reports/${id}`)).status();
const reportRow = async (request, id) => (await (await request.get(`/api/reports/${id}`)).json()).report;

test('a new report left without saving is gone', async ({ page, request }) => {
  await openWorkspace(page, request, 'unsaved');
  const id = await createFromDialog(page, `Unsaved ${Date.now()}`);
  // Listed nowhere while it is being edited.
  const listed = (await (await request.get('/api/reports')).json()).reports.map((r) => r.id);
  expect(listed).not.toContain(id);

  await page.getByRole('button', { name: 'Back' }).click();
  await expect.poll(() => reportStatus(request, id)).toBe(404);
});

test('a new report once saved lives in the workspace it was created in', async ({ page, request }) => {
  const { ws } = await openWorkspace(page, request, 'saved');
  const id = await createFromDialog(page, `Saved ${Date.now()}`);
  await page.getByRole('button', { name: /^Save/ }).click();
  await expect(page.getByText('Report saved')).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
  await page.waitForTimeout(500);

  const row = await reportRow(request, id);
  expect(row.draft).toBe(0);
  expect(row.workspace_id).toBe(ws.id);
  const inWs = (await (await request.get(`/api/workspaces/${ws.id}`)).json()).reports.map((r) => r.id);
  expect(inWs).toContain(id);
});

test('the model editor files its new report under the open workspace', async ({ page, request }) => {
  const { ws, modelId } = await openWorkspace(page, request, 'model-editor');
  await page.goto(`/models/${modelId}`);
  await page.getByRole('button', { name: '+ New Report', exact: true }).click();
  await page.waitForURL(/\/edit\//);
  const id = page.url().split('/edit/')[1];

  const row = await reportRow(request, id);
  expect(row.workspace_id).toBe(ws.id);
  expect(row.draft).toBe(1);
});

// A file dropped anywhere on the empty Reports stage starts the Import File
// step with it: Import, and the editor opens on a report built from it.
test('a file dropped on the empty stage becomes a report', async ({ page, request }) => {
  const name = `Drop ${Date.now()}`;
  const ws = (await (await request.post('/api/workspaces', { data: { name } })).json()).workspace;
  try {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto('/');
    await page.locator('header').getByRole('button', { name: 'My Reports' }).click();
    await page.getByRole('button', { name }).first().click();
    await expect(page.getByRole('button', { name: /^Import File/ }).last()).toBeVisible();

    const fileName = `dropped-${Date.now()}.csv`;
    const dataTransfer = await page.evaluateHandle((n) => {
      const dt = new DataTransfer();
      dt.items.add(new File(['id,amount\n1,10\n2,20\n'], n, { type: 'text/csv' }));
      return dt;
    }, fileName);
    // Anywhere on the empty stage: here, on the Import File card (a stable spot,
    // whatever the AI's state does to the text around it).
    const stage = page.getByRole('button', { name: /^Import File/ }).last();
    await stage.dispatchEvent('dragover', { dataTransfer });
    await expect(page.getByText('Drop your file to start a report')).toBeVisible();
    await stage.dispatchEvent('drop', { dataTransfer });

    await expect(page.getByText(fileName)).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Import', exact: true }).click();
    await page.waitForURL(/\/edit\//);
    const id = page.url().split('/edit/')[1].split(/[?#]/)[0];
    expect((await reportRow(request, id)).workspace_id).toBe(ws.id);
  } finally {
    await request.delete(`/api/workspaces/${ws.id}`);
  }
});
