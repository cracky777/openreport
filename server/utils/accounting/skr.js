// Germany's two standard charts of accounts, DATEV's SKR03 (process-oriented,
// the most used) and SKR04 (statement-oriented) → the lines of the German
// income statement by nature (Gesamtkostenverfahren, § 275 HGB), in English:
// revenue, change in inventories, own work capitalised, other operating
// income, cost of materials — the gross profit (Rohergebnis) — staff, other
// operating expenses, depreciation, financial items, income taxes, other
// taxes. Depreciation comes after the other operating expenses (in the HGB it
// comes before them) so that EBITDA closes after a line, as every running
// total of the package does. What used to be extraordinary falls in other
// operating income or expenses, as the HGB has had it since 2016.
//
// Class 9 holds DATEV's carry-forward and statistical accounts (9000 opening
// balances, 9008/9009 those of customers and suppliers): the other side of
// the opening entries, in neither statement.
const { prefixChart } = require('./prefixChart');

const SECTIONS = { operating: '1 Operating', financial: '2 Financial', tax: '3 Taxes', balance: 'Balance sheet' };
const CARRY_FORWARD = { prefixes: ['9'], statement: 'Carry-forward', line: 'Class 9 Carry-forwards & statistics', lineNo: 300 };

const skr03 = prefixChart({
  sections: SECTIONS,
  lines: [
    { no: 1, label: 'Revenue', section: 'operating', income: true, prefixes: ['80', '81', '82', '83', '84', '85', '86', '87', '89'] },
    { no: 2, label: 'Change in inventories', section: 'operating', income: true, prefixes: ['896', '897', '898'] },
    { no: 3, label: 'Own work capitalised', section: 'operating', income: true, prefixes: ['899'] },
    { no: 4, label: 'Other operating income', section: 'operating', income: true, prefixes: ['25', '27', '28', '88'] },
    { no: 5, label: 'Cost of materials', section: 'operating', prefixes: ['3', '40'] },
    { no: 6, label: 'Staff costs', section: 'operating', prefixes: ['41'] },
    { no: 7, label: 'Other operating expenses', section: 'operating', prefixes: ['20', '23', '24', '42', '43', '44', '45', '46', '47', '48', '49'] },
    { no: 8, label: 'Depreciation', section: 'operating', prefixes: ['482', '483', '484', '485', '486', '487', '488'] },
    { no: 9, label: 'Financial income', section: 'financial', income: true, prefixes: ['26'] },
    { no: 10, label: 'Financial expenses', section: 'financial', prefixes: ['21'] },
    // Trade tax (4320) is an income tax in the statements, wherever SKR03 files it.
    { no: 11, label: 'Income taxes', section: 'tax', prefixes: ['22', '432'] },
    { no: 12, label: 'Other taxes', section: 'tax', prefixes: ['434', '435'] },
  ],
  balance: [
    { no: 101, label: 'Class 00-05 Fixed assets', prefixes: ['00', '01', '02', '03', '04', '05'] },
    { no: 102, label: 'Class 06-07 Long-term liabilities', prefixes: ['06', '07'] },
    { no: 103, label: 'Class 08 Equity', prefixes: ['08'] },
    { no: 104, label: 'Class 09 Provisions & special items', prefixes: ['09'] },
    { no: 105, label: 'Class 10-13 Cash & bank', prefixes: ['10', '11', '12', '13'] },
    { no: 106, label: 'Class 14-15 Receivables & other assets', prefixes: ['14', '15'] },
    { no: 107, label: 'Class 16-17 Payables & other liabilities', prefixes: ['16', '17'] },
    { no: 108, label: 'Class 18-19 Private & clearing accounts', prefixes: ['18', '19'] },
    { no: 109, label: 'Class 3970-3989, 7 Inventories', prefixes: ['397', '398', '7'] },
  ],
  other: [CARRY_FORWARD],
  classFallback: { 3: 5, 4: 7, 8: 1 },
});

