// The charts of accounts the Finance package reads. Each one numbers the lines
// of its own country's income statement, in that statement's order, and says
// what the package needs of it: the lines that make the revenue, its running
// totals (each closes after a line: "EBITDA, after staff costs"), its
// customer and supplier accounts, the name of the profit build-up, where its
// books come from. A FEC reads pcg, a SAF-T its country's chart, a DATEV
// export SKR03 or SKR04, a SIE file BAS, a Dutch XAF the RGS codes of its accounts.
const pcg = require('./pcg');
const ns4102 = require('./ns4102');
const snc = require('./snc');
const ro = require('./ro');
const skr = require('./skr');
const bas = require('./bas');
const pcn = require('./pcn');
const rgs = require('./rgs');
const pcmn = require('./pcmn');
const generic = require('./generic');
const dk = require('./dk');
const pl = require('./pl');
const at = require('./at');

// Outside France the build-up has no French name.
const PROFIT_BUILD_UP = { bridgePage: 'Profit build-up', bridgeTitle: 'From revenue to net income' };

const CHARTS = {
  pcg: {
    ...pcg,
    REVENUE_LINES: [1, 3],
    // The soldes intermédiaires de gestion. A gross margin needs goods: lines 1–2.
    TOTALS: pcg.SIG_TOTALS.map((t) => ({
      ...t,
      ...(t.key === 'grossMargin' ? { needsLines: [1, 2] } : {}),
      ...(t.key === 'currentIncome' ? { card: 'Current income before tax' } : {}),
    })),
    receivablePrefix: '411',
    payablePrefix: '401',
    bridgePage: 'Management balances',
    bridgeTitle: 'Management balances (SIG)',
    origin: 'Built from a French FEC: income statement lines follow the Plan Comptable Général.',
  },
  ns4102: {
    ...ns4102,
    ...PROFIT_BUILD_UP,
    receivablePrefix: '15',
    payablePrefix: '24',
    origin: 'Built from a Norwegian SAF-T Financial file: income statement lines follow the standard accounts (NS 4102).',
  },
  snc: {
    ...snc,
    ...PROFIT_BUILD_UP,
    receivablePrefix: '21',
    payablePrefix: '22',
    origin: 'Built from a Portuguese SAF-T: income statement lines follow the SNC chart of accounts.',
  },
  ro: {
    ...ro,
    ...PROFIT_BUILD_UP,
    receivablePrefix: '411',
    payablePrefix: '401',
    origin: 'Built from a Romanian SAF-T (D406): income statement lines follow the Romanian chart of accounts.',
  },
  pcn: {
    ...pcn,
    ...PROFIT_BUILD_UP,
    receivablePrefix: '40',
    payablePrefix: '44',
    origin: 'Built from a Luxembourg FAIA file: income statement lines follow the standard chart of accounts (PCN 2020).',
  },
  rgs: {
    ...rgs,
    ...PROFIT_BUILD_UP,
    origin: 'Built from a Dutch XML Auditfile Financieel: income statement lines follow the reference chart of accounts (RGS).',
  },
  bas: {
    ...bas,
    ...PROFIT_BUILD_UP,
    receivablePrefix: '151',
    payablePrefix: '244',
    origin: 'Built from a Swedish SIE file: income statement lines follow the BAS chart of accounts.',
  },
  pcmn: {
    ...pcmn,
    ...PROFIT_BUILD_UP,
    receivablePrefix: '400',
    payablePrefix: '440',
    origin: 'Built from a general ledger: income statement lines follow the Belgian minimum standard chart of accounts (PCMN).',
  },
  dk: {
    ...dk,
    ...PROFIT_BUILD_UP,
    origin: 'Built from a Danish SAF-T Financial file: income statement lines follow the common public standard chart of accounts.',
  },
  pl: {
    ...pl,
    ...PROFIT_BUILD_UP,
    origin: 'Built from a Polish JPK_KR_PD file: income statement lines follow the account markers of the Ministry of Finance.',
  },
  at: {
    ...at,
    ...PROFIT_BUILD_UP,
    origin: 'Built from an Austrian SAF-T file: income statement lines follow the standard chart of accounts (EKR).',
  },
  generic: {
    ...generic,
    ...PROFIT_BUILD_UP,
    origin: 'Built from a general ledger whose accounts were mapped to the lines of an income statement by nature.',
  },
  ...Object.fromEntries(['skr03', 'skr04'].map((id) => [id, {
    ...skr[id],
    ...PROFIT_BUILD_UP,
    receivablePrefix: skr[id].receivable,
    payablePrefix: skr[id].payable,
    origin: `Built from a DATEV bookings export: income statement lines follow the ${id.toUpperCase()} chart of accounts (§ 275 HGB).`,
  }])),
};

// The charts a general ledger exported to CSV or Excel can be read with, as
// the import offers them (the Dutch RGS is a coding, not account numbers).
const LEDGER_CHARTS = [
  ['pcg', 'France — Plan Comptable Général'], ['pcmn', 'Belgium — PCMN'], ['pcn', 'Luxembourg — PCN'],
  ['skr03', 'Germany — SKR03'], ['skr04', 'Germany — SKR04'], ['bas', 'Sweden — BAS'], ['ns4102', 'Norway — NS 4102'], ['dk', 'Denmark — standard chart'], ['at', 'Austria — EKR'],
  ['snc', 'Portugal — SNC'], ['ro', 'Romania'], ['generic', 'Another chart — map the accounts yourself'],
];

// Every chart by name, as the account mapping shows it.
const CHART_NAMES = {
  ...Object.fromEntries(LEDGER_CHARTS),
  rgs: 'Netherlands — RGS reference codes',
  pl: 'Poland — JPK_KR_PD account markers',
  generic: 'Income statement by nature (accounts mapped by hand)',
};

// Books imported before charts were recorded are French FEC.
const chartOf = (accounting) => CHARTS[accounting?.chart] || CHARTS.pcg;

// The income statement lines of a chart that are expenses.
const expenseLines = (chart) => chart.LINES.filter((l) => !l.income).map((l) => l.no);

module.exports = { CHARTS, LEDGER_CHARTS, CHART_NAMES, chartOf, expenseLines };
