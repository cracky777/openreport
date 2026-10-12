// The accounting pack offered after the import of books (a FEC, a SAF-T): a
// model over their `entries` table and one report of six pages. What differs
// between charts of accounts comes from charts.js. Built as a plan, like a .pbit import: the
// client walks the usual create routes (/models/import, /reports/import), so
// every rule those enforce applies here too.
const crypto = require('crypto');
const { modelToYaml } = require('../modelYaml');
const { chartOf, expenseLines } = require('./charts');

// Amounts in the books' currency; books imported before it was recorded are
// French, in euros.
const SYMBOLS = { EUR: '€', NOK: 'kr', SEK: 'kr', DKK: 'kr', RON: 'lei', PLN: 'zł' };
const money = (currency) => ({ decimals: 0, thousandSep: ' ', prefix: '', suffix: ` ${SYMBOLS[currency || 'EUR'] || currency}` });

// Colours of the Finance package, on Open Report's dark theme (which the
// client applies): purple for income and totals, orange for expenses, a
// lavender tint of the purple as third series; the deep purple and a burnt
// orange colour the income statement. Chosen by Jonathan (a purple-and-orange
// palette), checked for contrast and colour-blind separation on the panel.
const DARK = { purple: '#9158d7', orange: '#e2762e', lavender: '#c9aaf5', deepPurple: '#532594', burnt: '#8a4318', text: '#cbd5e1', panel: '#111827' };
const PALETTE = [DARK.purple, DARK.orange, DARK.lavender, '#e8a23a', '#7038b7', '#e58b33'];
// Expenses are orange wherever they show: the treemap of their natures too.
const ORANGES = [DARK.orange, '#e8a23a', '#e58b33', '#e79536', '#e48030'];

// The accounts of customers (`receivable`) or suppliers (`payable`): by
// number in a chart that numbers them, by balance-sheet line where accounts
// are the company's own (the Dutch RGS).
function partyRule(chart, side, rule) {
  const lines = chart[`${side}Lines`];
  return lines ? rule('Line', 'in', '', lines) : rule('CompteNum', 'starts_with', chart[`${side}Prefix`]);
}
const partyName = (chart, side) => (chart[`${side}Lines`] ? '' : ` (${chart[`${side}Prefix`]})`);

