// DATEV — the bookings export (Buchungsstapel, "EXTF" format) every German
// accounting package and tax adviser reads and writes. Recognised by its
// first line (EXTF or DTVF, data category 21), never by its name: it travels
// as .csv or .txt.
//
// One row is one booking: an amount, debit (S) or credit (H) on Konto, the
// opposite on Gegenkonto. It is written out as two lines in the FEC's own
// shape (fec.js reads them from there), so DATEV books become the same
// `entries` table and get the same Finance package. Three things DATEV leaves
// to the package that reads it are done here:
// - VAT: an amount is gross. On an automatic account (SKR03 8400 "revenue
//   19 % VAT"…) or with a tax key (BU-Schlüssel 2, 3, 8, 9…), the booking is
//   split into net and VAT, on the chart's VAT account.
// - Customers and suppliers: their accounts (one digit longer than the
//   ledger accounts) roll up to the collective account, as 411 and 401 do in
//   a FEC; the customer or supplier number stays as the sub-ledger account.
// - The year: a booking date is day and month; the year comes from the
//   batch's period.
// The export holds no account names (DATEV keeps them in another file), so
// accounts read by their numbers.
const fs = require('fs');
const path = require('path');
const { importEntries } = require('./fec');
const { readFirstLine, utf8CopyPath } = require('../textFile');
const SKR = require('./skr');

const COLUMNS = ['JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompteLib', 'CompAuxNum', 'CompAuxLib',
  'PieceRef', 'PieceDate', 'EcritureLib', 'Debit', 'Credit', 'EcritureLet', 'DateLet', 'ValidDate', 'Montantdevise', 'Idevise'];
const LAYOUT = { delimiter: '\t', columns: Object.fromEntries(COLUMNS.map((c) => [c, c])), amounts: 'debitCredit' };

// Tax keys (BU-Schlüssel) DATEV splits by: rate and side (out = VAT due on
// sales, in = deductible VAT on purchases).
const TAX_KEYS = { 2: { rate: 0.07, kind: 'out' }, 3: { rate: 0.19, kind: 'out' }, 5: { rate: 0.16, kind: 'out' }, 7: { rate: 0.16, kind: 'in' }, 8: { rate: 0.07, kind: 'in' }, 9: { rate: 0.19, kind: 'in' } };
// "40": the automatic split switched off for this booking.
const NO_SPLIT = '40';

// One CSV line: ';'-separated, '"'-quoted, '""' an escaped quote.
function splitCsv(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') quoted = false; else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ';') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out;
}

// The batch's first line, or null when the file is not a DATEV export.
// `category` 21 is bookings; another category (customer master data,
// account names…) is a DATEV file of another kind.
function detectDatev(filePath) {
  let first;
  try { first = readFirstLine(filePath); } catch { return null; /* unreadable: not ours to judge */ }
  const f = splitCsv(first);
  if (!['EXTF', 'DTVF'].includes(f[0])) return null;
  return {
    category: Number(f[2]),
    formatName: f[3],
    adviser: f[10],
    client: f[11],
    fiscalYearStart: f[12],
    accountLength: Number(f[13]) || 4,
    from: f[14],
    to: f[15],
    label: f[16],
    currency: f[21] || 'EUR',
    chart: f[26],
  };
}

const num = (s) => { const x = Number(String(s || '').trim().replace(/\./g, '').replace(',', '.')); return Number.isFinite(x) ? x : 0; };
const cents = (x) => Math.round(x * 100) / 100;

// SKR03 or SKR04: the batch says so (field "SKR"); else its accounts do —
// revenue in 8xxx and expenses in 4xxx are SKR03, revenue in 4xxx and
// expenses in 6xxx SKR04 (classes the other chart leaves empty: 8 and 6).
function chartOf(header, accounts) {
  if (/^0?3$/.test(header.chart || '')) return 'skr03';
  if (/^0?4$/.test(header.chart || '')) return 'skr04';
  const ledger = accounts.filter((a) => a.length === header.accountLength);
  const skr04 = ledger.filter((a) => a[0] === '6').length;
  const skr03 = ledger.filter((a) => a[0] === '8').length;
  return skr04 > skr03 ? 'skr04' : 'skr03';
}

// The date of a booking: DDMM (a leading zero may be dropped) or DDMMYYYY,
// in the batch's period (`from`–`to`, YYYYMMDD).
function bookingDate(raw, header) {
  const digits = String(raw || '').trim();
  if (/^\d{8}$/.test(digits)) return `${digits.slice(4)}-${digits.slice(2, 4)}-${digits.slice(0, 2)}`;
  if (!/^\d{3,4}$/.test(digits)) return '';
  const ddmm = digits.padStart(4, '0');
  const mmdd = `${ddmm.slice(2)}${ddmm.slice(0, 2)}`;
  const from = String(header.from || header.fiscalYearStart || '');
  const to = String(header.to || '');
  // The year of the period's start, unless that puts the date before it.
  let year = Number(from.slice(0, 4)) || Number(to.slice(0, 4)) || new Date().getFullYear();
  if (from.length === 8 && mmdd < from.slice(4) && to.slice(0, 4) > from.slice(0, 4)) year += 1;
  return `${year}-${mmdd.slice(0, 2)}-${mmdd.slice(2)}`;
}

