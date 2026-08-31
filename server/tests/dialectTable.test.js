// La table des dialectes remplace 42 tests `dbType ===` dispersés sur 13
// fichiers. Elle apporte le bon défaut — un moteur inconnu retombe sur
// PostgreSQL — et le même défaut est ce qui rend une case oubliée invisible :
// c'est ainsi que BigQuery a émis le `TO_CHAR` et le `DOW` de PostgreSQL
// pendant des mois. Ce test refuse une ligne incomplète, pour qu'un connecteur
// ajouté à moitié échoue ici plutôt que dans un rapport.
//
// Il fige aussi la ligne « sécurité » de la matrice — citation des identifiants
// et échappement des littéraux. Elle n'avait aucune couverture, et le refactor
// qui a produit cette table y a justement perdu un antislash : l'échappement
// BigQuery est devenu l'identité, donc un identifiant contenant un accent grave
// ressortait du champ. Rien ne l'a signalé.
const { capabilities, dialectTypes, quoteIdent, quoteLiteral } = require('../utils/sqlDialect');

const BACKTICK = String.fromCharCode(96);
const BACKSLASH = String.fromCharCode(92);

// Un axe manquant vaut `undefined`, qui traverserait le compilateur sans bruit
// jusque dans le SQL émis (`CAST(x AS undefined)`).
const AXES = {
  quoting: (v) => ['ansi', 'bracket', 'backtick', 'bqtick'].includes(v),
  escapesBackslash: (v) => typeof v === 'boolean',
  quoteEscape: (v) => v === 'double' || v === 'backslash',
  textCast: (v) => typeof v === 'string' && v.length > 0,
  intCast: (v) => typeof v === 'string' && v.length > 0,
  decimalCast: (v) => typeof v === 'string' && v.length > 0,
  wideFloat: (v) => v === null || (typeof v === 'string' && v.length > 0),
  nullsLast: (v) => v === null || v === 'inline' || v === 'emulated',
  pagination: (v) => v === 'limit' || v === 'fetch',
  extractEpoch: (v) => typeof v === 'boolean',
  joinUsing: (v) => typeof v === 'boolean',
};

describe('la table est complète', () => {
  test.each(dialectTypes())('%s déclare les onze axes, chacun avec une valeur admise', (dbType) => {
    const caps = capabilities(dbType);
    for (const [axis, isValid] of Object.entries(AXES)) {
      expect({ axis, value: caps[axis] }).toEqual({ axis, value: caps[axis] });
      expect(Object.prototype.hasOwnProperty.call(caps, axis)).toBe(true);
      expect(isValid(caps[axis])).toBe(true);
    }
  });

  test('aucun axe inconnu ne traîne dans une ligne (une faute de frappe serait muette)', () => {
    for (const dbType of dialectTypes()) {
      expect(Object.keys(capabilities(dbType)).sort()).toEqual(Object.keys(AXES).sort());
    }
  });

  test('les alias partagent la ligne du moteur qu’ils désignent', () => {
    expect(capabilities('azure_postgres')).toBe(capabilities('postgres'));
    expect(capabilities('azure_sql')).toBe(capabilities('mssql'));
  });

  test('un dbType inconnu retombe sur PostgreSQL — le défaut assumé', () => {
    expect(capabilities('moteur-qui-n-existe-pas')).toBe(capabilities('postgres'));
    expect(capabilities(undefined)).toBe(capabilities('postgres'));
  });
});

describe('la ligne sécurité — sortir d’un identifiant ou d’un littéral', () => {
  test('chaque dialecte neutralise son propre délimiteur d’identifiant', () => {
    expect(quoteIdent('a"b', 'postgres')).toBe('"a""b"');
    expect(quoteIdent('a"b', 'redshift')).toBe('"a""b"');
    expect(quoteIdent('a"b', 'duckdb')).toBe('"a""b"');
    expect(quoteIdent('a]b', 'mssql')).toBe('[a]]b]');
    expect(quoteIdent('a]b', 'azure_sql')).toBe('[a]]b]');
    expect(quoteIdent('a' + BACKTICK + 'b', 'mysql'))
      .toBe(BACKTICK + 'a' + BACKTICK + BACKTICK + 'b' + BACKTICK);
    // BigQuery échappe par antislash au lieu de doubler : l'oublier rend
    // l'échappement identitaire, et l'identifiant se referme sur lui-même.
    expect(quoteIdent('a' + BACKTICK + 'b', 'bigquery'))
      .toBe(BACKTICK + 'a' + BACKSLASH + BACKTICK + 'b' + BACKTICK);
  });

  test('un identifiant échappé ne peut plus se refermer', () => {
    for (const dbType of dialectTypes()) {
      const caps = capabilities(dbType);
      const closer = { ansi: '"', bracket: ']', backtick: BACKTICK, bqtick: BACKTICK }[caps.quoting];
      const body = quoteIdent('x' + closer + ' malveillant', dbType).slice(1, -1);
      // Une fois les séquences d'échappement retirées, plus aucun délimiteur
      // de fin ne subsiste dans le corps : il ne peut donc pas s'y refermer.
      const neutralise = caps.quoting === 'bqtick'
        ? body.split(BACKSLASH + closer).join('')
        : body.split(closer + closer).join('');
      expect(neutralise).not.toContain(closer);
    }
  });

  test('seuls MySQL et BigQuery traitent l’antislash comme une échappée', () => {
    const raw = 'chemin' + BACKSLASH + 'fin';
    for (const dbType of dialectTypes()) {
      const doubled = capabilities(dbType).escapesBackslash;
      expect(quoteLiteral(raw, dbType))
        .toBe("'chemin" + (doubled ? BACKSLASH + BACKSLASH : BACKSLASH) + "fin'");
    }
    expect(capabilities('mysql').escapesBackslash).toBe(true);
    expect(capabilities('bigquery').escapesBackslash).toBe(true);
    expect(capabilities('postgres').escapesBackslash).toBe(false);
  });

  // BigQuery ne connaît pas le doublement : il lit '' comme deux littéraux
  // collés et refuse la requête — « concatenated string literals must be
  // separated by whitespace ». Toute valeur portant une apostrophe (O'Brien,
  // L'Oréal) faisait donc échouer le visuel, ce qu'aucun test ne voyait parce
  // qu'ils pinaient tous la forme doublée.
  test('BigQuery échappe l’apostrophe par antislash, les autres la doublent', () => {
    expect(quoteLiteral("O'Brien", 'bigquery')).toBe("'O" + BACKSLASH + "'Brien'");
    for (const dbType of dialectTypes()) {
      if (capabilities(dbType).quoteEscape === 'backslash') continue;
      expect(quoteLiteral("O'Brien", dbType)).toBe("'O''Brien'");
    }
  });

  test('une apostrophe ne peut pas refermer le littéral, quel que soit le dialecte', () => {
    for (const dbType of dialectTypes()) {
      const caps = capabilities(dbType);
      const body = quoteLiteral("x' OR '1'='1", dbType).slice(1, -1);
      const neutralise = caps.quoteEscape === 'backslash'
        ? body.split(BACKSLASH + "'").join('')
        : body.split("''").join('');
      expect(neutralise).not.toContain("'");
    }
  });
});
