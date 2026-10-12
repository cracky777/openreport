// Romania's chart of accounts (OMFP 1802/2014) → the lines of the Romanian
// profit and loss account (contul de profit și pierdere), in its order and in
// English: net turnover, change in inventories, own work capitalised, other
// operating income, then the operating expenses by nature — the operating
// result — financial income and expenses — the gross result — income tax and
// the net result. The chart descends from the French one (607 cost of goods
// sold, 707 sales of goods, 64 staff, 68 depreciation…); 691 is the income
// tax, 698 the tax of a micro-enterprise. 121 (profit or loss) and 129 (its
// allocation) carry the result over: the closing entries that empty classes
// 6 and 7 into 121, every month in most books, stand apart (fec.js).
// Classes 8 and 9 (off-balance, management accounting) are not the ledger's.
const { prefixChart } = require('./prefixChart');

const BALANCE = ['Equity & long-term debt', 'Fixed assets', 'Inventories', 'Third-party accounts', 'Cash & investments'];

const chart = prefixChart({
  sections: { operating: '1 Operating', financial: '2 Financial', tax: '3 Income tax', balance: 'Balance sheet' },
  lines: [
    { no: 1, label: 'Net turnover', section: 'operating', income: true, prefixes: ['70'] },
    { no: 2, label: 'Change in inventories', section: 'operating', income: true, prefixes: ['71'] },
    { no: 3, label: 'Own work capitalised', section: 'operating', income: true, prefixes: ['72'] },
    { no: 4, label: 'Other operating income', section: 'operating', income: true, prefixes: ['74', '75', '78'] },
    { no: 5, label: 'Raw materials & consumables', section: 'operating', prefixes: ['601', '602', '603', '604', '606', '608', '609'] },
    { no: 6, label: 'Energy & water', section: 'operating', prefixes: ['605'] },
    { no: 7, label: 'Cost of goods sold', section: 'operating', prefixes: ['607'] },
    { no: 8, label: 'Staff costs', section: 'operating', prefixes: ['64'] },
    { no: 9, label: 'Other operating expenses', section: 'operating', prefixes: ['61', '62', '63', '65'] },
    { no: 10, label: 'Depreciation & value adjustments', section: 'operating', prefixes: ['68'] },
    { no: 11, label: 'Financial income', section: 'financial', income: true, prefixes: ['76', '786'] },
    { no: 12, label: 'Financial expenses', section: 'financial', prefixes: ['66', '686'] },
    { no: 13, label: 'Income tax', section: 'tax', prefixes: ['691'] },
    { no: 14, label: 'Other taxes on income', section: 'tax', prefixes: ['69'] },
  ],
  balance: BALANCE.map((label, i) => ({ no: 101 + i, label: `Class ${i + 1} ${label}`, prefixes: [String(i + 1)] })),
  allocation: ['121', '129'],
  classFallback: { 6: 9, 7: 4 },
});

module.exports = {
  ...chart,
  REVENUE_LINES: [1],
  TOTALS: [
    { key: 'ebitda', label: 'EBITDA', afterLine: 9 },
    { key: 'operatingIncome', label: 'Operating result', afterLine: 10 },
    { key: 'currentIncome', label: 'Gross result', afterLine: 12 },
    { key: 'netIncome', label: 'Net result', afterLine: 14 },
  ],
};
