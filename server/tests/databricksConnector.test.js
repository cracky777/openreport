// Databricks ouvre une session Thrift, pas une connexion SQL classique. Trois
// choses s'y jouent que le dialecte ne voit pas : ce qui désigne l'entrepôt,
// le partage de la session, et l'annulation — le seul levier disponible, faute
// de délai d'exécution par requête chez ce moteur.
// Préfixe `mock` obligatoire : la fabrique de jest.mock refuse toute variable
// hors de sa portée sans lui.
const mockConnects = [];
const mockSessions = [];
const mockStatements = [];

jest.mock('@databricks/sql', () => ({
  DBSQLClient: class {
    connect(opts) { mockConnects.push(opts); return Promise.resolve(this); }
    openSession(opts) {
      mockSessions.push(opts);
      return Promise.resolve({
        executeStatement: (sqlText, execOpts) => {
          const op = {
            canceled: false, closed: false,
            fetchAll: () => Promise.resolve([]),
            cancel() { this.canceled = true; return Promise.resolve(); },
            close() { this.closed = true; return Promise.resolve(); },
          };
          mockStatements.push({ sqlText, execOpts, op });
          return Promise.resolve(op);
        },
        close: () => Promise.resolve(),
      });
    }
    close() { return Promise.resolve(); }
  },
}), { virtual: true });

const { createConnection } = require('../utils/dbConnector');

const connect = (extra = {}) => createConnection({
  db_type: 'databricks', host: 'dbc-123.cloud.databricks.com', db_name: '',
  db_user: '', db_password: 'dapi-secret',
  extra_config: JSON.stringify({ httpPath: '/sql/1.0/warehouses/abc', ...extra }),
});

beforeEach(() => { mockConnects.length = 0; mockSessions.length = 0; mockStatements.length = 0; });

describe('ce qui désigne l’entrepôt', () => {
  // Deux entrepôts SQL du même workspace ne diffèrent QUE par leur chemin HTTP :
  // l'hôte ne suffit pas à en choisir un.
  test('hôte, chemin HTTP et jeton atteignent le driver', async () => {
    await connect().testConnection();
    expect(mockConnects[0]).toEqual({
      host: 'dbc-123.cloud.databricks.com',
      path: '/sql/1.0/warehouses/abc',
      token: 'dapi-secret',
    });
  });

  // Unity Catalog nomme en trois niveaux : les poser sur la session, c'est
  // permettre au modèle de ne nommer que la table, comme partout ailleurs.
  test('catalogue et schéma ne sont posés que s’ils sont renseignés', async () => {
    await connect().testConnection();
    expect(mockSessions[0]).toEqual({});
    mockSessions.length = 0;
    await connect({ catalog: 'main', schema: 'sales' }).testConnection();
    expect(mockSessions[0]).toEqual({ initialCatalog: 'main', initialSchema: 'sales' });
  });
});

describe('session partagée', () => {
  test('deux requêtes ne rouvrent pas deux sessions', async () => {
    const c = connect();
    await c.query('SELECT 1');
    await c.query('SELECT 2');
    expect(mockConnects).toHaveLength(1);
    expect(mockSessions).toHaveLength(1);
    expect(mockStatements).toHaveLength(2);
  });
});

describe('annulation', () => {
  // runAsync rend la main avant la fin : sans lui, l'opération ne serait connue
  // qu'une fois terminée, donc jamais annulable.
  test('la requête part en asynchrone, ce qui laisse une prise', async () => {
    await connect().queryCancellable('SELECT 1').promise;
    expect(mockStatements[0].execOpts).toEqual({ runAsync: true });
  });

  test('annuler ferme l’opération côté serveur', async () => {
    const c = connect();
    const run = c.queryCancellable('SELECT 1');
    await run.promise;
    await run.cancel();
    expect(mockStatements[0].op.canceled).toBe(true);
  });

  test('une opération terminée est refermée, pas laissée ouverte', async () => {
    await connect().query('SELECT 1');
    expect(mockStatements[0].op.closed).toBe(true);
  });
});

describe('introspection', () => {
  test('les valeurs de getColumns sont échappées, pas concaténées telles quelles', async () => {
    await connect({ schema: 'sales' }).getColumns("o'brien.events");
    const sql = mockStatements[0].sqlText;
    expect(sql).toContain("table_schema = 'o''brien'");
    expect(sql).toContain("table_name = 'events'");
  });

  test('une table du schéma courant se nomme nue', async () => {
    const c = connect({ schema: 'sales' });
    await c.getColumns('orders');
    expect(mockStatements[0].sqlText).toContain("table_schema = 'sales'");
  });
});
