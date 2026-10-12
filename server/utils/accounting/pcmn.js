// Belgium's minimum standard chart of accounts (PCMN / MAR, Royal Decree of
// 12 September 1983 as amended in 2016) → the lines of the Belgian income
// statement (compte de résultats), in its order and in English: turnover,
// change in inventories, own work capitalised, other operating income, then
// goods, services, remuneration, other operating charges — the gross margin
// sits after services, as in the abridged layout — depreciation, the
// operating result, financial items, income taxes, transfers to and from
// deferred taxes and untaxed reserves, the result for the period.
// Depreciation (630) comes after the other operating charges (the layout
// lists it before them) so that EBITDA closes after a line, as every running
// total of the package does. Non-recurring items (76/66) are split as the
// 2016 layout does: 760–764 and 660–664 operating, the rest financial.
// Classes 69 and 79 appropriate the result: they stand apart.
//
// Belgium has no standard audit file: its books come as a ledger exported to
// CSV or Excel, read with this chart (ledger import).
const { prefixChart } = require('./prefixChart');

const chart = prefixChart({
  sections: { operating: '1 Operating', financial: '2 Financial', tax: '3 Taxes & untaxed reserves', balance: 'Balance sheet' },
  lines: [
    { no: 1, label: 'Turnover', section: 'operating', income: true, prefixes: ['70'] },
    { no: 2, label: 'Change in inventories & orders in progress', section: 'operating', income: true, prefixes: ['71'] },
    { no: 3, label: 'Own work capitalised', section: 'operating', income: true, prefixes: ['72'] },
    { no: 4, label: 'Other operating income', section: 'operating', income: true, prefixes: ['73', '74', '760', '761', '762', '763', '764'] },
    { no: 5, label: 'Raw materials, consumables & goods for resale', section: 'operating', prefixes: ['60'] },
    { no: 6, label: 'Services & other goods', section: 'operating', prefixes: ['61'] },
    { no: 7, label: 'Remuneration, social security & pensions', section: 'operating', prefixes: ['62'] },
    { no: 8, label: 'Other operating charges', section: 'operating', prefixes: ['631', '632', '633', '634', '635', '636', '637', '638', '639', '64', '660', '661', '662', '663', '664'] },
    { no: 9, label: 'Depreciation & amounts written off', section: 'operating', prefixes: ['630'] },
    { no: 10, label: 'Financial income', section: 'financial', income: true, prefixes: ['75', '765', '766', '767', '768', '769'] },
    { no: 11, label: 'Financial charges', section: 'financial', prefixes: ['65', '665', '666', '667', '668', '669'] },
    { no: 12, label: 'Income taxes', section: 'tax', prefixes: ['67', '77'] },
    { no: 13, label: 'Transfers to & from deferred taxes & untaxed reserves', section: 'tax', prefixes: ['68', '78'] },
  ],
  balance: [
    { no: 101, label: 'Class 1 Equity, provisions & long-term debts', prefixes: ['1'] },
    { no: 102, label: 'Class 2 Formation expenses, fixed assets & long-term receivables', prefixes: ['2'] },
    { no: 103, label: 'Class 3 Inventories & orders in progress', prefixes: ['3'] },
    { no: 104, label: 'Class 4 Amounts receivable & payable within one year', prefixes: ['4'] },
    { no: 105, label: 'Class 5 Investments & cash', prefixes: ['5'] },
  ],
  allocation: ['69', '79'],
  classFallback: { 6: 8, 7: 4 },
});

module.exports = {
  ...chart,
  REVENUE_LINES: [1],
  TOTALS: [
    { key: 'grossMargin', label: 'Gross margin', afterLine: 6 },
    { key: 'ebitda', label: 'EBITDA', afterLine: 8 },
    { key: 'operatingIncome', label: 'Operating result', afterLine: 9 },
    { key: 'currentIncome', label: 'Result before taxes', afterLine: 11 },
    { key: 'netIncome', label: 'Result for the period', afterLine: 13 },
  ],
};
