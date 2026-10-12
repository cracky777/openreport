// A chart of accounts read by account-number prefix — the longest matching
// prefix wins — onto the numbered lines of its own income statement, its
// balance-sheet groups, and the accounts that carry the year's result over
// to equity ("Result allocation"), which stay out of the income statement.
//
// `lines`: { no, label, section, income?, prefixes } — `section` a key of
// `sections`. `balance`: { no (101+), label, prefixes }. `allocation`:
// prefixes. `other`: { prefixes, statement, line, lineNo } — technical
// accounts that belong to neither statement (Germany's carry-forward class
// 9). `classFallback`: { firstDigit: line no } for an income statement
// account no prefix names. `valid`: what a code of the chart looks like —
// digits, unless the chart is a coding like the Dutch RGS.
function prefixChart({ sections, lines, balance, allocation = [], other = [], classFallback = {}, valid = /^\d/ }) {
  const pad = (n) => String(n).padStart(2, '0');
  const lineLabel = (line) => `${pad(line.no)} ${line.label}`;
  const longestFirst = (entries) => entries.sort((a, b) => b.prefix.length - a.prefix.length);
  const incomeLines = longestFirst(lines.flatMap((line) => line.prefixes.map((prefix) => ({ prefix, line }))));
  const balanceGroups = longestFirst(balance.flatMap((group) => group.prefixes.map((prefix) => ({ prefix, group }))));
  const lineByNo = new Map(lines.map((l) => [l.no, l]));

  const unclassified = (cls) => ({ accountClass: cls, statement: 'Unclassified', section: 'Unclassified', line: 'Unclassified', lineNo: 999 });

  function classifyAccount(accountNumber) {
    const num = String(accountNumber || '').trim();
    const cls = num[0] || '';
    if (!valid.test(num)) return unclassified(cls);
    if (allocation.some((p) => num.startsWith(p))) {
      return { accountClass: cls, statement: 'Result allocation', section: 'Result allocation', line: 'Net result & allocations', lineNo: 200 };
    }
    const technical = other.find((o) => o.prefixes.some((p) => num.startsWith(p)));
    if (technical) return { accountClass: cls, statement: technical.statement, section: technical.statement, line: technical.line, lineNo: technical.lineNo };
    const hit = incomeLines.find((e) => num.startsWith(e.prefix));
    // The longest prefix wins across both statements too: Germany keeps its
    // stocks (3970–3989) inside a class of expenses.
    const group = balanceGroups.find((e) => num.startsWith(e.prefix) && (!hit || e.prefix.length > hit.prefix.length));
    if (group) return { accountClass: cls, statement: 'Balance sheet', section: sections.balance, line: group.group.label, lineNo: group.group.no };
    const line = hit ? hit.line : lineByNo.get(classFallback[cls]);
    if (!line) return unclassified(cls);
    return { accountClass: cls, statement: 'Income statement', section: sections[line.section], line: lineLabel(line), lineNo: line.no };
  }

  // What an account can be placed on, for a user who maps it by hand.
  const BALANCE = balance.map((b) => ({ no: b.no, label: b.label }));
  return { classifyAccount, LINES: lines, lineLabel, SECTIONS: sections, BALANCE, OTHER: other };
}

// The prefixes that cover exactly the accounts from `from` to `to` (numbers of
// one width): 1010–1389 → 101…109, 11, 12, 130…138. For a chart defined by
// ranges, like Denmark's.
function rangePrefixes(from, to) {
  const width = String(from).length;
  const out = [];
  let a = from;
  while (a <= to) {
    let size = 1;
    let digits = width;
    while (digits > 1 && a % (size * 10) === 0 && a + size * 10 - 1 <= to) { size *= 10; digits--; }
    out.push(String(a).padStart(width, '0').slice(0, digits));
    a += size;
  }
  return out;
}

module.exports = { prefixChart, rangePrefixes };
