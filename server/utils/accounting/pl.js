// Poland: the markers JPK_KR_PD ties every account to (S_12_1, the Ministry
// of Finance's dictionary for ordinary companies, TMapKontaPOZ) → the lines
// of the Polish profit and loss account by nature (rachunek zysków i strat,
// wariant porównawczy), in its order and in English. Polish companies number
// their own accounts; the marker says where each one goes: RP… the profit and
// loss by nature, RK… lines of the cost-of-sales layout, BA… assets, BP…
// equity and liabilities, INNE none of these. Codes are read by prefix, the
// longest winning (RPBVIII before RPBV). Depreciation comes after the other
// operating costs (the layout lists it first) so that EBITDA closes after a
// line, as every running total of the package does. BPAVI, the net profit,
// takes the closing entries (account 860): it stands apart.
const { prefixChart } = require('./prefixChart');

const chart = prefixChart({
  valid: /^(RP|RK|BA|BP|INNE)/,
  sections: { operating: '1 Operating', financial: '2 Financial', tax: '3 Income tax', balance: 'Balance sheet' },
  lines: [
    { no: 1, label: 'Net revenue from sales of products', section: 'operating', income: true, prefixes: ['RPAI'] },
    { no: 2, label: 'Change in inventories of products', section: 'operating', income: true, prefixes: ['RPAII'] },
    { no: 3, label: 'Own work capitalised', section: 'operating', income: true, prefixes: ['RPAIII'] },
    { no: 4, label: 'Net revenue from sales of goods & materials', section: 'operating', income: true, prefixes: ['RPAIV'] },
    { no: 5, label: 'Materials & energy', section: 'operating', prefixes: ['RPBII'] },
    { no: 6, label: 'External services', section: 'operating', prefixes: ['RPBIII'] },
    { no: 7, label: 'Taxes & charges', section: 'operating', prefixes: ['RPBIV'] },
    { no: 8, label: 'Salaries', section: 'operating', prefixes: ['RPBV'] },
    { no: 9, label: 'Social security & other benefits', section: 'operating', prefixes: ['RPBVI'] },
    { no: 10, label: 'Other costs by nature', section: 'operating', prefixes: ['RPBVII'] },
    { no: 11, label: 'Value of goods & materials sold', section: 'operating', prefixes: ['RPBVIII'] },
    // Books kept in the cost-of-sales layout mark their costs so.
    { no: 12, label: 'Cost of products sold', section: 'operating', prefixes: ['RKBI'] },
    { no: 13, label: 'Selling costs', section: 'operating', prefixes: ['RKD'] },
    { no: 14, label: 'General & administrative costs', section: 'operating', prefixes: ['RKE'] },
    { no: 15, label: 'Other operating income', section: 'operating', income: true, prefixes: ['RPD'] },
    { no: 16, label: 'Other operating costs', section: 'operating', prefixes: ['RPE'] },
    { no: 17, label: 'Depreciation', section: 'operating', prefixes: ['RPBI'] },
    { no: 18, label: 'Financial income', section: 'financial', income: true, prefixes: ['RPG'] },
    { no: 19, label: 'Financial costs', section: 'financial', prefixes: ['RPH'] },
    { no: 20, label: 'Income tax', section: 'tax', prefixes: ['RPJ'] },
    { no: 21, label: 'Other mandatory reductions of profit', section: 'tax', prefixes: ['RPK'] },
  ],
  balance: [
    { no: 101, label: 'BA-A Fixed assets', prefixes: ['BAA'] },
    { no: 102, label: 'BA-B.I Inventories', prefixes: ['BABI'] },
    { no: 103, label: 'BA-B.II Trade receivables', prefixes: ['BABII1a', 'BABII2a', 'BABII3a'] },
    { no: 104, label: 'BA-B.II Other short-term receivables', prefixes: ['BABII'] },
    { no: 105, label: 'BA-B.III Short-term investments & cash', prefixes: ['BABIII'] },
    { no: 106, label: 'BA-B.IV Prepayments & other assets', prefixes: ['BABIV', 'BAC', 'BAD'] },
    { no: 107, label: 'BP-A Equity', prefixes: ['BPA'] },
    { no: 108, label: 'BP-B.I Provisions', prefixes: ['BPBI'] },
    { no: 109, label: 'BP-B.II Long-term liabilities', prefixes: ['BPBII'] },
    { no: 110, label: 'BP-B.III Trade payables', prefixes: ['BPBIII1a', 'BPBIII2a', 'BPBIII3d'] },
    { no: 111, label: 'BP-B.III Other short-term liabilities', prefixes: ['BPBIII'] },
    { no: 112, label: 'BP-B.IV Accruals & deferred income', prefixes: ['BPBIV'] },
  ],
  allocation: ['BPAVI'],
  // INNE: accounts outside the statements (the cost-by-function accounts of
  // class 5, their reconciliation 490…) — kept, in neither statement.
  other: [{ prefixes: ['INNE'], statement: 'Other accounts', line: 'Accounts outside the statements (INNE)', lineNo: 300 }],
});

module.exports = {
  ...chart,
  REVENUE_LINES: [1, 4],
  TOTALS: [
    { key: 'ebitda', label: 'EBITDA', afterLine: 16 },
    { key: 'operatingIncome', label: 'Operating profit', afterLine: 17 },
    { key: 'currentIncome', label: 'Gross profit (before tax)', afterLine: 19 },
    { key: 'netIncome', label: 'Net profit', afterLine: 21 },
  ],
  receivableLines: ['BA-B.II Trade receivables'],
  payableLines: ['BP-B.III Trade payables'],
};
