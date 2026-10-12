// Sweden's BAS chart of accounts (the de facto standard every Swedish
// package numbers its accounts on: BAS 2014, EUBAS97… share its classes) →
// the lines of a Swedish income statement by nature (resultaträkning,
// kostnadsslagsindelad, Årsredovisningslagen), in its order and in English:
// net sales, own work capitalised, other operating income, goods and
// materials, other external expenses, staff — then depreciation, the
// operating result (rörelseresultat), financial items, appropriations
// (bokslutsdispositioner), tax and the net result for the year (årets
// resultat). Depreciation comes after the other operating expenses (the law
// lists it before them) so that EBITDA closes after a line, as every running
// total of the package does. 8999, the year's result, closes it into equity
// (2099): it stands apart from the statement.
const { prefixChart } = require('./prefixChart');

const chart = prefixChart({
  sections: { operating: '1 Operating', financial: '2 Financial', tax: '3 Appropriations & tax', balance: 'Balance sheet' },
  lines: [
    { no: 1, label: 'Net sales', section: 'operating', income: true, prefixes: ['30', '31', '32', '33', '34', '35', '36', '37'] },
    { no: 2, label: 'Own work capitalised', section: 'operating', income: true, prefixes: ['38'] },
    { no: 3, label: 'Other operating income', section: 'operating', income: true, prefixes: ['39'] },
    // Råvaror, handelsvaror, underentreprenader and the change in stocks.
    { no: 4, label: 'Goods, materials & subcontracting', section: 'operating', prefixes: ['4'] },
    { no: 5, label: 'Other external expenses', section: 'operating', prefixes: ['5', '6'] },
    { no: 6, label: 'Staff costs', section: 'operating', prefixes: ['70', '71', '72', '73', '74', '75', '76'] },
    { no: 7, label: 'Other operating expenses', section: 'operating', prefixes: ['79'] },
    { no: 8, label: 'Depreciation & write-downs', section: 'operating', prefixes: ['77', '78'] },
    { no: 9, label: 'Financial income', section: 'financial', income: true, prefixes: ['80', '81', '82', '83'] },
    { no: 10, label: 'Interest & financial expenses', section: 'financial', prefixes: ['84'] },
    { no: 11, label: 'Appropriations', section: 'tax', prefixes: ['88'] },
    { no: 12, label: 'Tax on the result', section: 'tax', prefixes: ['89'] },
  ],
  balance: [
    { no: 101, label: 'Class 10-13 Fixed assets', prefixes: ['10', '11', '12', '13'] },
    { no: 102, label: 'Class 14 Inventories', prefixes: ['14'] },
    { no: 103, label: 'Class 15-17 Receivables & prepayments', prefixes: ['15', '16', '17'] },
    { no: 104, label: 'Class 18-19 Investments & cash', prefixes: ['18', '19'] },
    { no: 105, label: 'Class 20 Equity', prefixes: ['20'] },
    { no: 106, label: 'Class 21 Untaxed reserves', prefixes: ['21'] },
    { no: 107, label: 'Class 22-23 Provisions & long-term liabilities', prefixes: ['22', '23'] },
    { no: 108, label: 'Class 24-29 Current liabilities', prefixes: ['24', '25', '26', '27', '28', '29'] },
  ],
  allocation: ['899'],
  classFallback: { 3: 3, 4: 4, 5: 5, 6: 5, 7: 6 },
});

module.exports = {
  ...chart,
  REVENUE_LINES: [1],
  TOTALS: [
    { key: 'grossMargin', label: 'Gross profit', afterLine: 4, needsLines: [4] },
    { key: 'ebitda', label: 'EBITDA', afterLine: 7 },
    { key: 'operatingIncome', label: 'Operating result', afterLine: 8 },
    { key: 'currentIncome', label: 'Result after financial items', afterLine: 10 },
    { key: 'netIncome', label: 'Net result for the year', afterLine: 12 },
  ],
};
