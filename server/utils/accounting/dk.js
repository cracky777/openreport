// Denmark's standard chart of accounts (the common public standard chart,
// Erhvervsstyrelsen, version of 1 January 2026), as SAF-T Financial DK names
// it in StandardAccountID → the lines of a Danish income statement by nature
// (årsregnskabsloven, artsopdelt), in its order and in English. The chart is
// defined by ranges of four-digit accounts — its summary accounts say which
// (1390 "Nettoomsætning" = 1010–1389…) — read here as the prefixes that cover
// them. Depreciation comes after the other operating expenses (the layout
// lists it before them) so that EBITDA closes after a line, as every running
// total of the package does. The result carried forward (6935–6949) takes
// the closing entries: it stands apart from the statements.
const { prefixChart, rangePrefixes } = require('./prefixChart');

const r = (...ranges) => ranges.flatMap(([from, to]) => rangePrefixes(from, to));

const chart = prefixChart({
  sections: { operating: '1 Operating', financial: '2 Financial', tax: '3 Taxes', balance: 'Balance sheet' },
  lines: [
    { no: 1, label: 'Net turnover', section: 'operating', income: true, prefixes: r([1010, 1389]) },
    { no: 2, label: 'Change in inventories of finished goods & work in progress', section: 'operating', income: true, prefixes: r([1410, 1489]) },
    { no: 3, label: 'Own work capitalised', section: 'operating', income: true, prefixes: r([1496, 1498]) },
    { no: 4, label: 'Other operating income', section: 'operating', income: true, prefixes: r([1510, 1589]) },
    { no: 5, label: 'Raw materials & consumables', section: 'operating', prefixes: r([1610, 1809]) },
    { no: 6, label: 'Other external expenses', section: 'operating', prefixes: r([1830, 2829]) },
    { no: 7, label: 'Staff costs', section: 'operating', prefixes: r([2845, 2989]) },
    // Impairment of current assets beyond the normal, fair value adjustments
    // of investment property, and other operating expenses.
    { no: 8, label: 'Other operating expenses', section: 'operating', prefixes: r([3130, 3139], [3160, 3174], [3181, 3189]) },
    { no: 9, label: 'Depreciation, amortisation & impairment', section: 'operating', prefixes: r([3000, 3099]) },
    { no: 10, label: 'Financial income', section: 'financial', income: true, prefixes: r([3193, 3539]) },
    { no: 11, label: 'Financial expenses', section: 'financial', prefixes: r([3560, 3699]) },
    { no: 12, label: 'Tax on the result for the year', section: 'tax', prefixes: r([3740, 3789]) },
    { no: 13, label: 'Other taxes', section: 'tax', prefixes: r([3810, 3819]) },
  ],
  balance: [
    { no: 101, label: 'B01 Fixed assets', prefixes: r([5010, 6069]) },
    { no: 102, label: 'B02 Inventories', prefixes: r([6080, 6179]) },
    { no: 103, label: 'B03 Trade receivables', prefixes: r([6190, 6209]) },
    { no: 104, label: 'B04 Other receivables & prepayments', prefixes: r([6210, 6409]) },
    { no: 105, label: 'B05 Securities & cash', prefixes: r([6420, 6489]) },
    { no: 106, label: 'B06 Equity', prefixes: r([6510, 6934], [6950, 6969]) },
    { no: 107, label: 'B07 Provisions', prefixes: r([6985, 7049]) },
    { no: 108, label: 'B08 Long-term liabilities', prefixes: r([7055, 7269]) },
    { no: 109, label: 'B09 Trade payables', prefixes: r([7440, 7449]) },
    { no: 110, label: 'B10 Other current liabilities', prefixes: r([7285, 7439], [7450, 8079]) },
  ],
  allocation: r([6935, 6949]),
});

module.exports = {
  ...chart,
  REVENUE_LINES: [1],
  TOTALS: [
    { key: 'grossMargin', label: 'Gross profit', afterLine: 6 },
    { key: 'ebitda', label: 'EBITDA', afterLine: 8 },
    { key: 'operatingIncome', label: 'Operating profit', afterLine: 9 },
    { key: 'currentIncome', label: 'Profit before tax', afterLine: 11 },
    { key: 'netIncome', label: 'Profit for the year', afterLine: 13 },
  ],
  receivableLines: ['B03 Trade receivables'],
  payableLines: ['B09 Trade payables'],
};
