// A general ledger exported to CSV or Excel — the way books travel where no
// standard audit file exists (Belgium, the United Kingdom, Italy, Spain,
// Switzerland…). The file is first read as any CSV or workbook; the user says
// which column is what and which chart its accounts follow (`ledger`, sent
// with the upload as JSON), and its rows become the same `entries` table a
// FEC does, classified on that chart — or on none, every account to be
// placed by hand (accountMap.js).
//
// `ledger` = { chart, currency, amounts, columns: { date, account,
// accountName, debit, credit, amount, side, journal, entry, label, party,
// partyName, document } }. `amounts`: 'debitCredit' (two columns), 'signed'
// (one, debit positive) or 'side' (an amount and a column saying D or C).
// Column names are looked up among the table's own; nothing of `ledger` is
// written into SQL but those names, quoted.
const { importEntries, amountSql } = require('./fec');
const { CHARTS, LEDGER_CHARTS } = require('./charts');

const q = (ident) => `"${String(ident).replace(/"/g, '""')}"`;
const FIELDS = ['date', 'account', 'accountName', 'debit', 'credit', 'amount', 'side', 'journal', 'entry', 'label', 'party', 'partyName', 'document'];
const CURRENCY = /^[A-Z]{3}$/;

function readLedger(raw) {
  let ledger = raw;
  if (typeof raw === 'string') {
    try { ledger = JSON.parse(raw); } catch { throw new Error('The ledger settings could not be read'); }
  }
  if (!ledger || typeof ledger !== 'object') throw new Error('The ledger settings could not be read');
  const chart = LEDGER_CHARTS.some(([id]) => id === ledger.chart) ? ledger.chart : null;
  if (!chart) throw new Error('Choose the chart of accounts the ledger follows');
  const amounts = ['debitCredit', 'signed', 'side'].includes(ledger.amounts) ? ledger.amounts : 'debitCredit';
  const columns = {};
  for (const f of FIELDS) if (typeof ledger.columns?.[f] === 'string' && ledger.columns[f]) columns[f] = ledger.columns[f];
  return { chart, amounts, columns, currency: CURRENCY.test(ledger.currency || '') ? ledger.currency : 'EUR' };
}

async function importLedger({ dbInstance, sourceTable, ledger: raw, tableName, originalName }) {
  const { chart, amounts, columns, currency } = readLedger(raw);
  const existing = new Set((await dbInstance.all(`SELECT column_name FROM information_schema.columns WHERE table_name = ?`, sourceTable)).map((r) => r.column_name));
  for (const [field, name] of Object.entries(columns)) {
    if (!existing.has(name)) throw new Error(`The column "${name}" chosen as ${field} is not in the file`);
  }
  const needed = ['date', 'account', ...(amounts === 'debitCredit' ? ['debit', 'credit'] : amounts === 'signed' ? ['amount'] : ['amount', 'side'])];
  const missing = needed.filter((f) => !columns[f]);
  if (missing.length) throw new Error(`Say which column holds: ${missing.join(', ')}`);

  const text = (field) => (columns[field] ? `NULLIF(trim(CAST(${q(columns[field])} AS VARCHAR)), '')` : 'CAST(NULL AS VARCHAR)');
  const n = (field) => amountSql(`CAST(${q(columns[field])} AS VARCHAR)`);
  let debit;
  let credit;
  if (amounts === 'debitCredit') {
    debit = n('debit');
    credit = n('credit');
  } else {
    // 'side': D, Debit, Soll, + … is a debit; anything else a credit.
    const isDebit = amounts === 'signed' ? `${n('amount')} > 0` : `regexp_matches(upper(trim(CAST(${q(columns.side)} AS VARCHAR))), '^(D|S|\\+)')`;
    const value = `abs(${n('amount')})`;
    debit = `CASE WHEN ${isDebit} THEN ${value} ELSE 0 END`;
    credit = `CASE WHEN ${isDebit} THEN 0 ELSE ${value} END`;
  }
  // The FEC's columns, as text: importEntries types them.
  await dbInstance.run(`CREATE TEMP TABLE ledger_raw AS SELECT
    ${text('journal')} AS JournalCode, ${text('journal')} AS JournalLib, ${text('entry')} AS EcritureNum,
    CAST(${q(columns.date)} AS VARCHAR) AS EcritureDate, ${text('account')} AS CompteNum, ${text('accountName')} AS CompteLib,
    ${text('party')} AS CompAuxNum, COALESCE(${text('partyName')}, ${text('party')}) AS CompAuxLib, ${text('document')} AS PieceRef,
    CAST(NULL AS VARCHAR) AS PieceDate, ${text('label')} AS EcritureLib,
    CAST(${debit} AS VARCHAR) AS Debit, CAST(${credit} AS VARCHAR) AS Credit,
    CAST(NULL AS VARCHAR) AS EcritureLet, CAST(NULL AS VARCHAR) AS DateLet, CAST(NULL AS VARCHAR) AS ValidDate,
    CAST(NULL AS VARCHAR) AS Montantdevise, CAST(NULL AS VARCHAR) AS Idevise
    FROM ${q(sourceTable)}`);
  const fecColumns = ['JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompteLib', 'CompAuxNum', 'CompAuxLib',
    'PieceRef', 'PieceDate', 'EcritureLib', 'Debit', 'Credit', 'EcritureLet', 'DateLet', 'ValidDate', 'Montantdevise', 'Idevise'];
  const summary = await importEntries({
    dbInstance, rawTable: 'ledger_raw', tableName, classify: CHARTS[chart].classifyAccount,
    layout: { delimiter: '\t', columns: Object.fromEntries(fecColumns.map((c) => [c, c])), amounts: 'debitCredit' },
    fiscalYear: null, sourceFile: String(originalName || '').split(/[\\/]/).pop(),
  });
  await dbInstance.run('DROP TABLE ledger_raw');
  if (!summary.entries) throw new Error('No line of the ledger has an account number');
  // The settings stay with the books: a refresh reads the next export alike.
  return { kind: 'ledger', chart, country: null, currency, companyId: null, companyName: null, ledger: { chart, amounts, columns, currency }, ...summary };
}

module.exports = { importLedger, readLedger };
