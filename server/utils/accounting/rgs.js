// The Dutch reference chart of accounts (RGS, Referentie GrootboekSchema,
// version 3.8) → the lines of a Dutch profit and loss account by nature
// (winst-en-verliesrekening, categorale indeling, BW2 art. 377), in its order
// and in English. The Netherlands imposes no chart: each company numbers its
// own accounts, and its package ties each one to an RGS code ("WOmzNop",
// "BVorDeb"…), which the audit file carries (xaf.js). The codes are read by
// prefix, case-sensitive: W the profit and loss, B the balance sheet.
//
// Depreciation comes after the other operating expenses (the law lists it
// before them) so that EBITDA closes after a line, as every running total of
// the package does. Financial items are split by the side RGS gives each code
// (interest income credit, the rest debit). WNer, the net result, closes the
// year into equity: it stands apart from the statement.
const { prefixChart } = require('./prefixChart');

const chart = prefixChart({
  valid: /^[BW][A-Z][a-z]{2}/,
  sections: { operating: '1 Operating', financial: '2 Financial', tax: '3 Taxes & participations', balance: 'Balance sheet' },
  lines: [
    { no: 1, label: 'Net turnover', section: 'operating', income: true, prefixes: ['WOmz'] },
    { no: 2, label: 'Change in inventories', section: 'operating', income: true, prefixes: ['WWiv'] },
    { no: 3, label: 'Own work capitalised', section: 'operating', income: true, prefixes: ['WWivGpv'] },
    // The net results of housing and property activities count as other operating income.
    { no: 4, label: 'Other operating income', section: 'operating', income: true, prefixes: ['WOvb', 'WRev', 'WRvi', 'WRgr', 'WNoa'] },
    { no: 5, label: 'Raw materials, consumables & goods', section: 'operating', prefixes: ['WKpr'] },
    { no: 6, label: 'Subcontracted work & other external costs', section: 'operating', prefixes: ['WKprKuw'] },
    { no: 7, label: 'Staff costs', section: 'operating', prefixes: ['WPer'] },
    { no: 8, label: 'Other operating expenses', section: 'operating', prefixes: ['WBed', 'WOok', 'WKol', 'WVkf', 'WAkf', 'WMfo'] },
    { no: 9, label: 'Depreciation', section: 'operating', prefixes: ['WAfs'] },
    { no: 10, label: 'Impairments & changes in value', section: 'operating', prefixes: ['WWvi', 'WBwv', 'WWvv'] },
    { no: 11, label: 'Financial income', section: 'financial', income: true, prefixes: ['WFbeRlm', 'WFbeOnn', 'WFbeWnn', 'WFbePol', 'WFbePhp', 'WFbeDfb', 'WOvt', 'WVhe'] },
    { no: 12, label: 'Financial expenses', section: 'financial', prefixes: ['WFbe', 'WWfa'] },
    { no: 13, label: 'Taxes on the result', section: 'tax', prefixes: ['WBel'] },
    { no: 14, label: 'Share in results of participations & third parties', section: 'tax', income: true, prefixes: ['WRed', 'WAad', 'WLbe'] },
  ],
  balance: [
    { no: 101, label: 'B01 Intangible & tangible fixed assets', prefixes: ['BIva', 'BMva', 'BVas'] },
    { no: 102, label: 'B02 Financial fixed assets', prefixes: ['BFva'] },
    { no: 103, label: 'B03 Inventories & work in progress', prefixes: ['BVrd', 'BPro'] },
    { no: 104, label: 'B04 Trade receivables', prefixes: ['BVorDeb'] },
    { no: 105, label: 'B05 Other receivables', prefixes: ['BVor'] },
    { no: 106, label: 'B06 Securities & cash', prefixes: ['BEff', 'BLim'] },
    { no: 107, label: 'B07 Equity', prefixes: ['BEiv', 'BEga'] },
    { no: 108, label: 'B08 Provisions', prefixes: ['BVrz'] },
    { no: 109, label: 'B09 Long-term liabilities', prefixes: ['BLas'] },
    { no: 110, label: 'B10 Trade payables', prefixes: ['BSchCre'] },
    { no: 111, label: 'B11 Other current liabilities', prefixes: ['BSch'] },
  ],
  allocation: ['WNer'],
  classFallback: { W: 8 },
});

module.exports = {
  ...chart,
  REVENUE_LINES: [1],
  TOTALS: [
    { key: 'grossMargin', label: 'Gross margin', afterLine: 6, needsLines: [5, 6] },
    { key: 'ebitda', label: 'EBITDA', afterLine: 8 },
    { key: 'operatingIncome', label: 'Operating result', afterLine: 10 },
    { key: 'currentIncome', label: 'Result before taxes', afterLine: 12 },
    { key: 'netIncome', label: 'Net result after taxes', afterLine: 14 },
  ],
  // Accounts are the company's own: customers and suppliers are told by the
  // RGS group their accounts are tied to.
  receivableLines: ['B04 Trade receivables'],
  payableLines: ['B10 Trade payables'],
};
