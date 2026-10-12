// Plan Comptable Général → income statement lines, by account-number prefix.
//
// Every French chart of accounts starts with the same normalised prefixes, so
// one table classifies any company's FEC: the longest matching prefix wins
// (607 "purchases of goods" before 60 "purchases"). The lines follow the order
// of the soldes intermédiaires de gestion (SIG), so a running total over them
// reads gross margin, value added, EBITDA… at the line that closes each one.
//
// Line labels carry their number: reports sort a dimension by its value, and
// "03 Production sold" is what puts it between lines 02 and 04. `no` is the
// same number as an integer, which the measures filter on (EBITDA = lines 1 to
// 9). Balance-sheet accounts get one line per class ("Class 4 …", which sorts
// after the numbered lines), numbered from 101 so a rule "line ≤ 18" never
// catches them.
//
// The 2025 PCG reform (ANC 2022-06) narrowed the exceptional result: what
// moved out of 67/77 now lands in 65/75, which the prefixes below already read
// as operating. Files from before and after the reform classify alike.

const SECTIONS = {
  operating: '1 Operating',
  financial: '2 Financial',
  exceptional: '3 Exceptional',
  tax: '4 Profit-sharing & income tax',
  balance: 'Balance sheet',
};

// `income`: a line of income; every other one is an expense.
const LINES = [
  { no: 1, label: 'Sales of goods', section: 'operating', income: true, prefixes: ['707', '7097'] },
  { no: 2, label: 'Cost of goods sold', section: 'operating', prefixes: ['607', '6037', '6087', '6097'] },
  { no: 3, label: 'Production sold', section: 'operating', income: true, prefixes: ['70'] },
  { no: 4, label: 'Stored & capitalised production', section: 'operating', income: true, prefixes: ['71', '72', '73'] },
  { no: 5, label: 'Raw materials & supplies', section: 'operating', prefixes: ['601', '602', '6031', '6032', '6081', '6082', '6091', '6092'] },
  { no: 6, label: 'Other purchases & external charges', section: 'operating', prefixes: ['60', '61', '62'] },
  { no: 7, label: 'Operating subsidies', section: 'operating', income: true, prefixes: ['74'] },
  { no: 8, label: 'Taxes & duties', section: 'operating', prefixes: ['63'] },
  { no: 9, label: 'Staff costs', section: 'operating', prefixes: ['64'] },
  { no: 10, label: 'Other operating income & reversals', section: 'operating', income: true, prefixes: ['75', '78', '79'] },
  { no: 11, label: 'Depreciation & provisions', section: 'operating', prefixes: ['68'] },
  { no: 12, label: 'Other operating expenses', section: 'operating', prefixes: ['65'] },
  { no: 13, label: 'Financial income', section: 'financial', income: true, prefixes: ['76', '786', '796'] },
  { no: 14, label: 'Financial expenses', section: 'financial', prefixes: ['66', '686'] },
  { no: 15, label: 'Exceptional income', section: 'exceptional', income: true, prefixes: ['77', '787', '797'] },
  { no: 16, label: 'Exceptional expenses', section: 'exceptional', prefixes: ['67', '687'] },
  { no: 17, label: 'Employee profit-sharing', section: 'tax', prefixes: ['691'] },
  { no: 18, label: 'Income tax', section: 'tax', prefixes: ['69'] },
];

// Accounts of classes 6 and 7 that no prefix above names (a 6xx or 7xx a
// company created outside the norm) still belong to the result: they fall on
// the generic operating line of their side rather than out of the statement.
const CLASS_FALLBACK = { 6: 12, 7: 10 };

const BALANCE_CLASSES = {
  1: 'Equity & long-term debt',
  2: 'Fixed assets',
  3: 'Inventories',
  4: 'Third-party accounts',
  5: 'Cash & investments',
};

// The running totals a reader expects in a French income statement, each
// closing after the line named. Shared by the measures and the waterfall.
const SIG_TOTALS = [
  { key: 'grossMargin', label: 'Gross margin', afterLine: 2 },
  { key: 'valueAdded', label: 'Value added', afterLine: 6 },
  { key: 'ebitda', label: 'EBITDA', afterLine: 9 },
  { key: 'operatingIncome', label: 'Operating income', afterLine: 12 },
  { key: 'currentIncome', label: 'Income before tax & exceptional items', afterLine: 14 },
  { key: 'netIncome', label: 'Net income', afterLine: 18 },
];

const pad = (n) => String(n).padStart(2, '0');
const lineLabel = (line) => `${pad(line.no)} ${line.label}`;

const byPrefix = [];
for (const line of LINES) for (const p of line.prefixes) byPrefix.push({ prefix: p, line });
byPrefix.sort((a, b) => b.prefix.length - a.prefix.length);
const lineByNo = new Map(LINES.map((l) => [l.no, l]));

const UNCLASSIFIED = { statement: 'Unclassified', section: 'Unclassified', line: 'Unclassified', lineNo: 999 };

// Account number → where it sits in the statements. Anything that is not a
// PCG account number (letters, a class 8 or 9) is reported as unclassified
// instead of guessed.
function classifyAccount(accountNumber) {
  const num = String(accountNumber || '').trim();
  const cls = Number(num[0]);
  if (!/^[1-7]/.test(num)) return { accountClass: num[0] || '', ...UNCLASSIFIED };
  if (cls <= 5) {
    return { accountClass: String(cls), statement: 'Balance sheet', section: SECTIONS.balance, line: `Class ${cls} ${BALANCE_CLASSES[cls]}`, lineNo: 100 + cls };
  }
  const hit = byPrefix.find((e) => num.startsWith(e.prefix));
  const line = hit ? hit.line : lineByNo.get(CLASS_FALLBACK[cls]);
  return { accountClass: String(cls), statement: 'Income statement', section: SECTIONS[line.section], line: lineLabel(line), lineNo: line.no };
}

// What an account can be placed on, for a user who maps it by hand.
const BALANCE = Object.entries(BALANCE_CLASSES).map(([cls, label]) => ({ no: 100 + Number(cls), label: `Class ${cls} ${label}` }));

module.exports = { classifyAccount, LINES, SIG_TOTALS, lineLabel, SECTIONS, BALANCE, OTHER: [] };
