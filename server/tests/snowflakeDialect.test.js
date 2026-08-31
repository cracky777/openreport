// Snowflake est proche de PostgreSQL sur la citation et les casts, et c'est
// exactement ce qui rend ses divergences dangereuses : elles passeraient sans
// bruit par le défaut PostgreSQL. Ce test fige les trois qui comptent.
const { quoteIdent, quoteLiteral, capabilities } = require('../utils/sqlDialect');
const { castToString, castToNumber, castToDate } = require('../utils/sqlBuilder/casts');
const { buildDatePartExpr } = require('../utils/sqlBuilder/datePart');
const { buildTopNOrderLimit } = require('../utils/sqlBuilder/orderLimit');
const { buildMeasureAggExpr } = require('../utils/sqlBuilder/measureAgg');

const part = (p) => buildDatePartExpr({ table: 't', column: 'd', datePart: p }, 'snowflake', {});

describe('Snowflake — ce qu’il partage avec PostgreSQL', () => {
  test('cite en guillemets doubles et double l’apostrophe', () => {
    expect(quoteIdent('a"b', 'snowflake')).toBe('"a""b"');
    expect(quoteLiteral("O'Brien", 'snowflake')).toBe("'O''Brien'");
  });

  test('TO_DATE avec les mêmes masques, VARCHAR sans borne, NULLS LAST et LIMIT', () => {
    expect(castToDate('x', 'snowflake', 'dd/mm/yyyy')).toBe("TO_DATE(x, 'DD/MM/YYYY')");
    expect(castToString('x', 'snowflake')).toBe('CAST(x AS VARCHAR)');
    expect(buildTopNOrderLimit({ aggExpr: 'SUM("t"."a")', direction: 'DESC', n: 5 }, 'snowflake'))
      .toBe(' ORDER BY SUM("t"."a") DESC NULLS LAST LIMIT 5');
  });
});

describe('Snowflake — les trois divergences', () => {
  // NUMBER vaut NUMBER(38,0) chez Snowflake : un CAST AS NUMERIC tronquerait
  // les décimales sans erreur — un chiffre faux, pas une requête refusée.
  test('les décimales portent une échelle explicite', () => {
    expect(castToNumber('x', 'snowflake', 'decimal', 'varchar'))
      .toBe("CAST(REPLACE(CAST(x AS VARCHAR), ',', '.') AS DECIMAL(38,10))");
    expect(castToNumber('x', 'snowflake', 'integer')).toBe('CAST(x AS INTEGER)');
  });

  // Ses masques sont MM / MON / MMMM ; 'Month' est du PostgreSQL et n'existe
  // pas ici. Et aucun élément de format ne rend un nom de jour complet — d'où
  // le DECODE, monté sur DAYOFWEEKISO qui, contrairement à DAYOFWEEK, ne dépend
  // pas du paramètre de session WEEK_START.
  test('les noms de mois et de jour n’empruntent pas le TO_CHAR de PostgreSQL', () => {
    expect(part('name_month')).toBe(`TO_CHAR(CAST("t"."d" AS DATE), 'MMMM')`);
    expect(part('name_day')).toContain('DAYOFWEEKISO');
    expect(part('name_day')).toContain("'Monday'");
    for (const p of ['num_year', 'num_month', 'name_month', 'num_week', 'num_day_of_week', 'name_day']) {
      expect(part(p)).not.toMatch(/'Month'|'Day'|DOW|FORMAT_DATE|STR_TO_DATE|DATENAME/);
    }
  });

  test('EXTRACT(EPOCH …) reste hors de portée — pas de type colonne INTERVAL', () => {
    const m = { table: 't', column: 'dur', aggregation: 'sum', dataType: 'interval' };
    expect(buildMeasureAggExpr(m, { dbType: 'snowflake', columnTypes: {} })).toBe('SUM("t"."dur")');
  });

  test('aucun élargissement de SUM(real) : tous ses flottants sont du 64 bits', () => {
    const m = { table: 't', column: 'amt', aggregation: 'sum', widenFloat: true };
    expect(buildMeasureAggExpr(m, { dbType: 'snowflake', columnTypes: {} })).toBe('SUM("t"."amt")');
    expect(capabilities('snowflake').wideFloat).toBeNull();
  });
});
