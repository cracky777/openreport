// Oracle est le dialecte le plus éloigné du lot. Trois de ses règles ne
// pardonnent pas si le compilateur retombe sur PostgreSQL.
const { quoteIdent, quoteLiteral, capabilities } = require('../utils/sqlDialect');
const { castToString, castToNumber, castToDate } = require('../utils/sqlBuilder/casts');
const { buildDatePartExpr } = require('../utils/sqlBuilder/datePart');
const { buildTopNOrderLimit } = require('../utils/sqlBuilder/orderLimit');
const { buildMeasureAggExpr } = require('../utils/sqlBuilder/measureAgg');

const col = '"t"."d"';
const part = (p) => buildDatePartExpr({ table: 't', column: 'd', datePart: p }, 'oracle', {});

describe('ce qu’Oracle partage avec PostgreSQL', () => {
  test('guillemets doubles, apostrophe doublée, antislash littéral', () => {
    expect(quoteIdent('a"b', 'oracle')).toBe('"a""b"');
    expect(quoteLiteral("O'Brien", 'oracle')).toBe("'O''Brien'");
    expect(quoteLiteral('C:' + String.fromCharCode(92) + 'tmp', 'oracle'))
      .toBe("'C:" + String.fromCharCode(92) + "tmp'");
  });

  test('TO_DATE lit les mêmes masques', () => {
    expect(castToDate('x', 'oracle', 'dd/mm/yyyy')).toBe("TO_DATE(x, 'DD/MM/YYYY')");
  });
});

describe('la seule cellule du tableau qui refuse une forme nue', () => {
  // `CAST(x AS VARCHAR2)` est une ERREUR DE SYNTAXE chez Oracle : la longueur
  // est obligatoire. Même famille que le VARCHAR(256) de Redshift, mais
  // bruyante — la requête est refusée au lieu de tronquer en silence.
  test('le CAST texte porte une longueur', () => {
    expect(castToString('x', 'oracle')).toBe('CAST(x AS VARCHAR2(4000))');
    expect(castToString('x', 'oracle')).not.toMatch(/VARCHAR2\)/);
  });

  test('les décimales portent une échelle, les entiers non', () => {
    expect(castToNumber('x', 'oracle', 'integer')).toBe('CAST(x AS INTEGER)');
    expect(castToNumber('x', 'oracle', 'decimal', 'VARCHAR2'))
      .toBe("CAST(REPLACE(CAST(x AS VARCHAR2(4000)), ',', '.') AS NUMBER(38,10))");
  });
});

describe('parties de date', () => {
  // EXTRACT d'Oracle ne connaît que YEAR, MONTH, DAY, HOUR, MINUTE, SECOND.
  // Ni WEEK ni DOW : les emprunter à PostgreSQL ferait échouer la requête.
  test('la semaine et le jour de semaine passent par TO_CHAR, pas par EXTRACT', () => {
    expect(part('num_week')).toBe("TO_NUMBER(TO_CHAR(CAST(" + col + " AS DATE), 'IW'))");
    expect(part('num_day_of_week')).toBe("TO_NUMBER(TO_CHAR(CAST(" + col + " AS DATE), 'D'))");
    expect(part('num_week')).not.toMatch(/EXTRACT/);
    expect(part('num_day_of_week')).not.toMatch(/EXTRACT|DOW|DAYOFWEEK/);
  });

  test('l’année et le mois restent sur EXTRACT, qui les connaît', () => {
    expect(part('num_year')).toBe('EXTRACT(YEAR FROM CAST(' + col + ' AS DATE))');
    expect(part('num_month')).toBe('EXTRACT(MONTH FROM CAST(' + col + ' AS DATE))');
  });

  // Sans le troisième argument, les noms suivent NLS_DATE_LANGUAGE : la même
  // requête rendrait « January » ou « Janvier » selon la session, et deux
  // utilisateurs verraient des libellés différents sur le même rapport. FM
  // supprime le remplissage — sans lui Oracle complète à neuf caractères.
  test('les noms sont pinés en anglais et sans remplissage', () => {
    expect(part('name_month')).toContain("'FMMonth'");
    expect(part('name_month')).toContain('NLS_DATE_LANGUAGE=ENGLISH');
    expect(part('name_day')).toContain("'FMDay'");
    expect(part('name_day')).toContain('NLS_DATE_LANGUAGE=ENGLISH');
  });
});

describe('tri, pagination, agrégats', () => {
  // OFFSET … FETCH comme SQL Server, mais avec NULLS LAST, que T-SQL n'a pas.
  test('NULLS LAST en ligne ET pagination par FETCH', () => {
    expect(buildTopNOrderLimit({ aggExpr: 'SUM(x)', direction: 'DESC', n: 5 }, 'oracle'))
      .toBe(' ORDER BY SUM(x) DESC NULLS LAST OFFSET 0 ROWS FETCH NEXT 5 ROWS ONLY');
    expect(capabilities('oracle').pagination).toBe('fetch');
    expect(capabilities('mssql').nullsLast).toBeNull();
  });

  // SUM(BINARY_FLOAT) rend du BINARY_FLOAT — 32 bits, ~7 chiffres — donc un
  // sous-total rebâti d'une somme tronquée s'écarte de la ligne qu'il somme.
  test('les sommes flottantes sont élargies en BINARY_DOUBLE', () => {
    const m = { table: 't', column: 'amt', aggregation: 'sum', widenFloat: true };
    expect(buildMeasureAggExpr(m, { dbType: 'oracle', columnTypes: {} }))
      .toBe('SUM(CAST("t"."amt" AS BINARY_DOUBLE))');
  });

  test('pas d’EXTRACT(EPOCH …) sur les intervalles', () => {
    const m = { table: 't', column: 'dur', aggregation: 'sum', dataType: 'interval' };
    expect(buildMeasureAggExpr(m, { dbType: 'oracle', columnTypes: {} })).not.toMatch(/EPOCH/);
  });
});
