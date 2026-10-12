// Luxembourg's standard chart of accounts (PCN 2020, Grand-Ducal regulation
// of 12 September 2019) → the lines of the Luxembourg profit and loss account
// by nature (annex III of the regulation of 18 December 2015), in its order
// and in English: net turnover, change in inventories, own work capitalised,
// other operating income, raw materials and other external charges — the
// gross result of the abridged layout — staff, value adjustments, other
// operating expenses, financial items, income taxes, other taxes, the result
// for the financial year. Value adjustments on fixed assets come after the
// other operating expenses (the layout lists them before) so that EBITDA
// closes after a line, as every running total of the package does.
// 142, the result for the financial year, takes the closing entries: they
// stand apart from the statement.
const { prefixChart } = require('./prefixChart');

const chart = prefixChart({
  sections: { operating: '1 Operating', financial: '2 Financial', tax: '3 Taxes', balance: 'Balance sheet' },
  lines: [
    { no: 1, label: 'Net turnover', section: 'operating', income: true, prefixes: ['70'] },
    { no: 2, label: 'Change in inventories of finished goods & work in progress', section: 'operating', income: true, prefixes: ['71'] },
    { no: 3, label: 'Own work capitalised', section: 'operating', income: true, prefixes: ['72'] },
    { no: 4, label: 'Other operating income', section: 'operating', income: true, prefixes: ['74'] },
    { no: 5, label: 'Raw materials & consumables', section: 'operating', prefixes: ['60'] },
    { no: 6, label: 'Other external charges', section: 'operating', prefixes: ['61'] },
    { no: 7, label: 'Staff costs', section: 'operating', prefixes: ['62'] },
    // Corrections and their reversals (73x) on one line, as the layout nets them.
    { no: 8, label: 'Value adjustments on current assets', section: 'operating', prefixes: ['634', '635', '734', '735'] },
    { no: 9, label: 'Other operating expenses', section: 'operating', prefixes: ['64'] },
    { no: 10, label: 'Value adjustments on formation expenses & fixed assets', section: 'operating', prefixes: ['63', '73'] },
    { no: 11, label: 'Financial income', section: 'financial', income: true, prefixes: ['75'] },
    { no: 12, label: 'Value adjustments on financial assets & securities', section: 'financial', prefixes: ['651', '653'] },
    { no: 13, label: 'Interest & other financial charges', section: 'financial', prefixes: ['65'] },
    { no: 14, label: 'Income taxes', section: 'tax', prefixes: ['67', '77'] },
    { no: 15, label: 'Other taxes', section: 'tax', prefixes: ['68', '78'] },
  ],
  balance: [
    { no: 101, label: 'Class 1 Equity, provisions & financial debts', prefixes: ['1'] },
    { no: 102, label: 'Class 2 Formation expenses & fixed assets', prefixes: ['2'] },
    { no: 103, label: 'Class 3 Inventories', prefixes: ['3'] },
    { no: 104, label: 'Class 4 Receivables & payables', prefixes: ['4'] },
    { no: 105, label: 'Class 5 Securities & cash', prefixes: ['5'] },
  ],
  allocation: ['142'],
  classFallback: { 6: 9, 7: 4 },
});

module.exports = {
  ...chart,
  REVENUE_LINES: [1],
  TOTALS: [
    { key: 'grossMargin', label: 'Gross result', afterLine: 6 },
    { key: 'ebitda', label: 'EBITDA', afterLine: 9 },
    { key: 'operatingIncome', label: 'Operating result', afterLine: 10 },
    { key: 'currentIncome', label: 'Result before taxes', afterLine: 13 },
    { key: 'afterTax', label: 'Result after income taxes', afterLine: 14 },
    { key: 'netIncome', label: 'Result for the financial year', afterLine: 15 },
  ],
};
