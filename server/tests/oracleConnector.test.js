// Deux choses distinguent Oracle des connecteurs precedents, et ni l'une ni
// l'autre ne se voit dans le dialecte.
//
// Son catalogue stocke les noms en MAJUSCULES, parce qu'Oracle plie tout
// identifiant non cite. Interroger all_tab_columns avec un nom en minuscules
// ne leve aucune erreur : il rend zero ligne, et l'ecran reste vide sans dire
// pourquoi. C'est le meme piege que les alias de Snowflake, en sens inverse.
//
// Et l'annulation demande deux leviers : callTimeout rend la main au client,
// break() interrompt la requete cote serveur. Le premier seul laisserait le
// serveur travailler pour personne.
const mockPools = [];
const mockExecuted = [];
const mockConns = [];

jest.mock('oracledb', () => ({
  OUT_FORMAT_OBJECT: 4001,
  outFormat: 0,
  createPool: (config) => {
    mockPools.push(config);
    return Promise.resolve({
      getConnection: () => {
        const conn = {
          broke: false, closed: false, callTimeout: 0,
          execute: (sqlText, binds) => { mockExecuted.push({ sqlText, binds }); return Promise.resolve({ rows: [] }); },
          break() { this.broke = true; return Promise.resolve(); },
          close() { this.closed = true; return Promise.resolve(); },
        };
        mockConns.push(conn);
        return Promise.resolve(conn);
      },
      close: () => Promise.resolve(),
    });
  },
}), { virtual: true });

const { createConnection } = require('../utils/dbConnector');

const connect = (over = {}, extra = {}) => createConnection({
  db_type: 'oracle', host: 'db.example.com', port: 0, db_name: 'ORCLPDB1',
  db_user: 'reporting', db_password: 'p', extra_config: JSON.stringify(extra), ...over,
});

beforeEach(() => { mockPools.length = 0; mockExecuted.length = 0; mockConns.length = 0; });

describe('adresse du service', () => {
  // host:port/service — le nom de service n'est pas le nom de la base, et
  // c'est lui que l'ecouteur resout.
  test('la chaine de connexion est batie a partir de l’hote, du port et du service', async () => {
    await connect().testConnection();
    expect(mockPools[0].connectString).toBe('db.example.com:1521/ORCLPDB1');
  });

  test('un port explicite est respecte', async () => {
    await connect({ port: 1522 }).testConnection();
    expect(mockPools[0].connectString).toBe('db.example.com:1522/ORCLPDB1');
  });

  // Un alias TNS ou une chaine Easy Connect avec parametres ne se decompose
  // pas en hote/port/service : elle doit passer telle quelle.
  test('une chaine fournie l’emporte sur les trois champs', async () => {
    await connect({}, { connectString: 'tns_alias_prod' }).testConnection();
    expect(mockPools[0].connectString).toBe('tns_alias_prod');
  });

  test('SELECT 1 FROM dual — un SELECT sans FROM est refuse par Oracle', async () => {
    await connect().testConnection();
    expect(mockExecuted[0].sqlText).toBe('SELECT 1 FROM dual');
  });
});

describe('introspection', () => {
  test('les noms sont mis en majuscules avant d’interroger le catalogue', async () => {
    await connect().getColumns('ventes.commandes');
    expect(mockExecuted[0].binds).toEqual({ owner: 'VENTES', tbl: 'COMMANDES' });
  });

  // Le schema par defaut est l'utilisateur de connexion, comme chez Oracle.
  test('une table nue est cherchee dans le schema de l’utilisateur', async () => {
    await connect().getColumns('commandes');
    expect(mockExecuted[0].binds).toEqual({ owner: 'REPORTING', tbl: 'COMMANDES' });
  });

  test('un schema configure remplace l’utilisateur', async () => {
    await connect({}, { schema: 'dwh' }).getColumns('commandes');
    expect(mockExecuted[0].binds).toEqual({ owner: 'DWH', tbl: 'COMMANDES' });
  });

  // ALL_TABLES et non USER_TABLES : un compte de lecture voit souvent des
  // tables d'un autre schema, que USER_TABLES masquerait toutes.
  test('les tables des autres schemas restent visibles, celles du systeme non', async () => {
    await connect().getTables();
    const sql = mockExecuted[0].sqlText;
    expect(sql).toContain('all_tables');
    expect(sql).not.toContain('user_tables');
    expect(sql).toContain("'SYS'");
  });

  test('les valeurs sont liees, jamais concatenees', async () => {
    await connect().getColumns("o'brien.t");
    expect(mockExecuted[0].sqlText).toContain(':owner');
    expect(mockExecuted[0].sqlText).not.toContain('BRIEN');
  });
});

describe('annulation', () => {
  test('le delai est pose sur la connexion et la requete interrompue cote serveur', async () => {
    const run = connect().queryCancellable('SELECT 1 FROM dual', { timeoutMs: 30000 });
    await run.promise;
    expect(mockConns[0].callTimeout).toBe(30000);
    await run.cancel();
    expect(mockConns[0].broke).toBe(true);
  });

  test('la connexion est rendue au pool meme apres une requete normale', async () => {
    await connect().query('SELECT 1 FROM dual');
    expect(mockConns[0].closed).toBe(true);
  });
});
