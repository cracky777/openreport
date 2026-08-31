// SQL Server était déjà géré de bout en bout côté serveur — connecteur, table de
// dialecte, sqlBuilder — mais absent de la liste du client : on ne pouvait
// l'atteindre qu'en choisissant « Azure SQL Database ». Deux choses distinguent
// une instance on-prem de son cousin managé, et ce test les fixe.
const configs = [];

jest.mock('mssql', () => ({
  connect: (config) => { configs.push(config); return Promise.resolve({ request: () => ({ query: () => Promise.resolve({ recordset: [] }) }), close: () => Promise.resolve() }); },
}), { virtual: true });

const { createConnection } = require('../utils/dbConnector');

const connect = (over) => createConnection({
  db_type: 'mssql', host: 'srv', db_name: 'db', db_user: 'u', db_password: 'p', ...over,
});

beforeEach(() => { configs.length = 0; });

describe('SQL Server et Azure SQL partagent le connecteur', () => {
  test('les deux types atteignent la branche mssql', async () => {
    await connect({ db_type: 'mssql' }).testConnection();
    await connect({ db_type: 'azure_sql' }).testConnection();
    expect(configs).toHaveLength(2);
    expect(configs[0].server).toBe('srv');
    expect(configs[1].server).toBe('srv');
  });

  test('port 1433 par défaut', async () => {
    await connect({}).testConnection();
    expect(configs[0].port).toBe(1433);
  });
});

describe('instance nommée', () => {
  // Une instance nommée écoute sur un port que le service SQL Browser attribue
  // à la connexion : il n'y en a donc pas à configurer, et en passer un ferait
  // composer le mauvais au driver au lieu de résoudre le nom.
  test('un nom d’instance remplace le port au lieu de s’y ajouter', async () => {
    await connect({ extra_config: JSON.stringify({ instanceName: 'SQLEXPRESS' }) }).testConnection();
    expect(configs[0].options.instanceName).toBe('SQLEXPRESS');
    expect(configs[0].port).toBeUndefined();
  });

  test('sans nom d’instance, aucune clé instanceName ne traîne', async () => {
    await connect({}).testConnection();
    expect('instanceName' in configs[0].options).toBe(false);
    expect(configs[0].port).toBe(1433);
  });

  test('un nom vide ou blanc ne compte pas comme une instance', async () => {
    await connect({ extra_config: JSON.stringify({ instanceName: '   ' }) }).testConnection();
    expect('instanceName' in configs[0].options).toBe(false);
    expect(configs[0].port).toBe(1433);
  });
});

describe('TLS', () => {
  // Le certificat par défaut d'un SQL Server on-prem est auto-signé : la case
  // existe pour ça. Elle lève la vérification du certificat, jamais le
  // chiffrement lui-même.
  test('le chiffrement reste actif, la case ne lève que la vérification', async () => {
    await connect({ extra_config: JSON.stringify({ allowSelfSignedCert: true }) }).testConnection();
    expect(configs[0].options.encrypt).toBe(true);
    expect(configs[0].options.trustServerCertificate).toBe(true);
  });

  test('sans la case, le certificat est vérifié', async () => {
    await connect({}).testConnection();
    expect(configs[0].options.encrypt).toBe(true);
    expect(configs[0].options.trustServerCertificate).toBe(false);
  });
});
