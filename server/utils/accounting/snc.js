// Portugal's chart of accounts (SNC, Sistema de Normalização Contabilística)
// → the lines of the Portuguese income statement by nature (demonstração dos
// resultados por naturezas), in its order and in English, down to its own
// totals: the result before depreciation, financing costs and taxes (EBITDA),
// the operating result, the result before tax and the net result. Classes 1–5
// are the balance sheet, 6 expenses, 7 income, 8 the result.
//
// 811 (result before tax), 818 (net result) and 89 (interim dividends) carry
// the year's result over: the closing entries ("apuramento de resultados")
// that empty classes 6 and 7 into 811 then stand apart (fec.js). 812, the
// income tax of the period, stays in the statement.
const { prefixChart } = require('./prefixChart');

const chart = prefixChart({
  sections: { operating: '1 Operating', financial: '2 Financing', tax: '3 Income tax', balance: 'Balance sheet' },
  lines: [
    { no: 1, label: 'Sales & services rendered', section: 'operating', income: true, prefixes: ['71', '72'] },
    { no: 2, label: 'Operating subsidies', section: 'operating', income: true, prefixes: ['75'] },
    { no: 3, label: 'Change in production inventories', section: 'operating', income: true, prefixes: ['73'] },
    { no: 4, label: 'Own work capitalised', section: 'operating', income: true, prefixes: ['74'] },
    { no: 5, label: 'Cost of goods sold & materials consumed', section: 'operating', prefixes: ['61'] },
    { no: 6, label: 'External supplies & services', section: 'operating', prefixes: ['62'] },
    { no: 7, label: 'Staff costs', section: 'operating', prefixes: ['63'] },
    // Impairment of receivables and inventories, and provisions, come before
    // EBITDA; that of depreciable assets goes with depreciation.
    { no: 8, label: 'Impairment & provisions', section: 'operating', prefixes: ['65', '67'] },
    { no: 9, label: 'Other income', section: 'operating', income: true, prefixes: ['76', '77', '78'] },
    { no: 10, label: 'Other expenses', section: 'operating', prefixes: ['66', '68'] },
    { no: 11, label: 'Depreciation, amortisation & impairment of depreciable assets', section: 'operating', prefixes: ['64', '654', '655', '656'] },
    { no: 12, label: 'Interest & similar income', section: 'financial', income: true, prefixes: ['79'] },
    { no: 13, label: 'Interest & similar expenses', section: 'financial', prefixes: ['69'] },
    { no: 14, label: 'Income tax for the period', section: 'tax', prefixes: ['812'] },
  ],
  balance: [
    { no: 101, label: 'Class 1 Cash & bank deposits', prefixes: ['1'] },
    { no: 102, label: 'Class 2 Receivables & payables', prefixes: ['2'] },
    { no: 103, label: 'Class 3 Inventories', prefixes: ['3'] },
    { no: 104, label: 'Class 4 Investments & fixed assets', prefixes: ['4'] },
    { no: 105, label: 'Class 5 Equity', prefixes: ['5'] },
  ],
  allocation: ['811', '818', '89'],
  classFallback: { 6: 10, 7: 9 },
});

module.exports = {
  ...chart,
  REVENUE_LINES: [1],
  TOTALS: [
    { key: 'ebitda', label: 'EBITDA', afterLine: 10 },
    { key: 'operatingIncome', label: 'Operating result', afterLine: 11 },
    { key: 'currentIncome', label: 'Result before tax', afterLine: 13 },
    { key: 'netIncome', label: 'Net result for the period', afterLine: 14 },
  ],
};
