// Austria's standard chart of accounts (EKR, Einheitskontenrahmen, as the
// Ministry of Finance publishes it for SAF-T AT, which names each account's
// EKR account in AccountID_oeEKR) → the lines of an Austrian income statement
// by nature (Gesamtkostenverfahren, § 231 UGB), in its order and in English.
// Class 4 is income, 5 materials, 6 staff, 7 depreciation (70) and other
// operating expenses, 8 financial items, taxes on income (85) and the
// allocation to and from reserves (86–89). Class 0 — fixed assets — numbers
// its accounts with two or three digits (400 is a machine, not revenue).
// Depreciation comes after the other operating expenses (the layout lists it
// before them) so that EBITDA closes after a line, as every running total of
// the package does.
const { prefixChart } = require('./prefixChart');

const chart = prefixChart({
  sections: { operating: '1 Operating', financial: '2 Financial', tax: '3 Taxes', balance: 'Balance sheet' },
  lines: [
    { no: 1, label: 'Revenue', section: 'operating', income: true, prefixes: ['40', '41', '42', '43', '44'] },
    { no: 2, label: 'Change in inventories & own work capitalised', section: 'operating', income: true, prefixes: ['45'] },
    { no: 3, label: 'Other operating income', section: 'operating', income: true, prefixes: ['46', '47', '48', '49'] },
    { no: 4, label: 'Cost of materials & purchased services', section: 'operating', prefixes: ['5'] },
    { no: 5, label: 'Staff costs', section: 'operating', prefixes: ['6'] },
    { no: 6, label: 'Other operating expenses', section: 'operating', prefixes: ['71', '72', '73', '74', '75', '76', '77', '78', '79'] },
    { no: 7, label: 'Depreciation', section: 'operating', prefixes: ['70'] },
    // 8000–8219: income from participations, interest, disposals and write-ups.
    { no: 8, label: 'Financial income', section: 'financial', income: true, prefixes: ['80', '81', '820', '821'] },
    { no: 9, label: 'Financial expenses', section: 'financial', prefixes: ['822', '823', '824', '825', '826', '827', '828', '829', '83'] },
    { no: 10, label: 'Extraordinary items', section: 'financial', prefixes: ['84'] },
    { no: 11, label: 'Taxes on income', section: 'tax', prefixes: ['85'] },
  ],
  balance: [
    { no: 101, label: 'Class 0 Fixed assets', prefixes: ['0'] },
    { no: 102, label: 'Class 1 Inventories', prefixes: ['1'] },
    { no: 103, label: 'Class 20-21 Trade receivables', prefixes: ['20', '21'] },
    { no: 104, label: 'Class 22-29 Other receivables, cash & prepayments', prefixes: ['22', '23', '24', '25', '26', '27', '28', '29'] },
    { no: 105, label: 'Class 30 Provisions', prefixes: ['30'] },
    { no: 106, label: 'Class 33 Trade payables', prefixes: ['33'] },
    { no: 107, label: 'Class 31-39 Other liabilities & deferred income', prefixes: ['31', '32', '34', '35', '36', '37', '38', '39'] },
    { no: 108, label: 'Class 9 Equity', prefixes: ['90', '91', '92', '93', '94', '95', '96', '97'] },
  ],
  allocation: ['86', '87', '88', '89', '989'],
  other: [{ prefixes: ['98'], statement: 'Opening & closing balance', line: 'Class 98 Opening & closing balance accounts', lineNo: 300 }],
});

// A fixed asset is numbered on two or three digits.
const classifyAccount = (account) => {
  const num = String(account || '').trim();
  return /^\d{2,3}$/.test(num) ? chart.classifyAccount(`0${num}`) : chart.classifyAccount(num);
};

module.exports = {
  ...chart,
  classifyAccount,
  REVENUE_LINES: [1],
  TOTALS: [
    { key: 'grossMargin', label: 'Gross profit', afterLine: 4, needsLines: [4] },
    { key: 'ebitda', label: 'EBITDA', afterLine: 6 },
    { key: 'operatingIncome', label: 'Operating result (EBIT)', afterLine: 7 },
    { key: 'currentIncome', label: 'Result before taxes', afterLine: 10 },
    { key: 'netIncome', label: 'Net income for the year', afterLine: 11 },
  ],
  receivableLines: ['Class 20-21 Trade receivables'],
  payableLines: ['Class 33 Trade payables'],
};
