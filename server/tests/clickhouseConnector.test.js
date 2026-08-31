// ClickHouse expose une interface HTTP : 8123 en clair, 8443 en TLS. Deux ports
// pour un même serveur, donc activer le chiffrement sans déplacer le port fait
// taper à côté — sans autre symptôme qu'un timeout. Ce test fige ce couplage,
// et les deux requêtes d'introspection qui lisent system.tables / system.columns.
const created = [];
const queries = [];

jest.mock('@clickhouse/client', () => ({
  createClient: (opts) => {
    created.push(opts);
    return {
      query: (q) => { queries.push(q); return Promise.resolve({ json: () => Promise.resolve([]) }); },
      command: (q) => { queries.push(q); return Promise.resolve(); },
      ping: () => Promise.resolve(true),
      close: () => Promise.resolve(),
    };
  },
}), { virtual: true });

const { createConnection } = require('../utils/dbConnector');

const connect = (over = {}, extra = {}) => createConnection({
  db_type: 'clickhouse', host: 'ch.example.com', db_name: 'analytics',
  db_user: 'reader', db_password: 'p', extra_config: JSON.stringify(extra), ...over,
});

beforeEach(() => { created.length = 0; queries.length = 0; });

describe('adresse du serveur', () => {
  test('HTTP sur 8123 par défaut', async () => {
    await connect().testConnection();
    expect(created[0].url).toBe('http://ch.example.com:8123');
  });

  test('TLS bascule le protocole ET le port', async () => {
    await connect({}, { secure: true }).testConnection();
    expect(created[0].url).toBe('https://ch.example.com:8443');
  });

  test('un port explicite l’emporte sur les deux défauts', async () => {
    await connect({ port: 9000 }, { secure: true }).testConnection();
    expect(created[0].url).toBe('https://ch.example.com:9000');
  });

  test('la requête est étiquetée pour être reconnaissable dans system.query_log', async () => {
    await connect().testConnection();
    expect(created[0].application).toBe('OpenReport');
  });
});

describe('introspection', () => {
  // Ce que les autres moteurs appellent schéma, ClickHouse l'appelle base : une
  // table de la base courante se nomme nue, les autres se qualifient.
  test('les bases système sont masquées', async () => {
    await connect().getTables();
    expect(queries[0].query).toContain('system.tables');
    expect(queries[0].query).toContain("'system', 'INFORMATION_SCHEMA', 'information_schema'");
  });

  test('getColumns paramètre base et table au lieu de les interpoler', async () => {
    const c = connect();
    await c.getColumns('other_db.events');
    expect(queries[0].query_params).toEqual({ db: 'other_db', tbl: 'events' });
    expect(queries[0].query).not.toContain('other_db');
    await c.getColumns('events');
    expect(queries[1].query_params).toEqual({ db: 'analytics', tbl: 'events' });
  });
});

describe('délai maximum', () => {
  // Abandonner la réponse HTTP ne suffit pas : sans max_execution_time, la
  // requête continue de tourner sur le cluster après le départ du client.
  test('le délai est aussi posé côté serveur, en secondes', async () => {
    await connect().queryCancellable('SELECT 1', { timeoutMs: 30000 }).promise;
    expect(queries[0].clickhouse_settings).toEqual({ max_execution_time: 30 });
    expect(queries[0].abort_signal).toBeDefined();
  });

  test('sans délai, aucun réglage n’est envoyé', async () => {
    await connect().queryCancellable('SELECT 1').promise;
    expect(queries[0].clickhouse_settings).toBeUndefined();
  });
});
