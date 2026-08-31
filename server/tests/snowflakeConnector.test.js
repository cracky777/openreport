// Snowflake ne se joint ni par hôte ni par port : l'identifiant de compte porte
// la région et le cloud, et l'entrepôt (le calcul) est distinct de la base (les
// données) — sans entrepôt assigné, toute requête est refusée.
//
// Rien ici ne remplace un essai contre un vrai compte ; ce test fige la
// plomberie que le SDK ne montrera qu'à la connexion : la forme de la config,
// et les deux requêtes d'introspection. La seconde compte double, parce que
// Snowflake plie les noms non cités en MAJUSCULES : sans alias cités en
// minuscules, l'application lirait `table_name` sur des lignes qui portent
// TABLE_NAME, et l'écran resterait vide sans erreur.
const created = [];
const executed = [];

jest.mock('snowflake-sdk', () => ({
  configure: () => {},
  createPool: (opts) => {
    created.push(opts);
    return {
      use: (fn) => fn({
        execute: ({ sqlText, binds, complete }) => {
          executed.push({ sqlText, binds });
          complete(null, {}, []);
          return { cancel: (cb) => cb && cb() };
        },
      }),
      drain: () => Promise.resolve(),
      clear: () => Promise.resolve(),
    };
  },
}), { virtual: true });

const { createConnection } = require('../utils/dbConnector');

const connect = (extra) => createConnection({
  db_type: 'snowflake', host: '', port: 0, db_name: 'ANALYTICS',
  db_user: 'u', db_password: 'p',
  extra_config: JSON.stringify({ account: 'myorg-myaccount', warehouse: 'COMPUTE_WH', ...extra }),
});

beforeEach(() => { created.length = 0; executed.length = 0; });

describe('configuration de connexion', () => {
  test('compte, entrepôt et base atteignent le SDK', async () => {
    await connect().testConnection();
    expect(created[0]).toMatchObject({
      account: 'myorg-myaccount', warehouse: 'COMPUTE_WH',
      database: 'ANALYTICS', username: 'u', password: 'p',
    });
  });

  test('schéma et rôle ne sont transmis que s’ils sont renseignés', async () => {
    await connect().testConnection();
    expect('schema' in created[0]).toBe(false);
    expect('role' in created[0]).toBe(false);
    created.length = 0;
    await connect({ schema: 'PUBLIC', role: 'ANALYST' }).testConnection();
    expect(created[0].schema).toBe('PUBLIC');
    expect(created[0].role).toBe('ANALYST');
  });

  test('la requête est étiquetée pour être reconnaissable dans QUERY_HISTORY', async () => {
    await connect().testConnection();
    expect(created[0].application).toBe('OpenReport');
  });
});

describe('introspection', () => {
  test('les colonnes du catalogue sont ré-aliasées en minuscules', async () => {
    await connect().getTables();
    const sql = executed[0].sqlText;
    expect(sql).toContain('AS "table_schema"');
    expect(sql).toContain('AS "table_name"');
    expect(sql).toContain("table_schema <> 'INFORMATION_SCHEMA'");
  });

  test('getColumns paramètre schéma et table au lieu de les interpoler', async () => {
    const c = connect();
    await c.getColumns('SALES.ORDERS');
    expect(executed[0].binds).toEqual(['SALES', 'ORDERS']);
    expect(executed[0].sqlText).not.toContain('SALES');
    await c.getColumns('ORDERS');
    expect(executed[1].binds).toEqual(['PUBLIC', 'ORDERS']);
  });
});

describe('délai maximum', () => {
  // Best-effort, comme le SET statement_timeout de PostgreSQL : un rôle
  // restreint peut refuser l'ALTER SESSION, et le garde-fou JS reste la limite.
  test('le délai est posé en secondes avant la requête', async () => {
    await connect().queryCancellable('SELECT 1', { timeoutMs: 45000 }).promise;
    expect(executed[0].sqlText).toBe('ALTER SESSION SET STATEMENT_TIMEOUT_IN_SECONDS = 45');
    expect(executed[1].sqlText).toBe('SELECT 1');
  });

  test('sans délai, aucune session n’est modifiée', async () => {
    await connect().queryCancellable('SELECT 1').promise;
    expect(executed).toHaveLength(1);
    expect(executed[0].sqlText).toBe('SELECT 1');
  });
});
