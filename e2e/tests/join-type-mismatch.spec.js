// A join between a text column and a number was accepted without a word, and
// only failed in the report ("Could not convert string 'Armoire…' to INT64").
// The model editor now says so as soon as it opens the model.
const { test, expect } = require('@playwright/test');

const csv = (name, text) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(text) });

test('the model editor reports a join between text and a number', async ({ page }) => {
  const up = (name, text) => page.request.post('/api/upload', { multipart: { file: csv(name, text) } });
  const articles = (await (await up('jt-articles.csv', 'id_article,nom\n1,Armoire avec portes coulissantes\n2,Chaise\n')).json()).datasource.id;
  const ventes = (await (await up('jt-ventes.csv', 'article,qte\n1,3\n2,5\n')).json()).datasource.id;
  const created = await page.request.post('/api/models', { data: { name: 'jt-model', datasourceId: articles } });
  const modelId = (await created.json()).model.id;
  await page.request.post(`/api/models/${modelId}/datasources`, { data: { datasourceId: ventes } });
  await page.request.put(`/api/models/${modelId}`, {
    data: {
      selected_tables: ['jt_articles', 'jt_ventes__jt_ventes'],
      joins: [{ from_table: 'jt_articles', from_column: 'nom', to_table: 'jt_ventes__jt_ventes', to_column: 'article', cardinality: { from: '1', to: '*' } }],
    },
  });

  await page.goto(`/models/${modelId}`);
  await expect(page.getByText('links a text column to a number column')).toBeVisible();
});