function buildModelFields(t, name, accounting) {
  const chart = chartOf(accounting);
  const currencyFormat = money(accounting?.currency);
  const dim = (column, label, type = 'string') => ({ name: `${t}.${column}`, table: t, column, type, label });
  const dimensions = [
    dim('Line', 'P&L line'),
    dim('Section', 'Section'),
    dim('Statement', 'Statement'),
    dim('Account', 'Account'),
    dim('CompteNum', 'Account number'),
    dim('CompteLib', 'Account label'),
    dim('AccountClass', 'Account class'),
    dim('LineNo', 'Line number', 'integer'),
    dim('Period', 'Month'),
    dim('FiscalYear', 'Fiscal year', 'integer'),
    { name: '_date.month_name', table: t, column: 'EcritureDate', type: 'string', label: 'Month name', datePartOf: `${t}.EcritureDate`, datePart: 'name_month' },
    { name: '_date.year', table: t, column: 'EcritureDate', type: 'integer', label: 'Year', datePartOf: `${t}.EcritureDate`, datePart: 'num_year' },
    dim('EcritureDate', 'Entry date', 'date'),
    dim('JournalCode', 'Journal code'),
    dim('JournalLib', 'Journal'),
    dim('EcritureNum', 'Entry number'),
    dim('EcritureLib', 'Entry label'),
    dim('CompAuxNum', 'Sub-ledger account'),
    dim('CompAuxLib', 'Third party'),
    dim('PieceRef', 'Document reference'),
    dim('PieceDate', 'Document date', 'date'),
    dim('EcritureLet', 'Matching code'),
    dim('DateLet', 'Matching date', 'date'),
    dim('ValidDate', 'Validation date', 'date'),
    dim('Idevise', 'Currency'),
  ];

  const col = (c) => `"${t}"."${c}"`;
  const rule = (field, op, value, values = []) => ({ field: `${t}.${field}`, isMeasure: false, op, value, values });
  const upToLine = (no) => [rule('LineNo', 'lte', String(no))];
  const amount = (name, label, filterRules) => ({ name, label, table: t, column: 'Amount', aggregation: 'sum', dataType: 'decimal', format: currencyFormat, ...(filterRules ? { filterRules, overrideFilters: false } : {}) });
  const signFlipped = (name, label, filterRules, description) => ({ name, label, table: '', column: '', aggregation: 'custom', expression: `-SUM(${col('Amount')})`, format: currencyFormat, filterRules, overrideFilters: false, description });

  const measures = [
    amount(`${t}.Amount_sum`, 'Amount', null),
    { name: `${t}.Debit_sum`, label: 'Debit', table: t, column: 'Debit', aggregation: 'sum', dataType: 'decimal', format: currencyFormat },
    { name: `${t}.Credit_sum`, label: 'Credit', table: t, column: 'Credit', aggregation: 'sum', dataType: 'decimal', format: currencyFormat },
    { name: '_calc.balance', label: 'Balance', table: '', column: '', aggregation: 'custom', expression: `SUM(${col('Debit')}) - SUM(${col('Credit')})`, format: currencyFormat, description: 'Debit minus credit, as a trial balance shows it.' },
    amount('_calc.revenue', 'Revenue', [rule('LineNo', 'in', '', chart.REVENUE_LINES.map(String))]),
    signFlipped('_calc.expenses', 'Expenses', [rule('LineNo', 'in', '', expenseLines(chart).map(String))], 'The expense lines of the income statement, as a positive amount.'),
    ...chart.TOTALS.map((s) => amount(`_calc.${s.key}`, s.label, upToLine(s.afterLine))),
    { name: '_calc.netMargin', label: 'Net margin', table: '', column: '', aggregation: 'custom', expression: '${_calc.netIncome} * 100.0 / NULLIF(${_calc.revenue}, 0)', format: { decimals: 1, thousandSep: ' ', prefix: '', suffix: ' %' } },
    signFlipped('_calc.receivables', 'Customer balance', [partyRule(chart, 'receivable', rule)], 'What customers owe: debit minus credit of their accounts.'),
    amount('_calc.payables', 'Supplier balance', [partyRule(chart, 'payable', rule)]),
  ];
  // Income and expenses alike are added up as credit − debit: an income line
  // is positive, an expense negative, and their sum is the result.
  measures[0].description = 'Credit minus debit: income positive, expenses negative.';

  return {
    name,
    description: chart.origin,
    selected_tables: [t],
    table_positions: {},
    dimensions,
    measures,
    joins: [],
    rls: {},
    column_types: {},
    date_column: `${t}.EcritureDate`,
    incremental_months: null,
  };
}

function makePage(id, name) {
  const page = { id, name, layout: [], widgets: {} };
  page.add = (x, y, w, h, widget) => {
    const key = crypto.randomUUID();
    page.layout.push({ i: key, x, y, w, h, z: page.layout.length + 1 });
    page.widgets[key] = widget;
  };
  return page;
}

