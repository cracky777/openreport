// A logo asked for before any image exists: the assistant hands over a card,
// the user drops the picture on it, it goes up through the image route, its
// name reaches the provider, the next proposal names it back, and the page
// gets an image widget pointing at the uploaded file and a text widget with
// its content — nothing of it ever a URL the model wrote. Only a browser holds
// the chain: the card, the drop, the upload, the chip, the request body, the
// proposal, the page, the save.
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const F = require('../fixtures');

const ids = () => JSON.parse(fs.readFileSync(F.IDS_FILE, 'utf8'));
const toolNames = (body) => (body.tools || []).map((t) => (t.function || t).name);
// A 1 × 1 PNG.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const imageChoices = (body) => {
  const tool = (body.tools || []).find((t) => (t.function || t).name === 'propose_widgets');
  return tool ? (tool.function.parameters.properties.widgets.items.properties.image || {}).enum || [] : [];
};

// No image in the conversation: ask for it. One added: place it with a title band.
const script = (body) => {
  if (!toolNames(body).includes('propose_widgets')) return { name: 'ping', arguments: {} };
  if (!imageChoices(body).length) {
    return { name: 'propose_action', arguments: { userAsked: 'do', action: 'add_image', summary: 'Drop your logo here.', request: 'Put our logo top right with a title band' } };
  }
  return {
    name: 'propose_widgets',
    arguments: {
      reading: { scope: 'precise' },
      widgets: [
        { type: 'text', answers: 'decor', title: '', rationale: 'r', binding: {}, text: 'Rapport e2e', style: { fontSize: 22, bold: true }, layout: { x: 20, y: 20, w: 800, h: 60 } },
        { type: 'image', answers: 'decor', title: 'Logo', rationale: 'r', binding: {}, image: 'logo.png', fit: 'contain', layout: { x: 960, y: 20, w: 160, h: 60 } },
      ],
    },
  };
};

const dropImage = async (locator) => {
  const dataTransfer = await locator.evaluateHandle((_el, b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'logo.png', { type: 'image/png' }));
    return dt;
  }, PNG);
  await locator.dispatchEvent('drop', { dataTransfer });
};

test('asked for a logo, the assistant offers a card to drop it on, then places it with a title band, saved', async ({ page }) => {
  const provider = await F.startScriptedProvider(script);
  const { tableReportId } = ids();
  const saved = async () => (await (await page.request.get(`/api/reports/${tableReportId}`)).json()).report;
  const before = await saved();
  try {
    await page.request.put('/api/admin/settings/ai', {
      data: { provider: 'openai-compat', baseUrl: provider.url, model: 'scripted', enabled: true, dataSharing: 'schema' },
    });
    await page.route('**/api/models/*/query', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ rows: [{ [F.DIM_LABEL]: 'France', [F.MEASURE_LABEL]: 100 }], rowCount: 1 }),
    }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/studio/${tableReportId}`);
    await page.locator('.widget-content').first().waitFor();

    await page.getByPlaceholder('Ask for a visual, a change, or the look of the page…').fill('Put our logo top right with a title band');
    await page.getByRole('button', { name: 'Send' }).click();
    // No image yet: the provider was told so, and asked for one.
    const zone = page.getByLabel('Drop the image here');
    await expect(zone).toBeVisible({ timeout: 20_000 });
    expect(provider.requests[0].messages.find((m) => m.role === 'system').content).toContain('No image was added to this conversation yet');

    await dropImage(zone);
    // The chip names it, and the assistant went on by itself with the image in hand.
    await expect(page.getByText('logo.png', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Add 2 visuals' })).toBeVisible({ timeout: 20_000 });
    const placed = provider.requests.find((r) => imageChoices(r).length);
    expect(imageChoices(placed)).toEqual(['logo.png']);
    expect(placed.messages.find((m) => m.role === 'system').content).toContain('Images the user added to this conversation (type image, by name): logo.png');
    expect(placed.messages.filter((m) => m.role === 'user').pop().content).toContain('I added the image logo.png. Go on: Put our logo top right with a title band');

    await page.getByRole('button', { name: 'Add 2 visuals' }).click();
    await expect(page.getByText('Rapport e2e', { exact: true }).last()).toBeVisible({ timeout: 15_000 });
    const img = page.locator('.widget-content img').first();
    await expect(img).toBeVisible();
    await expect(img).toHaveAttribute('src', /^\/uploads\/images\/[\w.-]+$/);

    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    const after = await saved();
    const widgets = Object.values(after.settings.pages[0].widgets);
    const logo = widgets.find((w) => w.type === 'image');
    expect(logo.config.url).toMatch(/^\/uploads\/images\//);
    expect(logo.config.alt).toBe('Logo');
    const band = widgets.find((w) => w.type === 'text');
    // The style on the widget, the text plain: a later design card restyles the whole of it.
    expect(band.data).toMatchObject({ text: 'Rapport e2e', runs: [{ text: 'Rapport e2e' }] });
    expect(band.config).toMatchObject({ fontSize: 22, bold: true });
  } finally {
    await page.request.put(`/api/reports/${tableReportId}`, { data: { title: before.title, layout: before.layout, widgets: before.widgets, settings: before.settings } });
    await page.request.put('/api/admin/settings/ai', { data: { enabled: false } });
    provider.server.close();
  }
});
