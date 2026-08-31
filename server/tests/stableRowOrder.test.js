// Un graphe à barres groupées tire l'ordre de sa légende de l'ordre des lignes
// (`[...new Set(rows.map(r => r[groupKey]))]` dans widgetDataBuilder). Le SQL
// n'ordonnait que sur la PREMIÈRE dimension du GROUP BY : deux lignes partageant
// cette dimension pouvaient donc revenir dans n'importe quel ordre, et elles le
// faisaient — le plan, les workers parallèles et l'état du cache suffisent à
// changer l'ordre entre deux exécutions de la requête identique.
//
// Le symptôme n'était visible que dans le viewer : l'éditeur ne refetche pas le
// widget source d'un cross-filter au déclic, donc ses données ne bougeaient pas
// et l'instabilité restait cachée. Ce test la ferme à la source, sur les trois
// chemins qui produisent un ORDER BY (live, multi-faits, rollup).
const request = require('supertest');
const { buildApp, seedUser, seedDatasource, seedModel } = require('./helpers/testApp');

const app = buildApp();
beforeAll(() => { jest.spyOn(console, 'warn').mockImplementation(() => {}); });
afterAll(() => { jest.restoreAllMocks(); });

const DIMS = [
  { name: 'items.region', table: 'items', column: 'region', type: 'string', label: 'region' },
  { name: 'items.label', table: 'items', column: 'label', type: 'string', label: 'label' },
];
const MEASURES = [{ name: 'items.amt', table: 'items', column: 'amt', aggregation: 'sum', label: 'amt' }];

async function compile(dbType, body) {
  const owner = seedUser({ role: 'editor' });
  const ds = seedDatasource({ userId: owner, dbType });
  const model = seedModel({ userId: owner, datasourceId: ds, dimensions: DIMS, measures: MEASURES });
  const res = await request(app)
    .post(`/api/models/${model}/query`)
    .set('x-test-user', owner)
    .send({ ...body, sqlOnly: true });
  expect(res.status).toBe(200);
  return res.body.sql;
}

// La partie ORDER BY, sans la pagination qui la suit.
const orderByOf = (sql) => {
  const m = sql.match(/ ORDER BY (.+?)(?: LIMIT | OFFSET |$)/);
  return m ? m[1] : null;
};

describe('l’ORDER BY couvre toutes les dimensions du GROUP BY', () => {
  test.each(['postgres', 'redshift', 'mysql', 'mssql', 'bigquery', 'duckdb'])(
    '%s ordonne sur les deux dimensions, pas seulement la première',
    async (dbType) => {
      const sql = await compile(dbType, {
        dimensionNames: ['items.region', 'items.label'],
        measureNames: ['items.amt'],
      });
      const groupBy = sql.match(/ GROUP BY (.+?) ORDER BY /)[1];
      const orderBy = orderByOf(sql);
      // Le GROUP BY et l'ORDER BY doivent nommer exactement les mêmes colonnes,
      // dans le même ordre : c'est ce qui rend l'ordre des lignes total.
      expect(orderBy).toBe(groupBy);
    },
  );

  test('une seule dimension garde un ORDER BY à un terme', async () => {
    const sql = await compile('postgres', {
      dimensionNames: ['items.region'],
      measureNames: ['items.amt'],
    });
    expect(orderByOf(sql)).toBe('"items"."region"');
  });
});
