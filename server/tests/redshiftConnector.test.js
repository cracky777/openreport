// Redshift parle le protocole fil de PostgreSQL : il réutilise le même driver
// `pg` et la même branche du connecteur. Deux choses restent à vérifier ici,
// qu'aucun test de dialecte n'atteint.
//
// D'abord le port : 5439 chez Redshift, 5432 chez PostgreSQL. Un défaut resté
// à 5432 ne donne pas une erreur lisible, juste un timeout de connexion.
//
// Ensuite l'introspection. Le catalogue Redshift expose deux schémas système
// que PostgreSQL n'a pas ; les masquer a transformé une liste écrite en dur en
// requête paramétrée, sur le chemin PARTAGÉ avec PostgreSQL. Une erreur là
// viderait la liste des tables de toutes les sources PG — d'où les deux
// dialectes testés côte à côte.
const queries = [];
const configs = [];

jest.mock('pg', () => ({
  Pool: class {
    constructor(config) { configs.push(config); }
    on() {}
    query(text, params) { queries.push({ text, params }); return Promise.resolve({ rows: [] }); }
    connect() { return Promise.resolve({ release() {}, query: () => Promise.resolve({ rows: [] }) }); }
    end() { return Promise.resolve(); }
  },
  Client: class {
    connect() { return Promise.resolve(); }
    query() { return Promise.resolve({ rows: [] }); }
    end() { return Promise.resolve(); }
  },
}));

const { createConnection } = require('../utils/dbConnector');

const connect = (over) => createConnection({
  db_type: 'postgres', host: 'h', db_name: 'db', db_user: 'u', db_password: 'p', ...over,
});

beforeEach(() => { queries.length = 0; configs.length = 0; });

describe('port par défaut', () => {
  test('Redshift écoute sur 5439, PostgreSQL sur 5432', () => {
    connect({ db_type: 'redshift' });
    expect(configs[0].port).toBe(5439);
    connect({ db_type: 'postgres' });
    expect(configs[1].port).toBe(5432);
  });

  test('un port explicite l’emporte sur le défaut', () => {
    connect({ db_type: 'redshift', port: 5432 });
    expect(configs[0].port).toBe(5432);
  });
});

describe('introspection des tables', () => {
  test('PostgreSQL ne masque toujours que ses deux schémas système', async () => {
    await connect({ db_type: 'postgres' }).getTables();
    expect(queries[0].params).toEqual(['pg_catalog', 'information_schema']);
    expect(queries[0].text).toContain('NOT IN ($1, $2)');
  });

  test('Redshift masque en plus pg_internal et catalog_history', async () => {
    await connect({ db_type: 'redshift' }).getTables();
    expect(queries[0].params).toEqual(['pg_catalog', 'information_schema', 'pg_internal', 'catalog_history']);
    expect(queries[0].text).toContain('NOT IN ($1, $2, $3, $4)');
  });

  test('aucun nom de schéma n’est interpolé dans le texte de la requête', async () => {
    await connect({ db_type: 'redshift' }).getTables();
    expect(queries[0].text).not.toMatch(/pg_catalog|catalog_history/);
  });
});

describe('introspection des colonnes', () => {
  test('un nom nu est lu dans le schéma public, un nom qualifié dans le sien', async () => {
    const conn = connect({ db_type: 'redshift' });
    await conn.getColumns('orders');
    expect(queries[0].params).toEqual(['public', 'orders']);
    await conn.getColumns('sales.orders');
    expect(queries[1].params).toEqual(['sales', 'orders']);
  });
});
