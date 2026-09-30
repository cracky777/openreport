// A join between a text column and a number fails at query time on most
// engines (DuckDB: "Could not convert string 'Armoire…' to INT64"). The model
// validation reports it while the join is being built, and says nothing when
// a type is one it does not know: a false alarm would teach users to ignore it.
const request = require('supertest');

// Every import runs in a child process (utils/fileImport.js): under a full
// parallel run, the default 5 s is short.
jest.setTimeout(30000);
const { typeFamily, joinTypeMismatch } = require('../utils/joinTypes');
const { buildApp, seedUser, db } = require('./helpers/testApp');

describe('typeFamily', () => {
  test.each([
    ['BIGINT', 'number'], ['INTEGER', 'number'], ['hugeint', 'number'], ['INT64', 'number'], ['FLOAT64', 'number'],
    ['decimal(18,3)', 'number'], ['NUMBER(10,2)', 'number'], ['double precision', 'number'], ['tinyint(1)', 'number'],
    ['VARCHAR', 'text'], ['varchar(255)', 'text'], ['character varying', 'text'], ['STRING', 'text'], ['nvarchar(max)', 'text'],
    ['DATE', 'date'], ['TIMESTAMP', 'date'], ['timestamp with time zone', 'date'], ['datetime2', 'date'], ['timestamptz', 'date'],
    ['INTERVAL', null], ['UUID', null], ['BOOLEAN', null], ['', null], [undefined, null],
  ])('%s → %s', (type, family) => {
    expect(typeFamily(type)).toBe(family);
  });

  test('a mismatch needs two known, different families', () => {
    expect(joinTypeMismatch('VARCHAR', 'BIGINT')).toEqual({ from: 'text', to: 'number' });
    expect(joinTypeMismatch('INTEGER', 'BIGINT')).toBeNull();
    expect(joinTypeMismatch('UUID', 'VARCHAR')).toBeNull();
  });
});

const ARTICLES = 'id_article,nom\n1,Armoire avec portes coulissantes\n2,Chaise\n';
const VENTES = 'article,qte\n1,3\n2,5\n';

describe('GET /models/:id/validate on joins', () => {
  const app = buildApp();
  const as = (uid) => (r) => r.set('x-test-user', uid);

  // Articles and sales, two imported files, combined in one model: the sales
  // table joins it as ventes__ventes.
  async function twoSources(u) {
    const up = (name, text) => request(app).post('/api/upload').use(as(u)).attach('file', Buffer.from(text), name);
    const articles = (await up('articles.csv', ARTICLES)).body.datasource.id;
    const ventes = (await up('ventes.csv', VENTES)).body.datasource.id;
    return { articles, ventes };
  }
  async function modelWith(u, { articles, ventes }, joins) {
    const res = await request(app).post('/api/models').use(as(u)).send({ name: `m-${Date.now()}-${Math.random()}`, datasourceId: articles });
    const id = res.body.model.id;
    await request(app).post(`/api/models/${id}/datasources`).use(as(u)).send({ datasourceId: ventes });
    db.prepare('UPDATE models SET selected_tables = ?, joins = ? WHERE id = ?').run(JSON.stringify(['articles', 'ventes__ventes']), JSON.stringify(joins), id);
    return id;
  }
  const join = (fromColumn) => ({ from_table: 'articles', from_column: fromColumn, to_table: 'ventes__ventes', to_column: 'article', cardinality: { from: '1', to: '*' } });

  test('a text column joined to a number is reported', async () => {
    const u = seedUser({ role: 'editor' });
    const modelId = await modelWith(u, await twoSources(u), [join('nom')]);
    const res = await request(app).get(`/api/models/${modelId}/validate`).use(as(u));
    expect(res.status).toBe(200);
    expect(res.body.brokenReferences).toEqual([
      { kind: 'join', name: 'articles.nom ↔ ventes__ventes.article', issue: 'type_mismatch', fromType: 'text', toType: 'number' },
    ]);
  });

  test('the key columns pass, and a missing one is reported', async () => {
    const u = seedUser({ role: 'editor' });
    const sources = await twoSources(u);
    const ok = await modelWith(u, sources, [join('id_article')]);
    expect((await request(app).get(`/api/models/${ok}/validate`).use(as(u))).body.brokenReferences).toEqual([]);

    const gone = await modelWith(u, sources, [join('ref')]);
    const res = await request(app).get(`/api/models/${gone}/validate`).use(as(u));
    expect(res.body.brokenReferences).toEqual([
      expect.objectContaining({ kind: 'join', issue: 'missing_column', table: 'articles', column: 'ref', side: 'from' }),
    ]);
  });
});
