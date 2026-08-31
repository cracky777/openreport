// Chaque dialecte extrait ses parties de date à sa façon, et une part écrite
// dans la syntaxe d'un autre moteur ne donne pas un chiffre faux : elle fait
// échouer la requête. BigQuery n'avait pas de branche et retombait sur celle de
// PostgreSQL — trois parts sur six étaient inutilisables, avec des erreurs
// venues du moteur (`Function not found: TO_CHAR`, `A valid date part name is
// required but found DOW`). Année et mois marchaient, ce qui suffisait à ne
// rien soupçonner.
//
// Les six expressions ont été exécutées sur BigQuery, DuckDB, PostgreSQL et
// Azure SQL : toutes rendent « August » et « Saturday » pour le 29/08/2026. Ce
// test fige les formes émises pour qu'un moteur ne reparte plus avec la syntaxe
// d'un autre.
const { buildDatePartExpr } = require('../utils/sqlBuilder/datePart');

const PARTS = ['num_year', 'num_month', 'name_month', 'num_week', 'num_day_of_week', 'name_day'];
const exprFor = (dbType, part) => buildDatePartExpr({ table: 't', column: 'd', datePart: part }, dbType, {});

describe('buildDatePartExpr — une syntaxe par dialecte', () => {
  test('BigQuery formate avec FORMAT_DATE et nomme le jour DAYOFWEEK', () => {
    expect(exprFor('bigquery', 'num_year')).toBe('EXTRACT(YEAR FROM CAST(`t`.`d` AS DATE))');
    expect(exprFor('bigquery', 'num_month')).toBe('EXTRACT(MONTH FROM CAST(`t`.`d` AS DATE))');
    expect(exprFor('bigquery', 'name_month')).toBe("FORMAT_DATE('%B', CAST(`t`.`d` AS DATE))");
    expect(exprFor('bigquery', 'num_week')).toBe('EXTRACT(WEEK FROM CAST(`t`.`d` AS DATE))');
    expect(exprFor('bigquery', 'num_day_of_week')).toBe('EXTRACT(DAYOFWEEK FROM CAST(`t`.`d` AS DATE))');
    expect(exprFor('bigquery', 'name_day')).toBe("FORMAT_DATE('%A', CAST(`t`.`d` AS DATE))");
  });

  test('BigQuery n’emprunte plus TO_CHAR ni DOW à PostgreSQL', () => {
    for (const part of PARTS) {
      const sql = exprFor('bigquery', part);
      expect(sql).not.toMatch(/TO_CHAR/);
      expect(sql).not.toMatch(/\bDOW\b/);
    }
  });

  test('PostgreSQL garde TO_CHAR et DOW', () => {
    expect(exprFor('postgres', 'name_month')).toBe(`TO_CHAR(CAST("t"."d" AS DATE), 'Month')`);
    expect(exprFor('postgres', 'num_day_of_week')).toBe('EXTRACT(DOW FROM CAST("t"."d" AS DATE))');
    expect(exprFor('azure_postgres', 'name_day')).toBe(`TO_CHAR(CAST("t"."d" AS DATE), 'Day')`);
  });

  test('MySQL utilise ses fonctions nommées', () => {
    expect(exprFor('mysql', 'num_year')).toBe('YEAR(CAST(`t`.`d` AS DATE))');
    expect(exprFor('mysql', 'name_month')).toBe('MONTHNAME(CAST(`t`.`d` AS DATE))');
    expect(exprFor('mysql', 'num_day_of_week')).toBe('DAYOFWEEK(CAST(`t`.`d` AS DATE))');
    expect(exprFor('mysql', 'name_day')).toBe('DAYNAME(CAST(`t`.`d` AS DATE))');
  });

  test('SQL Server passe par DATENAME / DATEPART', () => {
    for (const dbType of ['mssql', 'azure_sql']) {
      expect(exprFor(dbType, 'name_month')).toBe('DATENAME(MONTH, TRY_CONVERT(date, [t].[d]))');
      expect(exprFor(dbType, 'num_week')).toBe('DATEPART(WEEK, TRY_CONVERT(date, [t].[d]))');
      expect(exprFor(dbType, 'name_day')).toBe('DATENAME(WEEKDAY, TRY_CONVERT(date, [t].[d]))');
    }
  });

  test('DuckDB formate avec STRFTIME', () => {
    expect(exprFor('duckdb', 'name_month')).toBe(`STRFTIME(CAST("t"."d" AS DATE), '%B')`);
    expect(exprFor('duckdb', 'name_day')).toBe(`STRFTIME(CAST("t"."d" AS DATE), '%A')`);
  });

  // Le garde-fou qui vaut pour un dialecte ajouté demain : aucun moteur ne doit
  // hériter d'une fonction qui n'est pas la sienne.
  test('aucune fonction empruntée à un autre moteur', () => {
    const etranger = {
      bigquery: [/TO_CHAR/, /STRFTIME/, /MONTHNAME/, /DATENAME/, /\bDOW\b/],
      postgres: [/FORMAT_DATE/, /STRFTIME/, /MONTHNAME/, /DATENAME/],
      mysql: [/TO_CHAR/, /FORMAT_DATE/, /STRFTIME/, /DATENAME/, /EXTRACT/],
      mssql: [/TO_CHAR/, /FORMAT_DATE/, /STRFTIME/, /MONTHNAME/],
      duckdb: [/TO_CHAR/, /FORMAT_DATE/, /MONTHNAME/, /DATENAME/],
    };
    for (const [dbType, interdits] of Object.entries(etranger)) {
      for (const part of PARTS) {
        const sql = exprFor(dbType, part);
        for (const motif of interdits) {
          expect(`${dbType}/${part}: ${sql}`).not.toMatch(motif);
        }
      }
    }
  });

  test('une dimension sans partie de date ne produit pas d’expression', () => {
    expect(buildDatePartExpr({ table: 't', column: 'd' }, 'bigquery', {})).toBeNull();
  });
});
