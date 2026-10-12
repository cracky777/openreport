// Norwegian standard accounts (NS 4102, as SAF-T Financial names them in
// StandardAccountID) → the lines of a Norwegian income statement
// (resultatregnskap), in its order and in English: sales and other operating
// income, cost of goods, staff, other operating costs, depreciation — then the
// operating result (driftsresultat), financial items, the ordinary result
// before tax, tax and the net result for the year (årsresultat). Class 3 is
// income, 4 cost of goods, 5 staff, 6–7 other operating costs, 8 financial
// items and tax. 88 (net result) and 89 (allocations) close the year into
// equity: they stand apart from the statement.
const { prefixChart } = require('./prefixChart');

const chart = prefixChart({
  sections: { operating: '1 Operating', financial: '2 Financial', tax: '3 Tax & extraordinary items', balance: 'Balance sheet' },
  lines: [
    // 33, duties on sales, is deducted from sales revenue.
    { no: 1, label: 'Sales revenue', section: 'operating', income: true, prefixes: ['30', '31', '32', '33'] },
    // Varekostnad: class 4 as one line, subcontracting (45) apart.
    { no: 2, label: 'Cost of goods sold', section: 'operating', prefixes: ['40', '41', '42', '43', '46', '49'] },
    { no: 3, label: 'Other operating income', section: 'operating', income: true, prefixes: ['34', '35', '36', '37', '38', '39'] },
    { no: 4, label: 'Staff costs', section: 'operating', prefixes: ['5'] },
    { no: 5, label: 'Other operating expenses', section: 'operating', prefixes: ['45', '61', '62', '63', '64', '65', '66', '67', '68', '69', '70', '71', '72', '73', '74', '75', '76', '77', '78', '79'] },
    { no: 6, label: 'Depreciation & write-downs', section: 'operating', prefixes: ['60'] },
    { no: 7, label: 'Financial income', section: 'financial', income: true, prefixes: ['80'] },
    { no: 8, label: 'Financial expenses', section: 'financial', prefixes: ['81', '82'] },
    { no: 9, label: 'Tax on ordinary result', section: 'tax', prefixes: ['83'] },
    { no: 10, label: 'Extraordinary income', section: 'tax', income: true, prefixes: ['84'] },
    { no: 11, label: 'Extraordinary expenses', section: 'tax', prefixes: ['85'] },
    { no: 12, label: 'Tax on extraordinary result', section: 'tax', prefixes: ['86', '87'] },
  ],
  balance: [
    { no: 101, label: 'Class 10-13 Fixed assets', prefixes: ['10', '11', '12', '13'] },
    { no: 102, label: 'Class 14 Inventories & prepayments', prefixes: ['14'] },
    { no: 103, label: 'Class 15-17 Receivables', prefixes: ['15', '16', '17'] },
    { no: 104, label: 'Class 18-19 Investments & cash', prefixes: ['18', '19'] },
    { no: 105, label: 'Class 20 Equity', prefixes: ['20'] },
    { no: 106, label: 'Class 21-22 Provisions & long-term liabilities', prefixes: ['21', '22'] },
    { no: 107, label: 'Class 23-29 Current liabilities', prefixes: ['23', '24', '25', '26', '27', '28', '29'] },
  ],
  allocation: ['88', '89'],
  // An income statement account no prefix names falls on its class's line.
  classFallback: { 3: 3, 4: 2, 5: 4, 6: 5, 7: 5 },
});

module.exports = {
  ...chart,
  REVENUE_LINES: [1],
  TOTALS: [
    { key: 'grossMargin', label: 'Gross profit', afterLine: 2, needsLines: [2] },
    { key: 'ebitda', label: 'EBITDA', afterLine: 5 },
    { key: 'operatingIncome', label: 'Operating result', afterLine: 6 },
    { key: 'currentIncome', label: 'Ordinary result before tax', afterLine: 8 },
    { key: 'netIncome', label: 'Net result for the year', afterLine: 12 },
  ],
};
