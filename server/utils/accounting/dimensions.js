// The dimensions around the books' `entries` table: accounts, journals, third
// parties and a calendar, each with one row per key, written beside the fact
// every time it is (re)written — an import, a merge of fiscal years, a
// refresh. The Finance package joins them (fecPack.js), and so can any other
// fact a model brings in (a budget reshaped into account × month rows joins
// the same accounts and the same calendar: a constellation).
//
// What stays on the entries is what belongs to the entry, not to the account:
// its place in the income statement (Statement, Section, Line, LineNo), because
// the closing entries of an account are set apart from its other lines
// (fec.js setClosingEntriesApart) — on the account, they would bring the
// result back to zero.
const { calendarTableSql } = require('../fileShape');

const q = (ident) => `"${String(ident).replace(/"/g, '""')}"`;

// Years beyond the last entry the calendar covers: a budget runs ahead of the books.
const YEARS_AHEAD = 5;

const DIMENSION_TABLES = ['accounts', 'journals', 'parties', 'calendar'];

/**
 * (Re)build the four tables from `entries`. A label that changed from one
 * year to the next shows its latest spelling, as the merged entries do.
 */
async function buildBookDimensions(dbInstance, entries) {
  const t = q(entries);
  const latest = (col) => `arg_max(${col}, FiscalYear)`;
  // The account's own place in the statements rides along: a budget joined to
  // the accounts is read by line and section through it (the entries keep
  // their own columns — a closing entry is reclassified line by line).
  await dbInstance.run(`CREATE OR REPLACE TABLE main.accounts AS
    SELECT CompteNum, ${latest('CompteLib')} AS CompteLib, ${latest('Account')} AS Account, ${latest('AccountClass')} AS AccountClass,
      ${latest('Statement')} AS Statement, ${latest('Section')} AS Section, ${latest('Line')} AS Line, ${latest('LineNo')} AS LineNo
    FROM ${t} WHERE CompteNum IS NOT NULL GROUP BY CompteNum ORDER BY CompteNum`);
  await dbInstance.run(`CREATE OR REPLACE TABLE main.journals AS
    SELECT JournalCode, ${latest('JournalLib')} AS JournalLib
    FROM ${t} WHERE JournalCode IS NOT NULL GROUP BY JournalCode ORDER BY JournalCode`);
  await dbInstance.run(`CREATE OR REPLACE TABLE main.parties AS
    SELECT CompAuxNum, ${latest('CompAuxLib')} AS CompAuxLib
    FROM ${t} WHERE CompAuxNum IS NOT NULL GROUP BY CompAuxNum ORDER BY CompAuxNum`);
  const [{ first, last }] = await dbInstance.all(`SELECT year(MIN(EcritureDate))::INTEGER AS first, year(MAX(EcritureDate))::INTEGER AS last FROM ${t}`);
  const from = `DATE '${Number(first) || new Date().getFullYear()}-01-01'`;
  const to = `DATE '${(Number(last) || new Date().getFullYear()) + YEARS_AHEAD}-12-31'`;
  // The fiscal year of a day lives on the calendar, not on the fact. The
  // books open on one day of the year (1 January for most, 1 July for some):
  // the first entry of each fiscal year (the opening balances), when it is
  // a first of month, and the day after a closing that is a month's end —
  // never the last entry alone, which a year in progress cuts short. The
  // most frequent wins, 1 January over a tie. A day from that opening on
  // belongs to the fiscal year ending the year after. A budget joining the
  // calendar on its dates reads the same.
  const [start] = await dbInstance.all(`WITH years AS (SELECT FiscalYear, MIN(EcritureDate) AS a, MAX(EcritureDate) AS b FROM ${t} WHERE EcritureDate IS NOT NULL GROUP BY 1),
    starts AS (SELECT month(a)::INTEGER AS m FROM years WHERE day(a) = 1
      UNION ALL SELECT month(b + INTERVAL 1 DAY)::INTEGER AS m FROM years WHERE b = last_day(b))
    SELECT m FROM starts GROUP BY 1 ORDER BY COUNT(*) DESC, (m = 1) DESC LIMIT 1`);
  const opening = Number(start && start.m) || 1;
  const shift = opening === 1 ? '0' : `CASE WHEN month(c."Date") >= ${opening} THEN 1 ELSE 0 END`;
  await dbInstance.run(`CREATE OR REPLACE TABLE main.calendar AS
    SELECT c.*, CAST(year(c."Date") + ${shift} AS INTEGER) AS FiscalYear
    FROM (${calendarTableSql(from, to)}) c`);
}

module.exports = { buildBookDimensions, DIMENSION_TABLES };
