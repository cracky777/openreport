// ClickHouse est le connecteur qui s'éloigne le plus de PostgreSQL, donc celui
// où le défaut silencieux ferait le plus de dégâts. Ce test fige les formes
// qu'il émet, et surtout celles qu'il ne doit PAS emprunter ailleurs.
const { quoteIdent, quoteLiteral, capabilities } = require('../utils/sqlDialect');
const { castToString, castToNumber, castToDate } = require('../utils/sqlBuilder/casts');
const { buildDatePartExpr } = require('../utils/sqlBuilder/datePart');
const { buildTopNOrderLimit } = require('../utils/sqlBuilder/orderLimit');
const { buildMeasureAggExpr } = require('../utils/sqlBuilder/measureAgg');

const BT = String.fromCharCode(96);
const part = (p) => buildDatePartExpr({ table: 't', column: 'd', datePart: p }, 'clickhouse', {});

describe('citation et échappement', () => {
  test('accent grave doublé, comme MySQL', () => {
    expect(quoteIdent('a' + BT + 'b', 'clickhouse')).toBe(BT + 'a' + BT + BT + 'b' + BT);
  });

  // L'antislash est significatif dans une chaîne ClickHouse ; l'apostrophe s'y
  // échappe aussi bien en la doublant qu'en la précédant d'un antislash, et le
  // doublement est celui que la documentation garantit.
  test('apostrophe doublée, antislash doublé', () => {
    expect(quoteLiteral("O'Brien", 'clickhouse')).toBe("'O''Brien'");
    expect(quoteLiteral('a' + String.fromCharCode(92) + 'b', 'clickhouse'))
      .toBe("'a" + String.fromCharCode(92) + String.fromCharCode(92) + "b'");
  });
});

describe('types', () => {
  test('String, Int64 et Decimal — aucun nom de type emprunté à PostgreSQL', () => {
    expect(castToString('x', 'clickhouse')).toBe('CAST(x AS String)');
    expect(castToNumber('x', 'clickhouse', 'integer')).toBe('CAST(x AS Int64)');
    expect(castToNumber('x', 'clickhouse', 'decimal', 'String'))
      .toBe("CAST(REPLACE(CAST(x AS String), ',', '.') AS Decimal(38, 10))");
    for (const sql of [castToString('x', 'clickhouse'), castToNumber('x', 'clickhouse', 'integer')]) {
      expect(sql).not.toMatch(/VARCHAR|INTEGER|NUMERIC/);
    }
  });

  test('parseDateTime lit la syntaxe MySQL, pas le TO_DATE de PostgreSQL', () => {
    expect(castToDate('x', 'clickhouse', 'dd/mm/yyyy')).toBe("toDate(parseDateTime(x, '%d/%m/%Y'))");
    expect(castToDate('x', 'clickhouse', 'auto')).toBe('toDate(x)');
    expect(castToDate('x', 'clickhouse', 'dd/mm/yyyy')).not.toMatch(/TO_DATE/);
  });
});

describe('parties de date', () => {
  test('chaque part passe par sa fonction dédiée', () => {
    expect(part('num_year')).toBe('toYear(toDate(' + BT + 't' + BT + '.' + BT + 'd' + BT + '))');
    expect(part('num_month')).toMatch(/^toMonth\(/);
    expect(part('num_week')).toMatch(/^toWeek\(/);
    expect(part('num_day_of_week')).toMatch(/^toDayOfWeek\(/);
  });

  // formatDateTime suit la syntaxe MySQL : '%M' est le nom complet du MOIS et
  // '%W' celui du jour. '%B', qui donnerait le mois ailleurs, n'existe pas ici —
  // c'est la faute qu'a faite BigQuery avec TO_CHAR, en sens inverse. Le mois
  // passe donc par monthName(), qui ne dépend d'aucun format.
  test('les noms de mois et de jour n’empruntent aucun format d’un autre moteur', () => {
    expect(part('name_month')).toMatch(/^monthName\(/);
    expect(part('name_day')).toBe("formatDateTime(toDate(" + BT + 't' + BT + '.' + BT + 'd' + BT + "), '%W')");
    for (const p of ['name_month', 'name_day']) {
      expect(part(p)).not.toMatch(/TO_CHAR|FORMAT_DATE|DATENAME|STRFTIME|'%B'|'%A'/);
    }
  });
});

describe('tri, pagination, agrégats', () => {
  test('NULLS LAST en ligne et LIMIT', () => {
    expect(buildTopNOrderLimit({ aggExpr: 'sum(x)', direction: 'DESC', n: 5 }, 'clickhouse'))
      .toBe(' ORDER BY sum(x) DESC NULLS LAST LIMIT 5');
  });

  test('aucun élargissement de somme : sum(Float32) rend déjà du Float64', () => {
    const m = { table: 't', column: 'amt', aggregation: 'sum', widenFloat: true };
    expect(buildMeasureAggExpr(m, { dbType: 'clickhouse', columnTypes: {} }))
      .toBe('SUM(' + BT + 't' + BT + '.' + BT + 'amt' + BT + ')');
    expect(capabilities('clickhouse').wideFloat).toBeNull();
  });

  test('pas de type colonne INTERVAL, donc pas d’EXTRACT(EPOCH …)', () => {
    const m = { table: 't', column: 'dur', aggregation: 'sum', dataType: 'interval' };
    expect(buildMeasureAggExpr(m, { dbType: 'clickhouse', columnTypes: {} })).not.toMatch(/EPOCH/);
  });
});
