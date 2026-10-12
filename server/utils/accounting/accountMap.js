// Accounts placed by hand. A chart places most accounts by their number; an
// account it does not know, or a company's own reading of one, is placed by
// the user on a line of the same chart (`map`: { account: line number }).
// The books keep that placing: every refresh and every fiscal year merged in
// is mapped again (routes/fileUpload.js passes the map to the import job).
const { CHARTS } = require('./charts');
const { setClosingEntriesApart } = require('./fec');

const q = (ident) => `"${String(ident).replace(/"/g, '""')}"`;

// Where an account can go in a chart: an income statement line, a
// balance-sheet group, a technical class, the result allocation — or nowhere.
function targetsOf(chartId) {
  const chart = CHARTS[chartId] || CHARTS.pcg;
  return [
    ...chart.LINES.map((l) => ({ lineNo: l.no, statement: 'Income statement', section: chart.SECTIONS[l.section], line: chart.lineLabel(l) })),
    ...chart.BALANCE.map((b) => ({ lineNo: b.no, statement: 'Balance sheet', section: chart.SECTIONS.balance || 'Balance sheet', line: b.label })),
    ...chart.OTHER.map((o) => ({ lineNo: o.lineNo, statement: o.statement, section: o.statement, line: o.line })),
    { lineNo: 200, statement: 'Result allocation', section: 'Result allocation', line: 'Net result & allocations' },
    { lineNo: 999, statement: 'Unclassified', section: 'Unclassified', line: 'Unclassified' },
  ];
}

// Place the accounts of `map` in the books' table, then set the closing
// entries apart again: placing an account changes which entries close the year.
async function applyAccountMap(dbInstance, tableName, chartId, map) {
  const targets = new Map(targetsOf(chartId).map((t) => [t.lineNo, t]));
  const rows = Object.entries(map || {}).filter(([, n]) => targets.has(Number(n)));
  if (!rows.length) return;
  await dbInstance.run('CREATE TEMP TABLE account_map (CompteNum VARCHAR, Statement VARCHAR, Section VARCHAR, Line VARCHAR, LineNo INTEGER)');
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200);
    const params = batch.flatMap(([account, n]) => {
      const t = targets.get(Number(n));
      return [account, t.statement, t.section, t.line, t.lineNo];
    });
    await dbInstance.run(`INSERT INTO account_map VALUES ${batch.map(() => '(?, ?, ?, ?, ?)').join(', ')}`, ...params);
  }
  await dbInstance.run(`UPDATE ${q(tableName)} SET Statement = m.Statement, Section = m.Section, Line = m.Line, LineNo = m.LineNo
    FROM account_map m WHERE ${q(tableName)}.CompteNum = m.CompteNum`);
  await dbInstance.run('DROP TABLE account_map');
  await setClosingEntriesApart(dbInstance, tableName);
}

// What the summary of each file of the books says once accounts move: its
// net income, the income statement lines it uses, its unplaced accounts.
async function booksStats(dbInstance, tableName) {
  const rows = await dbInstance.all(`SELECT SourceFile, Statement, LineNo, CompteNum, SUM(Amount)::DOUBLE AS amount
    FROM ${q(tableName)} GROUP BY 1, 2, 3, 4`);
  const byFile = {};
  for (const r of rows) {
    const s = byFile[r.SourceFile] || (byFile[r.SourceFile] = { netIncome: 0, incomeLines: new Set(), unclassifiedAccounts: new Set() });
    if (r.Statement === 'Income statement') { s.netIncome += r.amount; s.incomeLines.add(r.LineNo); }
    if (r.Statement === 'Unclassified') s.unclassifiedAccounts.add(r.CompteNum);
  }
  return Object.fromEntries(Object.entries(byFile).map(([file, s]) => [file, {
    netIncome: Math.round(s.netIncome * 100) / 100,
    incomeLines: [...s.incomeLines].sort((a, b) => a - b),
    unclassifiedAccounts: [...s.unclassifiedAccounts].sort().slice(0, 50),
  }]));
}

module.exports = { targetsOf, applyAccountMap, booksStats };
