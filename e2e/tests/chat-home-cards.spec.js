// The chat home's cards (AiPanel/StartConversation) with many models: each
// card's list holds its rows at their full height — they were squashed, the
// names written over each other, when a list was longer than its box.
const { test, expect } = require('@playwright/test');

// Buttons whose text needs more height than they are given.
const squashed = (page) => page.evaluate(() => [...document.querySelectorAll('button')]
  .filter((b) => b.offsetParent && b.scrollHeight > b.clientHeight + 1)
  .map((b) => `${b.textContent.slice(0, 40)} ${b.clientHeight}/${b.scrollHeight}`));

test('the cards of the chat home never squash their rows, at any panel width', async ({ page }) => {
  // The assistant on (Let's Talk is shown only then); never called here.
  await page.request.put('/api/admin/settings/ai', { data: { provider: 'openai-compat', baseUrl: 'http://127.0.0.1:9/v1', model: 'none', enabled: true, dataSharing: 'schema+cache' } });
  try {
    const res = await (await page.request.get('/api/datasources')).json();
    const datasourceId = (res.datasources || res)[0].id;
    for (let i = 0; i < 8; i++) {
      await page.request.post('/api/models', { data: { name: `Cards model with a rather long name ${i}`, datasourceId } });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const width of [420, 320]) {
      await page.addInitScript((w) => localStorage.setItem('openreport.studioPanelWidth', String(w)), width);
      await page.goto('/chat');
      for (const name of [/Continue a report/, /Create a report/, /Let's Talk/]) {
        await page.getByRole('button', { name }).click();
        await page.screenshot({ path: `e2e/.tmp/cards-${width}-${String(name).replace(/\W/g, '')}.png` });
        expect(await squashed(page)).toEqual([]);
      }
    }
  } finally {
    await page.request.put('/api/admin/settings/ai', { data: { enabled: false } });
  }
});
