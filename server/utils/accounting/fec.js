// FEC — Fichier des Écritures Comptables (article A47 A-1 of the French LPF):
// the journal-entry export every French company keeping its books on a
// computer must hand to the tax authority. Recognised by its header, never by
// its name: the official file name ends in .txt (SIRENFECYYYYMMDD.txt).
//
// One FEC becomes one table, `entries`: the FEC's own columns (accountants
// know them by these names) typed, plus where each account sits in the
// income statement (pcg.js) and the signed `Amount` every report adds up.
const path = require('path');
const { isValidUtf8, writeUtf8Copy, readFirstLine, utf8CopyPath } = require('../textFile');
const { classifyAccount } = require('./pcg');

const FEC_COLUMNS = [
  'JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompteLib',
  'CompAuxNum', 'CompAuxLib', 'PieceRef', 'PieceDate', 'EcritureLib', 'Debit', 'Credit',
  'EcritureLet', 'DateLet', 'ValidDate', 'Montantdevise', 'Idevise',
  // The text allows one signed amount with its direction instead of Debit/Credit.
  'Montant', 'Sens',
];
const CANONICAL = new Map(FEC_COLUMNS.map((c) => [c.toLowerCase(), c]));
const REQUIRED = ['JournalCode', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompteLib', 'EcritureLib'];

const q = (ident) => `"${String(ident).replace(/"/g, '""')}"`;
const fwd = (p) => p.replace(/\\/g, '/');

// The header of a FEC, or null. Tab and pipe are the two separators the text
// allows; column names are matched without regard to case ("MontantDevise").
// Returns the separator and, per FEC column, the header spelling to read.
function detectFec(filePath) {
  let header;
  try { header = readFirstLine(filePath); } catch { return null; /* unreadable: not ours to judge */ }
  for (const delimiter of ['\t', '|']) {
    const names = header.split(delimiter).map((h) => h.trim());
    if (names.length < 8) continue;
    const columns = {};
    for (const n of names) {
      const c = CANONICAL.get(n.toLowerCase());
      if (c && !columns[c]) columns[c] = n;
    }
    const amounts = (columns.Debit && columns.Credit) ? 'debitCredit' : (columns.Montant && columns.Sens) ? 'amountSign' : null;
    if (amounts && REQUIRED.every((c) => columns[c])) return { delimiter, columns, amounts };
  }
  return null;
}

// "SIRENFECYYYYMMDD": the company and the closing date of the fiscal year.
function parseFecFileName(name) {
  const m = /^(\d{9})FEC(\d{4})(\d{2})(\d{2})/i.exec(path.basename(String(name || '')));
  return m ? { siren: m[1], closingDate: `${m[2]}-${m[3]}-${m[4]}` } : {};
}

// SQL over the raw text columns. The text prescribes a decimal comma and no
// thousands separator, but exports differ: a comma means "decimal comma" and
// the dots and spaces around it go; without one the value is read as written.
const num = (col) => `COALESCE(TRY_CAST(CASE WHEN ${col} LIKE '%,%' THEN replace(replace(replace(trim(${col}), '.', ''), ' ', ''), ',', '.') ELSE replace(trim(${col}), ' ', '') END AS DECIMAL(18,2)), 0)`;
const date = (col) => `CAST(COALESCE(try_strptime(trim(${col}), '%Y%m%d'), try_strptime(trim(${col}), '%d/%m/%Y'), try_strptime(trim(${col}), '%Y-%m-%d'), try_strptime(trim(${col}), '%d.%m.%Y'), try_strptime(trim(${col}), '%d-%m-%Y'), try_strptime(trim(${col}), '%Y/%m/%d'), try_strptime(left(trim(${col}), 19), '%Y-%m-%d %H:%M:%S')) AS DATE)`;
const text = (col) => `NULLIF(trim(${col}), '')`;

// Books laid out as a FEC (columns named as `layout.columns` says, separated
// by `layout.delimiter`) into `tableName` of an open DuckDB instance — a FEC,
// or an audit file another country's reader wrote out in that shape.
// `classify(accountNumber)` places each account in the statements;
// `fiscalYear` names the year, else the last entry's does. Returns what the
// import learnt about the books: period, totals, balance, accounts the chart
// does not name.
// `rawTable`: the books already in a table of the instance, under the FEC's
// column names (a ledger exported to CSV or Excel), instead of a file.
async function importEntries({ dbInstance, filePath, rawTable, layout: fec, tableName, classify, fiscalYear: namedYear, sourceFile }) {
  if (rawTable) {
    await dbInstance.run(`CREATE TEMP TABLE fec_raw AS SELECT * FROM ${q(rawTable)}`);
  } else {
    const utf8 = isValidUtf8(filePath) ? null : utf8CopyPath(filePath);
    if (utf8) writeUtf8Copy(filePath, utf8);
    // Every field as text: the typing below is the FEC's, not a sniffer's
    // guess, and quote='' because labels hold stray quotes, never quoting.
    await dbInstance.run(`CREATE TEMP TABLE fec_raw AS SELECT * FROM read_csv('${fwd(utf8 || filePath)}', delim='${fec.delimiter === '|' ? '|' : '\t'}', header=true, all_varchar=true, quote='', escape='', null_padding=true, strict_mode=false)`);
  }

  const col = (c) => (fec.columns[c] ? q(fec.columns[c]) : 'NULL');
  let debit = num(col('Debit'));
  let credit = num(col('Credit'));
  if (fec.amounts === 'amountSign') {
    const sens = `upper(trim(${col('Sens')}))`;
    debit = `CASE WHEN ${sens} IN ('D', '+1', '1') THEN ${num(col('Montant'))} ELSE 0 END`;
    credit = `CASE WHEN ${sens} IN ('C', '-1') THEN ${num(col('Montant'))} ELSE 0 END`;
  }

  await dbInstance.run(`CREATE TEMP TABLE fec_typed AS SELECT
    ${text(col('JournalCode'))} AS JournalCode, ${text(col('JournalLib'))} AS JournalLib,
    ${text(col('EcritureNum'))} AS EcritureNum, ${date(col('EcritureDate'))} AS EcritureDate,
    ${text(col('CompteNum'))} AS CompteNum, ${text(col('CompteLib'))} AS CompteLib,
    ${text(col('CompAuxNum'))} AS CompAuxNum, ${text(col('CompAuxLib'))} AS CompAuxLib,
    ${text(col('PieceRef'))} AS PieceRef, ${date(col('PieceDate'))} AS PieceDate,
    ${text(col('EcritureLib'))} AS EcritureLib,
    ${debit} AS Debit, ${credit} AS Credit,
    ${text(col('EcritureLet'))} AS EcritureLet, ${date(col('DateLet'))} AS DateLet,
    ${date(col('ValidDate'))} AS ValidDate,
    ${fec.columns.Montantdevise ? num(col('Montantdevise')) : 'NULL'} AS Montantdevise, ${text(col('Idevise'))} AS Idevise
    FROM fec_raw WHERE ${text(col('CompteNum'))} IS NOT NULL`);

  // Classified in JS (the chart's module is the one place the mapping lives),
  // once per account rather than per line, and handed back as parameters: account
  // numbers and labels come from the file.
  const accounts = await dbInstance.all('SELECT CompteNum, mode(CompteLib) AS CompteLib FROM fec_typed GROUP BY CompteNum');
  await dbInstance.run('CREATE TEMP TABLE fec_accounts (CompteNum VARCHAR, Account VARCHAR, AccountClass VARCHAR, Statement VARCHAR, Section VARCHAR, Line VARCHAR, LineNo INTEGER)');
  const unclassified = [];
  for (let i = 0; i < accounts.length; i += 200) {
    const batch = accounts.slice(i, i + 200);
    const params = [];
    for (const a of batch) {
      const c = classify(a.CompteNum);
      if (c.lineNo === 999) unclassified.push(a.CompteNum);
      params.push(a.CompteNum, `${a.CompteNum} ${a.CompteLib || ''}`.trim(), c.accountClass, c.statement, c.section, c.line, c.lineNo);
    }
    await dbInstance.run(`INSERT INTO fec_accounts VALUES ${batch.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ')}`, ...params);
  }

  // Several years of the same books share one table (mergeFecDatabases),
  // told apart by this column.
  const [{ lastYear }] = await dbInstance.all('SELECT year(MAX(EcritureDate))::INTEGER AS lastYear FROM fec_typed');
  const fiscalYear = namedYear || lastYear;
  await dbInstance.run(`CREATE TABLE ${q(tableName)} AS SELECT t.*,
    t.Credit - t.Debit AS Amount,
    strftime(t.EcritureDate, '%Y-%m') AS Period,
    a.Account, a.AccountClass, a.Statement, a.Section, a.Line, a.LineNo,
    ?::INTEGER AS FiscalYear, ?::VARCHAR AS SourceFile
    FROM fec_typed t JOIN fec_accounts a USING (CompteNum)
    ORDER BY t.EcritureDate, t.JournalCode, t.EcritureNum`, fiscalYear, sourceFile);

  await setClosingEntriesApart(dbInstance, tableName);

  const [totals] = await dbInstance.all(`SELECT COUNT(*)::INTEGER AS rows, SUM(Debit)::DOUBLE AS debit, SUM(Credit)::DOUBLE AS credit,
    strftime(MIN(EcritureDate), '%Y-%m-%d') AS firstDate, strftime(MAX(EcritureDate), '%Y-%m-%d') AS lastDate,
    COUNT(*) FILTER (WHERE EcritureDate IS NULL)::INTEGER AS undated,
    SUM(Amount) FILTER (WHERE Statement = 'Income statement')::DOUBLE AS netIncome
    FROM ${q(tableName)}`);
  const lines = await dbInstance.all(`SELECT DISTINCT LineNo FROM ${q(tableName)} WHERE Statement = 'Income statement' ORDER BY LineNo`);
  const [unbalanced] = await dbInstance.all(`SELECT COUNT(*)::INTEGER AS n FROM (
    SELECT 1 FROM ${q(tableName)} GROUP BY JournalCode, EcritureNum HAVING abs(SUM(Debit) - SUM(Credit)) >= 0.01)`);
  for (const t of ['fec_raw', 'fec_typed', 'fec_accounts']) await dbInstance.run(`DROP TABLE ${t}`);

  const round = (v) => Math.round((Number(v) || 0) * 100) / 100;
  return {
    fiscalYear,
    entries: totals.rows,
    firstDate: totals.firstDate,
    lastDate: totals.lastDate,
    debit: round(totals.debit),
    credit: round(totals.credit),
    balanced: Math.abs(round(totals.debit) - round(totals.credit)) < 0.01,
    unbalancedEntries: unbalanced.n,
    undatedLines: totals.undated,
    netIncome: round(totals.netIncome),
    // The income statement lines these books use (their chart's numbers):
    // a company that sells no goods has no gross margin to show.
    incomeLines: lines.map((l) => l.LineNo),
    unclassifiedAccounts: unclassified.slice(0, 50),
  };
}

// Closing entries: where the books carry the year's result over to the
// result account (Portugal's 811/818, Romania's 121 — every month there),
// the income and expense lines of that same entry only empty those accounts.
// Counted in the income statement they would bring it back to zero; they
// stand with the allocation instead. A chart with no allocation account (the
// French one) has none. Run again whenever accounts are mapped anew.
async function setClosingEntriesApart(dbInstance, tableName) {
  await dbInstance.run(`UPDATE ${q(tableName)} t SET Statement = 'Result allocation', Section = 'Result allocation', Line = 'Closing entries', LineNo = 201
    FROM (SELECT DISTINCT JournalCode, EcritureNum FROM ${q(tableName)} WHERE Statement = 'Result allocation') c
    WHERE t.Statement = 'Income statement' AND t.JournalCode IS NOT DISTINCT FROM c.JournalCode AND t.EcritureNum = c.EcritureNum`);
}

// A FEC: its fiscal year is named after the closing date its file name
// carries, else the last entry's.
async function importFec({ dbInstance, filePath, originalName, fec, tableName }) {
  const named = parseFecFileName(originalName);
  const summary = await importEntries({
    dbInstance, filePath, layout: fec, tableName, classify: classifyAccount,
    fiscalYear: named.closingDate ? Number(named.closingDate.slice(0, 4)) : null,
    sourceFile: path.basename(String(originalName || '')),
  });
  return { kind: 'fec', chart: 'pcg', currency: 'EUR', ...named, companyId: named.siren || null, ...summary };
}

module.exports = { detectFec, importFec, importEntries, parseFecFileName, setClosingEntriesApart, amountSql: num };
