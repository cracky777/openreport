// Redshift est un fork de PostgreSQL 8.0.2 : il parle le même protocole (le
// driver `pg` le pilote tel quel) et, comme tout le sqlBuilder retombe sur la
// branche PostgreSQL quand un `dbType` ne lui dit rien, il hérite du bon SQL
// presque partout. Ce test fige les deux choses qui comptent : ce qu'il hérite
// de PostgreSQL doit rester identique, et les endroits où il en diverge ne
// doivent pas se refermer sur la forme PG.
const { quoteIdent, quoteTable, quoteCol, quoteLiteral } = require('../utils/sqlDialect');
const { castToString, castToNumber, castToDate } = require('../utils/sqlBuilder/casts');
const { buildDatePartExpr } = require('../utils/sqlBuilder/datePart');
const { buildTopNOrderLimit } = require('../utils/sqlBuilder/orderLimit');
const { buildMeasureAggExpr } = require('../utils/sqlBuilder/measureAgg');

const dateExprFor = (part) => buildDatePartExpr({ table: 't', column: 'd', datePart: part }, 'redshift', {});

describe('Redshift — ce qu’il hérite de PostgreSQL', () => {
  test('cite les identifiants avec des guillemets doubles, doublés à l’échappement', () => {
    expect(quoteIdent('col', 'redshift')).toBe('"col"');
    expect(quoteIdent('a"b', 'redshift')).toBe('"a""b"');
    expect(quoteTable('sales.orders', 'redshift')).toBe('"sales"."orders"');
    expect(quoteCol('t', 'amt', 'redshift')).toBe('"t"."amt"');
  });

  test('n’échappe pas les antislashs — standard_conforming_strings y est forcé à on', () => {
    expect(quoteLiteral("O'Brien", 'redshift')).toBe("'O''Brien'");
    expect(quoteLiteral('C:\tmp', 'redshift')).toBe("'C:\tmp'");
  });

  test('garde les parties de date de PostgreSQL (TO_CHAR / DOW), pas celles d’un autre moteur', () => {
    expect(dateExprFor('num_year')).toBe('EXTRACT(YEAR FROM CAST("t"."d" AS DATE))');
    expect(dateExprFor('name_month')).toBe(`TO_CHAR(CAST("t"."d" AS DATE), 'Month')`);
    expect(dateExprFor('num_day_of_week')).toBe('EXTRACT(DOW FROM CAST("t"."d" AS DATE))');
    expect(dateExprFor('name_day')).toBe(`TO_CHAR(CAST("t"."d" AS DATE), 'Day')`);
    for (const part of ['num_year', 'num_month', 'name_month', 'num_week', 'num_day_of_week', 'name_day']) {
      expect(dateExprFor(part)).not.toMatch(/FORMAT_DATE|STR_TO_DATE|DATEPART|DAYOFWEEK/);
    }
  });

  test('accepte NUMERIC / INTEGER et TO_DATE comme PostgreSQL', () => {
    expect(castToNumber('x', 'redshift', 'integer')).toBe('CAST(x AS INTEGER)');
    expect(castToNumber('x', 'redshift', 'decimal', 'double precision')).toBe('CAST(x AS NUMERIC)');
    expect(castToDate('x', 'redshift', 'dd/mm/yyyy')).toBe(`TO_DATE(x, 'DD/MM/YYYY')`);
  });

  test('accepte NULLS LAST en ligne, et LIMIT plutôt que OFFSET…FETCH', () => {
    const topN = { aggExpr: 'SUM("t"."amt")', direction: 'DESC', n: 10 };
    expect(buildTopNOrderLimit(topN, 'redshift'))
      .toBe(' ORDER BY SUM("t"."amt") DESC NULLS LAST LIMIT 10');
  });

  test('élargit SUM(real) en DOUBLE PRECISION comme PostgreSQL', () => {
    const m = { table: 't', column: 'amt', aggregation: 'sum', widenFloat: true };
    expect(buildMeasureAggExpr(m, { dbType: 'redshift', columnTypes: {} }))
      .toBe('SUM(CAST("t"."amt" AS DOUBLE PRECISION))');
  });
});

describe('Redshift — là où il diverge', () => {
  // Un VARCHAR sans longueur vaut VARCHAR(256) sur Redshift, contre une
  // longueur illimitée sur PostgreSQL. Une valeur plus longue serait tronquée
  // avant comparaison, donc une liste IN ramènerait des lignes qu'elle ne
  // devrait pas — un faux résultat, pas une erreur du moteur.
  test('borne explicitement le CAST texte à VARCHAR(65535)', () => {
    expect(castToString('x', 'redshift')).toBe('CAST(x AS VARCHAR(65535))');
    expect(castToString('x', 'postgres')).toBe('CAST(x AS VARCHAR)');
  });

  // Limite assumée : Redshift n'a eu de type colonne INTERVAL que tardivement
  // et n'en expose pas l'EXTRACT(EPOCH …). On le laisse donc hors du groupe
  // PG/DuckDB — une mesure sur une colonne interval s'y comporte comme sur
  // MySQL (pas d'aplatissement), plutôt que d'émettre du SQL refusé par le moteur.
  test('n’aplatit pas les intervalles avec EXTRACT(EPOCH …)', () => {
    const m = { table: 't', column: 'dur', aggregation: 'sum', dataType: 'interval' };
    expect(buildMeasureAggExpr(m, { dbType: 'redshift', columnTypes: {} }))
      .toBe('SUM("t"."dur")');
    expect(buildMeasureAggExpr(m, { dbType: 'postgres', columnTypes: {} }))
      .toBe('EXTRACT(EPOCH FROM SUM("t"."dur"))');
  });
});