// `accounting.years`: the fiscal years the source holds. Every page reads one
// year at a time (a "Fiscal year" slicer opening on the latest, its N-1 on the
// cards); with several years a page compares them side by side.
function buildReport(t, { title, accounting }) {
  const chart = chartOf(accounting);
  const f = (c) => `${t}.${c}`;
  const filterOn = (c, op, value, values = []) => ({ field: f(c), isMeasure: false, op, value, values });
  const incomeStatement = filterOn('Statement', 'in', '', ['Income statement']);
  const expensesOnly = filterOn('LineNo', 'in', '', expenseLines(chart).map(String));
  // The chart names its totals ("Operating result", "Net result for the
  // year"): the cards say so, and the series colours follow those names.
  const totalLabel = (key) => chart.TOTALS.find((x) => x.key === key).label;
  const NET = totalLabel('netIncome');
  const OPERATING = totalLabel('operatingIncome');
  // What it costs to run the business: no tax on the result (a tax credit
  // would come out as a negative tile), nor profit-sharing.
  const runningCosts = filterOn('LineNo', 'in', '', chart.LINES.filter((l) => !l.income && l.section !== 'tax').map((l) => String(l.no)));
  // A third party whose account is settled owes nothing: not an open balance.
  const settled = (measure) => ({ field: measure, isMeasure: true, op: 'neq', value: '0', values: [] });
  // Column looks, by label: amounts right-aligned, codes and numbers read as
  // text (left), and nothing wraps — a date or an amount split over two
  // lines reads as two values.
  const amountCol = { header: { wordWrap: false }, values: { alignment: 'right', wordWrap: false } };
  const codeCol = { header: { wordWrap: false }, values: { alignment: 'left', wordWrap: false } };
  const columns = (amounts, codes = []) => Object.fromEntries([...amounts.map((l) => [l, amountCol]), ...codes.map((l) => [l, codeCol])]);
  const topN = (measure, n) => ({ field: measure, isMeasure: true, op: 'top_n', value: String(n), values: [] });
  const years = Array.isArray(accounting?.years) ? accounting.years : [];

  // Slicers sit right-aligned on the title row. A year slicer picks one year
  // and opens on the latest; a search slicer filters on the text typed.
  const yearSlicer = { dim: 'FiscalYear', title: 'Fiscal year', w: 150, config: { slicerStyle: 'dropdown', multiSelect: false, opensOn: 'latest', showSearch: false } };
  const searchSlicer = (dim, title, w = 220, searchMatch = 'contains') => ({ dim, title, w, config: { slicerStyle: 'search', searchMatch, searchPlaceholder: `Search ${title.toLowerCase()}…` } });
  const header = (page, text, slicers = []) => {
    let right = 1124;
    for (const sl of slicers) {
      right -= sl.w;
      page.add(right, 4, sl.w, 64, { type: 'filter', dataBinding: { selectedDimensions: [f(sl.dim)] }, config: { title: sl.title, transparentBg: true, borderEnabled: false, ...sl.config } });
      right -= 16;
    }
    page.add(16, 12, right - 16, 48, { type: 'text', data: { text }, config: { fontSize: 22, textAlign: 'left', color: 'var(--text-primary)', transparentBg: true, borderEnabled: false } });
  };
  // Cards compare with the year before the one picked in the year slicer.
  const kpi = (page, x, y, w, label, measure) => page.add(x, y, w, 112, {
    type: 'scorecard',
    dataBinding: { selectedMeasures: [measure], compareDateDim: f('FiscalYear') },
    config: { label, valueSize: 28, labelSize: 14, showN1Percent: true, showN1Difference: false, showN1Value: false, n1PercentStyle: { iconEnabled: true, iconColorEnabled: true, textColorEnabled: true } },
  });
  // An income statement read at a glance: the biggest expenses in burnt
  // orange, the biggest income in deep purple, the small amounts in the panel's own
  // colour; the first level open and in bold.
  const statementPivot = (title) => ({
    title,
    pivotConfig: { expandDepth: 1, boldFirstLevel: true },
    tableConfig: { columns: { Amount: { conditionalFormatting: [{ type: 'colorScale', minColor: DARK.burnt, midColor: DARK.panel, maxColor: DARK.deepPurple }] } } },
  });

  const overview = makePage('page-1', 'Overview');
  header(overview, title, [yearSlicer]);
  [['Revenue', '_calc.revenue'], ['EBITDA', '_calc.ebitda'], [OPERATING, '_calc.operatingIncome'], [NET, '_calc.netIncome']]
    .forEach(([label, m], i) => kpi(overview, 16 + i * 287, 72, 261, label, m));
  overview.add(16, 196, 700, 290, {
    type: 'bar',
    dataBinding: { selectedDimensions: [f('Period')], selectedMeasures: ['_calc.revenue', '_calc.expenses'] },
    config: { title: 'Revenue and expenses by month', palette: PALETTE, legendColors: { Revenue: DARK.purple, Expenses: DARK.orange }, subType: 'grouped', showLegend: true, legendPosition: 'top', valueAbbreviation: 'auto', showXAxisTitle: false, showYAxisTitle: false },
  });
  overview.add(732, 196, 392, 290, {
    type: 'treemap',
    dataBinding: { selectedDimensions: [f('Line')], selectedMeasures: ['_calc.expenses'], widgetFilters: [runningCosts] },
    config: { title: 'Expenses by nature', palette: ORANGES, showDataLabels: true, dataLabelContent: 'name', dataLabelFontSize: 11 },
  });
  overview.add(16, 502, 700, 286, {
    type: 'line',
    dataBinding: { selectedDimensions: [f('Period')], selectedMeasures: ['_calc.ebitda', '_calc.netIncome'] },
    config: { title: `EBITDA and ${NET.toLowerCase()} by month`, palette: PALETTE, legendColors: { EBITDA: DARK.purple, [NET]: DARK.orange }, showLegend: true, legendPosition: 'top', smooth: true, valueAbbreviation: 'auto', showXAxisTitle: false, showYAxisTitle: false },
  });
  overview.add(732, 502, 392, 286, {
    type: 'table',
    dataBinding: { selectedDimensions: [f('Account')], selectedMeasures: ['_calc.expenses'], columnOrder: [f('Account'), '_calc.expenses'], widgetFilters: [expensesOnly, topN('_calc.expenses', 10)] },
    config: { title: 'Top 10 expense accounts', tableConfig: { sort: { columnName: 'Expenses', direction: 'desc' }, columns: columns(['Expenses']) } },
  });

  const statement = makePage('page-2', 'Income statement');
  header(statement, 'Income statement', [yearSlicer, searchSlicer('Account', 'Account')]);
  statement.add(16, 72, 1108, 716, {
    type: 'pivotTable',
    dataBinding: { selectedDimensions: [f('Section'), f('Line'), f('Account')], columnDimensions: [f('Period')], selectedMeasures: [`${t}.Amount_sum`], widgetFilters: [incomeStatement] },
    config: statementPivot('Income statement by month (income +, expenses −)'),
  });

  const sig = makePage('page-3', chart.bridgePage);
  header(sig, chart.bridgeTitle, [yearSlicer]);
  sig.add(16, 72, 1108, 420, {
    type: 'waterfall',
    // A line opens on its accounts: click a bar to drill down.
    dataBinding: { selectedDimensions: [f('Line'), f('Account')], selectedMeasures: [`${t}.Amount_sum`], widgetFilters: [incomeStatement] },
    config: {
      title: 'From revenue to net income — click a line to see its accounts',
      subtotals: chart.TOTALS.filter((s) => s.key !== 'netIncome').map((s) => ({ after: chart.lineLabel(chart.LINES.find((l) => l.no === s.afterLine)), label: s.label })),
      showTotal: true,
      totalLabel: NET,
      increaseColor: DARK.purple,
      decreaseColor: DARK.orange,
      totalColor: DARK.lavender,
      showDataLabels: true,
      valueAbbreviation: 'auto',
    },
  });
  // One card per running total of the chart; a total that needs lines the
  // books do not use (a gross margin without goods) is left out. Unknown
  // lines (an older import) keep it.
  const used = Array.isArray(accounting?.incomeLines) ? accounting.incomeLines : null;
  const sigCards = chart.TOTALS
    .filter((s) => !s.needsLines || !used || s.needsLines.some((n) => used.includes(n)))
    .map((s) => [s.card || s.label, `_calc.${s.key}`]);
  const cardW = Math.floor((1108 - (sigCards.length - 1) * 14) / sigCards.length);
  sigCards.forEach(([label, m], i) => kpi(sig, 16 + i * (cardW + 14), 508, cardW, label, m));
  kpi(sig, 16, 636, 1108, `Net margin (${NET.toLowerCase()} ÷ revenue)`, '_calc.netMargin');

  const parties = makePage('page-4', 'Customers & suppliers');
  header(parties, 'Customers & suppliers — open balances', [yearSlicer]);
  const partyChart = (x, title, measure, side, color) => parties.add(x, 72, 546, 716, {
    type: 'bar',
    dataBinding: { selectedDimensions: [f('CompAuxLib')], selectedMeasures: [measure], widgetFilters: [partyRule(chart, side, filterOn), filterOn('CompAuxLib', 'is_not_empty', ''), settled(measure), topN(measure, 15)] },
    config: { title, color, dataLabelColor: DARK.text, barDirection: 'horizontal', sortOrder: 'asc', showDataLabels: true, valueAbbreviation: 'auto', showYAxis: true, showXAxisTitle: false, showYAxisTitle: false },
  });
  partyChart(16, `Customers — top 15 amounts owed${partyName(chart, 'receivable')}`, '_calc.receivables', 'receivable', DARK.purple);
  partyChart(578, `Suppliers — top 15 amounts due${partyName(chart, 'payable')}`, '_calc.payables', 'payable', DARK.orange);

  const trial = makePage('page-5', 'Trial balance');
  header(trial, 'Trial balance', [yearSlicer, searchSlicer('CompteLib', 'Account label'), searchSlicer('CompteNum', 'Account number', 180, 'starts_with')]);
  const trialMeasures = [`${t}.Debit_sum`, `${t}.Credit_sum`, '_calc.balance'];
  trial.add(16, 72, 1108, 716, {
    type: 'table',
    dataBinding: { selectedDimensions: [f('CompteNum'), f('CompteLib')], selectedMeasures: trialMeasures, columnOrder: [f('CompteNum'), f('CompteLib'), ...trialMeasures] },
    config: { title: 'Balance by account', tableConfig: { columns: columns(['Debit', 'Credit', 'Balance'], ['Account number']) } },
  });

  const ledger = makePage('page-6', 'General ledger');
  header(ledger, 'General ledger', [yearSlicer, searchSlicer('Account', 'Account'), searchSlicer('EcritureLib', 'Entry label', 200)]);
  const ledgerDims = ['EcritureDate', 'JournalCode', 'EcritureNum', 'Account', 'EcritureLib', 'PieceRef'].map(f);
  const ledgerMeasures = [`${t}.Debit_sum`, `${t}.Credit_sum`];
  ledger.add(16, 72, 1108, 716, {
    type: 'table',
    dataBinding: { selectedDimensions: ledgerDims, selectedMeasures: ledgerMeasures, columnOrder: [...ledgerDims, ...ledgerMeasures] },
    config: { title: 'Entries', tableConfig: { columns: columns(['Debit', 'Credit'], ['Entry date', 'Journal code', 'Entry number', 'Document reference']) } },
  });

  const all = [overview, statement, sig, parties, trial, ledger];
  if (years.length > 1) {
    // No year slicer here: the years are the columns.
    const compare = makePage('page-7', 'Year over year');
    header(compare, `Year over year · ${years.join(', ')}`, [searchSlicer('Account', 'Account')]);
    compare.add(16, 72, 620, 716, {
      type: 'pivotTable',
      dataBinding: { selectedDimensions: [f('Section'), f('Line'), f('Account')], columnDimensions: [f('FiscalYear')], selectedMeasures: [`${t}.Amount_sum`], widgetFilters: [incomeStatement] },
      config: statementPivot('Income statement by fiscal year'),
    });
    compare.add(652, 72, 472, 350, {
      type: 'line',
      dataBinding: { selectedDimensions: ['_date.month_name'], groupBy: [f('FiscalYear')], selectedMeasures: ['_calc.revenue'] },
      config: { title: 'Revenue by month, year over year', palette: PALETTE, smooth: true, zoneSorts: { values: 'none', axis: 'asc' }, showLegend: true, legendPosition: 'top', valueAbbreviation: 'auto', showXAxisTitle: false, showYAxisTitle: false },
    });
    compare.add(652, 438, 472, 350, {
      type: 'bar',
      dataBinding: { selectedDimensions: [f('FiscalYear')], selectedMeasures: ['_calc.revenue', '_calc.ebitda', '_calc.netIncome'] },
      config: { title: 'Key figures by year', palette: PALETTE, legendColors: { Revenue: DARK.purple, EBITDA: DARK.lavender, [NET]: DARK.orange }, dataLabelColor: DARK.text, subType: 'grouped', showLegend: true, legendPosition: 'top', showDataLabels: true, valueAbbreviation: 'auto', showXAxisTitle: false, showYAxisTitle: false },
    });
    all.splice(1, 0, compare);
  }

  const pages = all.map(({ id, name, layout, widgets }) => ({ id, name, layout, widgets }));
  return {
    format: 'open-report.report.v1',
    report: {
      title,
      layout: pages[0].layout,
      widgets: pages[0].widgets,
      pages,
      settings: { pageWidth: 1140, pageHeight: 800 },
    },
  };
}

// `tableName`: the books' table in the source; `modelName`: a name still free.
function buildFecPack({ datasourceName, tableName, accounting, modelName }) {
  const fields = buildModelFields(tableName, modelName, accounting);
  const title = `${datasourceName} — Accounts`;
  return {
    model: { name: modelName, yaml: modelToYaml(fields, datasourceName) },
    report: { title, bundle: buildReport(tableName, { title, accounting }) },
  };
}

module.exports = { buildFecPack, buildModelFields, buildReport };
