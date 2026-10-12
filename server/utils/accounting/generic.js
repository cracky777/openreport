// A chart for books whose country imposes none (the United Kingdom, Italy,
// Spain, Switzerland…): an income statement by nature as IFRS and most
// national layouts share it, and a balance sheet in eight groups. It knows no
// account number — every account starts unclassified and the user places it
// (account mapping), which the books then keep through every refresh.
const { prefixChart } = require('./prefixChart');

const chart = prefixChart({
  sections: { operating: '1 Operating', financial: '2 Financial', tax: '3 Tax', balance: 'Balance sheet' },
  lines: [
    { no: 1, label: 'Revenue', section: 'operating', income: true, prefixes: [] },
    { no: 2, label: 'Other operating income', section: 'operating', income: true, prefixes: [] },
    { no: 3, label: 'Cost of sales & materials', section: 'operating', prefixes: [] },
    { no: 4, label: 'Staff costs', section: 'operating', prefixes: [] },
    { no: 5, label: 'Other operating expenses', section: 'operating', prefixes: [] },
    { no: 6, label: 'Depreciation & amortisation', section: 'operating', prefixes: [] },
    { no: 7, label: 'Financial income', section: 'financial', income: true, prefixes: [] },
    { no: 8, label: 'Financial expenses', section: 'financial', prefixes: [] },
    { no: 9, label: 'Income tax', section: 'tax', prefixes: [] },
  ],
  balance: [
    { no: 101, label: 'B1 Fixed assets', prefixes: [] },
    { no: 102, label: 'B2 Inventories', prefixes: [] },
    { no: 103, label: 'B3 Trade receivables', prefixes: [] },
    { no: 104, label: 'B4 Other current assets & cash', prefixes: [] },
    { no: 105, label: 'B5 Equity', prefixes: [] },
    { no: 106, label: 'B6 Provisions & long-term liabilities', prefixes: [] },
    { no: 107, label: 'B7 Trade payables', prefixes: [] },
    { no: 108, label: 'B8 Other current liabilities', prefixes: [] },
  ],
});

module.exports = {
  ...chart,
  REVENUE_LINES: [1],
  TOTALS: [
    { key: 'grossMargin', label: 'Gross profit', afterLine: 3, needsLines: [3] },
    { key: 'ebitda', label: 'EBITDA', afterLine: 5 },
    { key: 'operatingIncome', label: 'Operating profit', afterLine: 6 },
    { key: 'currentIncome', label: 'Profit before tax', afterLine: 8 },
    { key: 'netIncome', label: 'Net profit', afterLine: 9 },
  ],
  receivableLines: ['B3 Trade receivables'],
  payableLines: ['B7 Trade payables'],
};
