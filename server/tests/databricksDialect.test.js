// Databricks parle du Spark SQL, et deux de ses règles ne pardonnent pas si on
// laisse le compilateur retomber sur PostgreSQL.
const { quoteIdent, quoteLiteral, capabilities } = require('../utils/sqlDialect');
const { castToString, castToNumber, castToDate } = require('../utils/sqlBuilder/casts');
const { buildDatePartExpr } = require('../utils/sqlBuilder/datePart');
const { buildTopNOrderLimit } = require('../utils/sqlBuilder/orderLimit');
const { buildMeasureAggExpr } = require('../utils/sqlBuilder/measureAgg');

const BT = String.fromCharCode(96);
const col = BT + 't' + BT + '.' + BT + 'd' + BT;
const part = (p) => buildDatePartExpr({ table: 't', column: 'd', datePart: p }, 'databricks', {});

describe('citation', () => {
  // En Spark SQL, les guillemets doubles délimitent une CHAÎNE. Citer une
  // colonne avec eux ne donne pas une erreur : la requête compare la colonne à
  // son propre nom écrit en toutes lettres. L'accent grave n'est donc pas une
  // préférence de style, c'est la seule forme qui désigne une colonne.
  test('accent grave, jamais guillemet double', () => {
    expect(quoteIdent('col', 'databricks')).toBe(BT + 'col' + BT);
    expect(quoteIdent('col', 'databricks')).not.toContain('"');
    expect(quoteIdent('a' + BT + 'b', 'databricks')).toBe(BT + 'a' + BT + BT + 'b' + BT);
  });

  test('apostrophe doublée, antislash doublé', () => {
    expect(quoteLiteral("O'Brien", 'databricks')).toBe("'O''Brien'");
  });
});

describe('types', () => {
  // DECIMAL sans échelle vaut DECIMAL(10,0) chez Spark : les décimales seraient
  // tronquées sans la moindre erreur. Même piège que MySQL, SQL Server et
  // Snowflake — un chiffre faux, pas une requête refusée.
  test('STRING, BIGINT et une échelle explicite sur les décimales', () => {
    expect(castToString('x', 'databricks')).toBe('CAST(x AS STRING)');
    expect(castToNumber('x', 'databricks', 'integer')).toBe('CAST(x AS BIGINT)');
    expect(castToNumber('x', 'databricks', 'decimal', 'STRING'))
      .toBe("CAST(REPLACE(CAST(x AS STRING), ',', '.') AS DECIMAL(38, 10))");
  });
});

describe('formats de date — la famille Java', () => {
  // Spark ne connaît que les motifs Java. « MM » y est le mois et « mm » la
  // minute : l'inverse exact d'une casse de strftime. Passer les jetons d'une
  // famille à l'autre ne lève pas d'erreur — ça rend une date fausse.
  test('to_date reçoit des jetons Java, pas du strftime ni un masque PostgreSQL', () => {
    expect(castToDate('x', 'databricks', 'dd/mm/yyyy')).toBe("to_date(x, 'dd/MM/yyyy')");
    expect(castToDate('x', 'databricks', 'yyyymmdd')).toBe("to_date(x, 'yyyyMMdd')");
    for (const f of ['iso', 'dd/mm/yyyy', 'mm/dd/yyyy', 'yyyymmdd']) {
      const sql = castToDate('x', 'databricks', f);
      expect(sql).not.toMatch(/%[A-Za-z]/);
      expect(sql).not.toMatch(/TO_DATE|PARSE_DATE|STR_TO_DATE|TRY_CONVERT/);
    }
  });

  // Quatre lettres exactement, la règle Java pour la forme longue.
  test('MMMM et EEEE donnent les noms complets', () => {
    expect(part('name_month')).toBe("date_format(to_date(" + col + "), 'MMMM')");
    expect(part('name_day')).toBe("date_format(to_date(" + col + "), 'EEEE')");
    for (const p of ['name_month', 'name_day']) {
      expect(part(p)).not.toMatch(/'%B'|'%M'|'%W'|'%A'|Month|monthName|TO_CHAR/);
    }
  });

  test('les parts numériques passent par les fonctions Spark', () => {
    expect(part('num_year')).toBe('year(to_date(' + col + '))');
    expect(part('num_month')).toBe('month(to_date(' + col + '))');
    expect(part('num_week')).toBe('weekofyear(to_date(' + col + '))');
    expect(part('num_day_of_week')).toBe('dayofweek(to_date(' + col + '))');
  });
});

describe('tri et agrégats', () => {
  test('NULLS LAST en ligne et LIMIT', () => {
    expect(buildTopNOrderLimit({ aggExpr: 'sum(x)', direction: 'DESC', n: 5 }, 'databricks'))
      .toBe(' ORDER BY sum(x) DESC NULLS LAST LIMIT 5');
  });

  test('aucun élargissement : sum(FLOAT) rend déjà du DOUBLE', () => {
    const m = { table: 't', column: 'amt', aggregation: 'sum', widenFloat: true };
    expect(buildMeasureAggExpr(m, { dbType: 'databricks', columnTypes: {} }))
      .toBe('SUM(' + BT + 't' + BT + '.' + BT + 'amt' + BT + ')');
    expect(capabilities('databricks').wideFloat).toBeNull();
  });
});
