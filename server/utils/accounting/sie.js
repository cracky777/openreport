// SIE 4 — Standard Import Export, the text file every Swedish accounting
// package exports its books in (sie.se). Recognised by its first record,
// #FLAGGA, never by its name (.se, .si, .sie, .txt).
//
// A file holds records, one per line: #KONTO (an account and its name),
// #IB (its opening balance, year 0 the current one), #VER (a voucher) whose
// #TRANS lines follow between braces — a signed amount, debit positive. The
// vouchers are written out in the FEC's own shape (fec.js reads them from
// there), so SIE books become the same `entries` table and get the same
// Finance package, classified on the BAS chart. #RTRANS and #BTRANS (a
// voucher's later corrections) are skipped: the spec repeats every added line
// as a #TRANS, and a removed one is no longer in the books.
const fs = require('fs');
const path = require('path');
const { importEntries } = require('./fec');
const { utf8CopyPath } = require('../textFile');
const bas = require('./bas');

const COLUMNS = ['JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompteLib', 'CompAuxNum', 'CompAuxLib',
  'PieceRef', 'PieceDate', 'EcritureLib', 'Debit', 'Credit', 'EcritureLet', 'DateLet', 'ValidDate', 'Montantdevise', 'Idevise'];
const LAYOUT = { delimiter: '\t', columns: Object.fromEntries(COLUMNS.map((c) => [c, c])), amounts: 'debitCredit' };

// The spec's encoding is PC8, IBM code page 437, which no decoder of the
// platform reads: its upper half, character by character (the last is a
// no-break space).
const CP437_HIGH = `ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■${String.fromCharCode(0xa0)}`;
const decodeCp437 = (buf) => {
  let out = '';
  for (const b of buf) out += b < 0x80 ? String.fromCharCode(b) : CP437_HIGH[b - 0x80];
  return out;
};

// UTF-8 when the bytes are; else PC8 as the spec says — though some packages
// write Windows-1252 under that flag: the reading that gives more Swedish
// letters is the one meant.
function decode(buf) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { /* not UTF-8: one of the 8-bit code pages */ }
  const pc8 = decodeCp437(buf);
  const ansi = new TextDecoder('windows-1252').decode(buf);
  const swedish = (s) => (s.match(/[åäöÅÄÖ]/g) || []).length;
  return swedish(ansi) > swedish(pc8) ? ansi : pc8;
}

// The fields of a record: words, "quoted strings" (\" a quote) and {object
// lists}, which are kept whole.
function fieldsOf(line) {
  const out = [];
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === ' ' || c === '\t') { i++; continue; }
    if (c === '"') {
      let s = '';
      i++;
      while (i < line.length && line[i] !== '"') {
        if (line[i] === '\\' && i + 1 < line.length) i++;
        s += line[i++];
      }
      out.push(s);
      i++;
    } else if (c === '{') {
      const end = line.indexOf('}', i);
      out.push(line.slice(i, end < 0 ? line.length : end + 1));
      i = end < 0 ? line.length : end + 1;
    } else {
      let s = '';
      while (i < line.length && line[i] !== ' ' && line[i] !== '\t') s += line[i++];
      out.push(s);
    }
  }
  return out;
}

// A SIE file, or null: its first record is #FLAGGA.
function detectSie(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const head = Buffer.alloc(256);
    const n = fs.readSync(fd, head, 0, head.length, 0);
    // A byte-order mark or a few stray bytes may come before the first record.
    return /^[^#]{0,4}#FLAGGA\b/.test(head.subarray(0, n).toString('latin1')) ? {} : null;
  } finally {
    fs.closeSync(fd);
  }
}

const isoDate = (d) => (/^\d{8}$/.test(d || '') ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : '');
const amountOf = (s) => { const x = Number(String(s || '').replace(',', '.')); return Number.isFinite(x) ? x : 0; };

async function importSie({ dbInstance, filePath, originalName, tableName }) {
  const records = decode(fs.readFileSync(filePath)).split(/\r?\n/);
  const header = { currency: 'SEK' };
  const accounts = new Map();
  const opening = new Map();
  const lines = [];
  let voucher = null;
  for (const raw of records) {
    const f = fieldsOf(raw.trim());
    switch (f[0]) {
      case '#FNAMN': header.name = f[1]; break;
      case '#ORGNR': header.orgnr = f[1]; break;
      case '#VALUTA': header.currency = f[1] || 'SEK'; break;
      case '#RAR': if (f[1] === '0') { header.start = f[2]; header.end = f[3]; } break;
      case '#KONTO': accounts.set(f[1], f[2] || ''); break;
      case '#IB': if (f[1] === '0') opening.set(f[2], amountOf(f[3])); break;
      case '#VER': voucher = { series: f[1] || '', number: f[2] || '', date: f[3], text: f[4] || '', registered: f[5] }; break;
      case '}': voucher = null; break;
      case '#TRANS': {
        if (!voucher) break;
        const amount = amountOf(f[3]);
        lines.push({
          journal: voucher.series, number: `${voucher.series}${voucher.number}`, date: isoDate(f[4] || voucher.date),
          account: f[1], text: f[5] || voucher.text, debit: amount > 0 ? amount : 0, credit: amount < 0 ? -amount : 0,
          registered: isoDate(voucher.registered),
        });
        break;
      }
      default: break;
    }
  }
  if (!lines.length) throw new Error(`${originalName} holds no vouchers (#VER / #TRANS): export a SIE 4 file, which carries the transactions`);

  // The opening balances (#IB) of the balance-sheet accounts, as one opening
  // entry on the first day of the year — a FEC writes them as its opening journal.
  const openingDate = isoDate(header.start);
  if (openingDate) {
    for (const [account, amount] of opening) {
      if (!amount || bas.classifyAccount(account).statement === 'Income statement') continue;
      lines.push({ journal: 'IB', number: 'IB', date: openingDate, account, text: 'Opening balance', debit: amount > 0 ? amount : 0, credit: amount < 0 ? -amount : 0, registered: '' });
    }
  }

  const cell = (v) => String(v ?? '').replace(/[\t\r\n]+/g, ' ').trim();
  const tsv = utf8CopyPath(filePath);
  fs.writeFileSync(tsv, `${[COLUMNS.join('\t'), ...lines.map((l) => [
    l.journal, l.journal === 'IB' ? 'Opening balances' : `Series ${l.journal}`, l.number, l.date, l.account, accounts.get(l.account) || '', '', '',
    l.journal === 'IB' ? '' : l.number, '', l.text, l.debit.toFixed(2), l.credit.toFixed(2), '', '', l.registered, '', header.currency,
  ].map(cell).join('\t'))].join('\n')}\n`, 'utf8');

  const summary = await importEntries({
    dbInstance, filePath: tsv, layout: LAYOUT, tableName, classify: bas.classifyAccount,
    fiscalYear: Number(String(header.end || '').slice(0, 4)) || null, sourceFile: path.basename(String(originalName || '')),
  });
  return {
    kind: 'sie',
    chart: 'bas',
    country: 'SE',
    currency: header.currency,
    companyId: header.orgnr || null,
    companyName: header.name || null,
    ...summary,
  };
}

module.exports = { detectSie, importSie, fieldsOf, decodeCp437 };