const skr04 = prefixChart({
  sections: SECTIONS,
  lines: [
    { no: 1, label: 'Revenue', section: 'operating', income: true, prefixes: ['40', '41', '42', '43', '44', '45', '46', '47'] },
    { no: 2, label: 'Change in inventories', section: 'operating', income: true, prefixes: ['480', '481'] },
    { no: 3, label: 'Own work capitalised', section: 'operating', income: true, prefixes: ['482'] },
    { no: 4, label: 'Other operating income', section: 'operating', income: true, prefixes: ['483', '484', '485', '486', '487', '488', '489', '49'] },
    { no: 5, label: 'Cost of materials', section: 'operating', prefixes: ['5'] },
    { no: 6, label: 'Staff costs', section: 'operating', prefixes: ['60', '61'] },
    { no: 7, label: 'Other operating expenses', section: 'operating', prefixes: ['63', '64', '65', '66', '67', '68', '69'] },
    { no: 8, label: 'Depreciation', section: 'operating', prefixes: ['62'] },
    { no: 9, label: 'Financial income', section: 'financial', income: true, prefixes: ['70', '71'] },
    { no: 10, label: 'Financial expenses', section: 'financial', prefixes: ['72', '73', '74'] },
    { no: 11, label: 'Income taxes', section: 'tax', prefixes: ['760', '761', '762', '763', '764'] },
    { no: 12, label: 'Other taxes', section: 'tax', prefixes: ['765', '766', '767', '768', '769'] },
  ],
  balance: [
    { no: 101, label: 'Class 0 Fixed assets', prefixes: ['0'] },
    { no: 102, label: 'Class 10-11 Inventories', prefixes: ['10', '11'] },
    { no: 103, label: 'Class 12-15 Receivables & other assets', prefixes: ['12', '13', '14', '15'] },
    { no: 104, label: 'Class 16-18 Cash & bank', prefixes: ['16', '17', '18'] },
    { no: 105, label: 'Class 19 Prepaid expenses', prefixes: ['19'] },
    { no: 106, label: 'Class 2 Equity', prefixes: ['2'] },
    { no: 107, label: 'Class 3 Provisions & liabilities', prefixes: ['3'] },
  ],
  // 7700–7999: appropriation of the result (Ergebnisverwendung).
  allocation: ['77', '78', '79'],
  other: [CARRY_FORWARD],
  classFallback: { 4: 1, 5: 5, 6: 7 },
});

// The running totals of a German statement: the gross profit (Rohergebnis),
// EBITDA, the operating result, the result before taxes, the net income.
const TOTALS = [
  { key: 'grossMargin', label: 'Gross profit', afterLine: 5, needsLines: [5] },
  { key: 'ebitda', label: 'EBITDA', afterLine: 7 },
  { key: 'operatingIncome', label: 'Operating result (EBIT)', afterLine: 8 },
  { key: 'currentIncome', label: 'Result before taxes', afterLine: 10 },
  { key: 'netIncome', label: 'Net income for the year', afterLine: 12 },
];

// What DATEV needs of a chart beyond its lines: the collective accounts its
// customer and supplier accounts (five digits and more) roll up to, and its
// VAT accounts and automatic accounts (whose bookings DATEV splits into net
// and VAT itself), by rate.
const SKR = {
  skr03: {
    ...skr03,
    REVENUE_LINES: [1],
    TOTALS,
    receivable: '1400',
    payable: '1600',
    vat: { out: { 0.07: '1771', 0.19: '1776', 0.16: '1775' }, in: { 0.07: '1571', 0.19: '1576', 0.16: '1575' } },
    automatic: [
      { from: 8300, to: 8309, rate: 0.07, kind: 'out' }, { from: 8400, to: 8409, rate: 0.19, kind: 'out' },
      { from: 3300, to: 3309, rate: 0.07, kind: 'in' }, { from: 3400, to: 3409, rate: 0.19, kind: 'in' },
    ],
  },
  skr04: {
    ...skr04,
    REVENUE_LINES: [1],
    TOTALS,
    receivable: '1200',
    payable: '3300',
    vat: { out: { 0.07: '3801', 0.19: '3806', 0.16: '3805' }, in: { 0.07: '1401', 0.19: '1406', 0.16: '1405' } },
    automatic: [
      { from: 4300, to: 4309, rate: 0.07, kind: 'out' }, { from: 4400, to: 4409, rate: 0.19, kind: 'out' },
      { from: 5300, to: 5309, rate: 0.07, kind: 'in' }, { from: 5400, to: 5409, rate: 0.19, kind: 'in' },
    ],
  },
};

module.exports = SKR;
