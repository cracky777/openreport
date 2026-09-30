// A model combining imported files queries them as one database: its own
// source's tables under their names, a linked source's as `alias__table` —
// even when both files hold a table of the same name. Refreshing either file
// shows at once, and two models that link different files under the same
// alias never share cached rows.
const request = require('supertest');

// Every import runs in a child process (utils/fileImport.js): under a full
// parallel run, the default 5 s is short.
jest.setTimeout(60000);
const { buildApp, seedUser, db } = require('./helpers/testApp');

const app = buildApp();
const as = (uid) => (r) => r.set('x-test-user', uid);

async function importFile(uid, name, content) {
  const res = await request(app).post('/api/upload').use(as(uid)).attach('file', Buffer.from(content), name);
  expect(res.status).toBe(201);
  return res.body.datasource.id;
}

const ARTICLES = 'id_article,nom\n1,Armoire\n2,Chaise\n';

// Articles as the model's own source, `ventes` linked: sales per article name.
async function salesModel(u, articlesDs, ventesDs, { sameName = false } = {}) {
  const res = await request(app).post('/api/models').use(as(u)).send({ name: `m-${Math.random()}`, datasourceId: articlesDs });
  const id = res.body.model.id;
  const link = await request(app).post(`/api/models/${id}/datasources`).use(as(u)).send({ datasourceId: ventesDs });
  expect(link.status).toBe(201);
  const alias = link.body.datasource.alias;
  const own = sameName ? 'data' : 'articles';
  const linked = `${alias}__${sameName ? 'data' : 'ventes'}`;
  db.prepare(`UPDATE models SET selected_tables = ?, dimensions = ?, measures = ?, joins = ? WHERE id = ?`).run(
    JSON.stringify([own, linked]),
    JSON.stringify([{ name: `${own}.nom`, table: own, column: 'nom', type: 'string', label: 'Article' }]),
    JSON.stringify([{ name: `${linked}.qte_sum`, table: linked, column: 'qte', aggregation: 'sum', label: 'Qte' }]),
    JSON.stringify([{ from_table: linked, from_column: 'article', to_table: own, to_column: 'id_article', cardinality: { from: '*', to: '1' } }]),
    id,
  );
  return { id, alias, own, linked };
}

async function salesByArticle(u, m) {
  const res = await request(app).post(`/api/models/${m.id}/query`).use(as(u))
    .send({ dimensionNames: [`${m.own}.nom`], measureNames: [`${m.linked}.qte_sum`] });
  expect(res.body.error).toBeUndefined();
  return Object.fromEntries(res.body.rows.map((r) => [r.Article, Number(r.Qte)]));
}

describe('A model reading several files', () => {
  test('joins its own table with a linked one', async () => {
    const u = seedUser({ role: 'editor' });
    const m = await salesModel(u, await importFile(u, 'articles.csv', ARTICLES), await importFile(u, 'ventes.csv', 'article,qte\n1,3\n1,2\n2,5\n'));
    expect(m.linked).toBe('ventes__ventes');
    expect(await salesByArticle(u, m)).toEqual({ Armoire: 5, Chaise: 5 });
  });

  test('a table named like one of the other file is no ambiguity', async () => {
    const u = seedUser({ role: 'editor' });
    // Both files arrive as a table called "data".
    const own = await importFile(u, 'data.csv', ARTICLES);
    // Another data.csv of the same user would be the same upload again,
    // reused: same table name, other file.
    const res = await request(app).post('/api/upload').use(as(u)).field('name', 'sales')
      .attach('file', Buffer.from('article\tqte\n2\t7\n'), 'data.tsv');
    const m = await salesModel(u, own, res.body.datasource.id, { sameName: true });
    expect(m.linked).toBe('sales__data');
    expect(await salesByArticle(u, m)).toEqual({ Chaise: 7 });
  });

  test('the model sees the tables of every source, and validates them', async () => {
    const u = seedUser({ role: 'editor' });
    const m = await salesModel(u, await importFile(u, 'articles.csv', ARTICLES), await importFile(u, 'ventes.csv', 'article,qte\n1,1\n'));
    const res = await request(app).get(`/api/models/${m.id}/validate`).use(as(u));
    expect(res.status).toBe(200);
    expect(res.body.brokenReferences).toEqual([]);
  });

  test('the editor lists every source\'s tables, and their columns', async () => {
    const u = seedUser({ role: 'editor' });
    const articles = await importFile(u, 'articles.csv', ARTICLES);
    const ventes = await importFile(u, 'ventes.csv', 'article,qte\n1,1\n');
    const m = await salesModel(u, articles, ventes);

    const tables = await request(app).get(`/api/models/${m.id}/tables`).use(as(u));
    expect(tables.body.tables).toEqual([
      { name: 'articles', table: 'articles', sourceId: articles, sourceName: 'articles' },
      { name: 'ventes__ventes', table: 'ventes', sourceId: ventes, sourceName: 'ventes' },
    ]);
    const cols = await request(app).get(`/api/models/${m.id}/tables/ventes__ventes/columns`).use(as(u));
    expect(cols.body.columns.map((c) => c.column_name)).toEqual(['article', 'qte']);
  });

  test('refreshing the linked file shows at once', async () => {
    const u = seedUser({ role: 'editor' });
    const ventes = await importFile(u, 'ventes.csv', 'article,qte\n1,1\n');
    const m = await salesModel(u, await importFile(u, 'articles.csv', ARTICLES), ventes);
    expect(await salesByArticle(u, m)).toEqual({ Armoire: 1 });

    const refresh = await request(app).put(`/api/upload/${ventes}`).use(as(u)).attach('file', Buffer.from('article,qte\n1,10\n2,20\n'), 'ventes.csv');
    expect(refresh.status).toBe(200);
    expect(await salesByArticle(u, m)).toEqual({ Armoire: 10, Chaise: 20 });
  });

  test('two models linking different files under one alias keep their own rows', async () => {
    const u = seedUser({ role: 'editor' });
    const articles = await importFile(u, 'articles.csv', ARTICLES);
    const north = await request(app).post('/api/upload').use(as(u)).field('name', `ventes-${Math.random()}`)
      .attach('file', Buffer.from('article,qte\n1,1\n'), 'ventes.csv');
    // Both files arrive as a table "ventes" (the same file name would be reused).
    const south = await request(app).post('/api/upload').use(as(u)).field('name', `ventes-${Math.random()}`)
      .attach('file', Buffer.from('article\tqte\n1\t100\n'), 'ventes.tsv');
    const a = await salesModel(u, articles, north.body.datasource.id);
    const b = await salesModel(u, articles, south.body.datasource.id);
    // Same own source, same SQL text — different files behind it.
    db.prepare('UPDATE model_datasources SET alias = ? WHERE model_id IN (?, ?)').run('ventes', a.id, b.id);
    for (const m of [a, b]) {
      db.prepare('UPDATE models SET selected_tables = ?, measures = ?, joins = ? WHERE id = ?').run(
        JSON.stringify(['articles', 'ventes__ventes']),
        JSON.stringify([{ name: 'ventes__ventes.qte_sum', table: 'ventes__ventes', column: 'qte', aggregation: 'sum', label: 'Qte' }]),
        JSON.stringify([{ from_table: 'ventes__ventes', from_column: 'article', to_table: 'articles', to_column: 'id_article', cardinality: { from: '*', to: '1' } }]),
        m.id,
      );
      m.linked = 'ventes__ventes';
    }
    expect((await salesByArticle(u, a)).Armoire).toBe(1);
    expect((await salesByArticle(u, b)).Armoire).toBe(100);
  });
});
