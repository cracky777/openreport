// The report changed as a whole from the studio's conversation: a visual
// replaced in its slot, one added where the assistant put it, a page added —
// one card, applied as one undo step, drawn by the viewer, written by Save.
// Only a browser holds the chain: the page context with its pages, the
// scripted provider, the card, the working copy, the viewer and the save.
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const F = require('../fixtures');

const ids = () => JSON.parse(fs.readFileSync(F.IDS_FILE, 'utf8'));
const toolNames = (body) => (body.tools || []).map((t) => (t.function || t).name);

const script = (body) => {
  if (!toolNames(body).includes('propose_report_changes')) return { name: 'ping', arguments: {} };
  return {
    name: 'propose_report_changes',
    arguments: {
      reading: { scope: 'precise' },
      summary: 'The table becomes a bar chart, a total joins it, and the detail gets its own page.',
      title: 'Rapport e2e renamed',
      measures: [{ label: 'Ecart e2e', kind: 'arithmetic', op: 'subtract', left: F.MEASURE, right: F.MEASURE, description: 'A measure made from the schema' }],
      pages: [
        {
          page: 'p1',
          replace: [{ widgetId: 'w1', with: { type: 'bar', answers: 'comparison', title: 'Replaced (e2e)', rationale: 'r', binding: { selectedDimensions: [F.DIM], selectedMeasures: [F.MEASURE] } } }],
          add: [{ type: 'scorecard', answers: 'figure', title: 'Added (e2e)', rationale: 'r', binding: { selectedMeasures: [F.MEASURE] } }],
          rows: [{ widgets: ['n1'] }, { widgets: ['w1'] }],
        },
        { page: 'new', name: 'Detail (e2e)', add: [{ type: 'table', answers: 'detail', title: 'Detail table (e2e)', rationale: 'r', binding: { selectedDimensions: [F.DIM], selectedMeasures: [F.MEASURE, '_calc.ecart_e2e'] } }] },
      ],
    },
  };
};

test('the studio applies a change of the whole report: replaced, added, a new page, then saved', async ({ page }) => {
  const provider = await F.startScriptedProvider(script);
  const { tableReportId } = ids();
  const saved = async () => (await (await page.request.get(`/api/reports/${tableReportId}`)).json()).report;
  const modelOf = async (id) => (await (await page.request.get(`/api/models/${id}`)).json()).model;
  // Save writes the shared fixture (renamed, its table turned into a bar chart,
  // a page added, a measure on the model): the specs after this one read it as
  // seeded, so both are put back whatever happens.
  const before = await saved();
  const modelBefore = await modelOf(before.model_id);
  try {
    await page.request.put('/api/admin/settings/ai', {
      data: { provider: 'openai-compat', baseUrl: provider.url, model: 'scripted', enabled: true, dataSharing: 'schema' },
    });
    // Rows take a moment, as a real query does: the studio turns to the new
    // page before the first page's new visuals have theirs.
    await page.route('**/api/models/*/query', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ rows: [{ [F.DIM_LABEL]: 'France', [F.MEASURE_LABEL]: 100 }], rowCount: 1 }),
      }).catch(() => { /* the page moved on before the reply: nothing to answer */ });
    });
    const pagesBefore = (before.settings?.pages || []).length || 1;

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/studio/${tableReportId}`);
    await page.locator('.widget-content').first().waitFor();
    await page.getByPlaceholder('Ask for a visual, a change, or the look of the page…').fill('Rework this page and put the detail on its own page');
    await page.getByRole('button', { name: 'Send' }).click();

    // The card says what changes, page by page; the pages were named to the model.
    await expect(page.getByText('Changes to the report')).toBeVisible({ timeout: 20_000 });
    const asked = provider.requests.find((r) => toolNames(r).includes('propose_report_changes'));
    expect(asked.messages.find((m) => m.role === 'system').content).toMatch(/Pages: p1 = /);
    await expect(page.getByText('New page')).toBeVisible();
    await page.getByRole('button', { name: 'Apply the changes' }).click();

    // Drawn at once: the replaced visual, the added one, and the new page in the rail.
    await expect(page.getByText('Replaced (e2e)').last()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Added (e2e)').last()).toBeVisible();
    await expect(page.getByText('Detail (e2e)').last()).toBeVisible();
    // Back on the first page, whose new visuals the studio left for the new
    // page: they draw their rows, never the empty placeholder (Karim's
    // overview came back blank, twice).
    await page.getByText(before.settings?.pages?.[0]?.name || 'Page 1', { exact: true }).first().click();
    await expect(page.getByText('Replaced (e2e)').last()).toBeVisible();
    await expect(page.locator('.widget-content', { hasText: /^Select (a measure|a dimension|dimensions)/ })).toHaveCount(0, { timeout: 10_000 });
    // In hand, not written, until Save.
    expect(((await saved()).settings?.pages || []).length || 1).toBe(pagesBefore);
    const save = page.getByRole('button', { name: 'Save', exact: true });
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();

    const after = await saved();
    const pages = after.settings.pages;
    expect(pages).toHaveLength(pagesBefore + 1);
    expect(pages[pages.length - 1].name).toBe('Detail (e2e)');
    const first = Object.values(pages[0].widgets);
    expect(first.map((w) => w.config?.title).sort()).toEqual(['Added (e2e)', 'Replaced (e2e)']);
    expect(first.find((w) => w.config?.title === 'Replaced (e2e)').type).toBe('bar');
    expect(Object.values(pages[pages.length - 1].widgets)[0]).toMatchObject({ type: 'table', config: { title: 'Detail table (e2e)' }, dataBinding: { selectedMeasures: [F.MEASURE, '_calc.ecart_e2e'] } });
    // The measure the proposal defined is saved with the model, the report renamed.
    expect(after.title).toBe('Rapport e2e renamed');
    const model = await modelOf(after.model_id);
    expect(model.measures.find((m) => m.name === '_calc.ecart_e2e')).toMatchObject({ label: 'Ecart e2e', aggregation: 'custom', expression: `COALESCE((\${${F.MEASURE}}), 0) - COALESCE((\${${F.MEASURE}}), 0)` });
  } finally {
    await page.request.put(`/api/reports/${tableReportId}`, { data: { title: before.title, layout: before.layout, widgets: before.widgets, settings: before.settings } });
    await page.request.put(`/api/models/${modelBefore.id}`, { data: { measures: modelBefore.measures } });
    await page.request.put('/api/admin/settings/ai', { data: { enabled: false } });
    provider.server.close();
  }
});