async function importDatev({ dbInstance, filePath, originalName, datev: header, tableName }) {
  if (header.category !== 21) {
    throw new Error(`${originalName} is a DATEV file of another kind (${header.formatName || `category ${header.category}`}): only the bookings export (Buchungsstapel) can be imported`);
  }
  const buf = fs.readFileSync(filePath);
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { text = new TextDecoder('windows-1252').decode(buf); }
  const rows = text.split(/\r?\n/).filter((l) => l.trim());
  const names = splitCsv(rows[1] || '').map((n) => n.trim().toLowerCase());
  // Columns by name: their order and exact spelling vary with the version.
  const at = (test) => names.findIndex(test);
  const col = {
    amount: at((n) => n.startsWith('umsatz')),
    side: at((n) => n.startsWith('soll/haben')),
    currency: at((n) => n === 'wkz umsatz'),
    account: at((n) => n === 'konto'),
    contra: at((n) => n.startsWith('gegenkonto')),
    key: at((n) => n.startsWith('bu-schl')),
    date: at((n) => n === 'belegdatum'),
    document: at((n) => n === 'belegfeld 1'),
    text: at((n) => n === 'buchungstext'),
  };
  if ([col.amount, col.side, col.account, col.contra, col.date].some((i) => i < 0)) {
    throw new Error(`${originalName} does not have the columns of a DATEV bookings export (Umsatz, Soll/Haben-Kennzeichen, Konto, Gegenkonto, Belegdatum)`);
  }
  const bookings = rows.slice(2).map(splitCsv);
  const chartId = chartOf(header, bookings.flatMap((r) => [r[col.account], r[col.contra]].map((a) => String(a || '').trim())));
  const skr = SKR[chartId];
  const ledgerLength = header.accountLength;

  // A customer (first digit 1–6) or supplier (7–9) account → its collective account.
  const ledgerOf = (account) => {
    if (account.length <= ledgerLength) return { account, party: '' };
    return { account: Number(account[0]) <= 6 ? skr.receivable : skr.payable, party: account };
  };
  const automatic = (account) => (account.length === ledgerLength ? skr.automatic.find((a) => Number(account) >= a.from && Number(account) <= a.to) : null);

  const tsv = utf8CopyPath(filePath);
  const lines = [];
  const journal = header.label || 'DATEV bookings';
  const unsplitKeys = new Set();
  bookings.forEach((r, i) => {
    const gross = num(r[col.amount]);
    if (!gross) return;
    const account = String(r[col.account] || '').trim();
    const contra = String(r[col.contra] || '').trim();
    if (!account || !contra) return;
    const key = String(col.key >= 0 ? r[col.key] || '' : '').trim();
    const debitOnAccount = String(r[col.side] || '').trim().toUpperCase() !== 'H';
    // The tax goes with the ledger account the key or automatic account names:
    // the contra account first, as DATEV books it.
    const auto = key === NO_SPLIT ? null : automatic(contra) || automatic(account);
    const tax = TAX_KEYS[key] || (auto && { rate: auto.rate, kind: auto.kind });
    if (key && key !== NO_SPLIT && !TAX_KEYS[key]) unsplitKeys.add(key);
    const taxed = tax ? (automatic(account) && !automatic(contra) ? 'account' : 'contra') : null;
    const vatAccount = tax && skr.vat[tax.kind][tax.rate];
    const net = vatAccount ? cents(gross / (1 + tax.rate)) : gross;
    const date = bookingDate(r[col.date], header);
    const base = { num: String(i + 1), date, doc: r[col.document] || '', text: r[col.text] || '', currency: (col.currency >= 0 && r[col.currency]) || header.currency };
    const post = (rawAccount, amount, debit) => {
      const { account: a, party } = ledgerOf(rawAccount);
      lines.push({ ...base, account: a, party, debit: debit ? amount : 0, credit: debit ? 0 : amount });
    };
    for (const [acc, isAccount] of [[account, true], [contra, false]]) {
      const debit = isAccount ? debitOnAccount : !debitOnAccount;
      if (vatAccount && taxed === (isAccount ? 'account' : 'contra')) {
        post(acc, net, debit);
        post(vatAccount, cents(gross - net), debit);
      } else post(acc, gross, debit);
    }
  });
  if (!lines.length) throw new Error(`${originalName} holds no bookings`);

  const cell = (v) => String(v ?? '').replace(/[\t\r\n]+/g, ' ').trim();
  const out = [COLUMNS.join('\t'), ...lines.map((l) => [
    'DATEV', journal, l.num, l.date, l.account, '', l.party, l.party ? `${Number(l.party[0]) <= 6 ? 'Customer' : 'Supplier'} ${l.party}` : '',
    l.doc, '', l.text, l.debit.toFixed(2), l.credit.toFixed(2), '', '', '', '', l.currency,
  ].map(cell).join('\t'))];
  fs.writeFileSync(tsv, `${out.join('\n')}\n`, 'utf8');

  // The fiscal year is named after the year it ends in.
  const start = String(header.fiscalYearStart || '');
  const fiscalYear = /^\d{8}$/.test(start) ? Number(start.slice(0, 4)) + (start.slice(4, 6) === '01' ? 0 : 1) : null;
  const summary = await importEntries({
    dbInstance, filePath: tsv, layout: LAYOUT, tableName, classify: skr.classifyAccount,
    fiscalYear, sourceFile: path.basename(String(originalName || '')),
  });
  return {
    kind: 'datev',
    chart: chartId,
    country: 'DE',
    currency: header.currency || 'EUR',
    // An adviser's client: the two numbers name the company in DATEV.
    companyId: header.adviser && header.client ? `${header.adviser}-${header.client}` : null,
    companyName: header.client ? `Client ${header.client}` : null,
    unsplitTaxKeys: [...unsplitKeys].slice(0, 20),
    ...summary,
  };
}

module.exports = { detectDatev, importDatev, splitCsv, bookingDate };
