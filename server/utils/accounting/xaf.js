// XAF — XML Auditfile Financieel, the audit file every Dutch accounting
// package exports its books in (Belastingdienst; versions 3.2 and 4.0, only
// 4.0 accepted by the tax administration from 2027). Recognised by its root
// element (auditfile), never by its name (.xaf, .xml).
//
// The general ledger lists each account with its type (B balance, P profit
// and loss) and, in most packages, the RGS code it is tied to: in RGScode
// (4.0), else in leadReference — where Exact Online and Unit4 Multivers put
// it — or a taxonomy conceptRef. Accounts are classified on that code
// (rgs.js); one without a code is a balance-sheet account kept apart, or an
// income statement account left unclassified, for the user to map. The lines
// are written out in the FEC's own shape (fec.js reads them from there), so
// XAF books become the same `entries` table and get the same Finance package.
const fs = require('fs');
const path = require('path');
const { readRecords, readXmlRoot } = require('./xmlStream');
const { importEntries } = require('./fec');
const { utf8CopyPath, discardStream } = require('../textFile');
const rgs = require('./rgs');

const COLUMNS = ['JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompteLib', 'CompAuxNum', 'CompAuxLib',
  'PieceRef', 'PieceDate', 'EcritureLib', 'Debit', 'Credit', 'EcritureLet', 'DateLet', 'ValidDate', 'Montantdevise', 'Idevise'];
const LAYOUT = { delimiter: '\t', columns: Object.fromEntries(COLUMNS.map((c) => [c, c])), amounts: 'debitCredit' };

const RECORDS = {
  'auditfile/header': 'header',
  'auditfile/company': 'company',
  'auditfile/company/customersSuppliers/customerSupplier': 'party',
  'auditfile/company/generalLedger/ledgerAccount': 'account',
  'auditfile/company/openingBalance': 'opening',
  'auditfile/company/openingBalance/obLine': 'obLine',
  'auditfile/company/transactions/journal': 'journal',
  'auditfile/company/transactions/journal/transaction': 'transaction',
  'auditfile/company/transactions/journal/transaction/trLine': 'line',
};

const RGS_CODE = /^[BW][A-Z][a-z]{2}/;
// The RGS code of a ledger account, wherever its package put it.
const rgsOf = (a) => ['RGScode', 'leadReference', 'taxonomy/entryPoint/conceptRef', 'leadCrossRef', 'leadCode']
  .map((k) => a[k]).find((v) => RGS_CODE.test(v || '')) || '';

// An audit file of the Netherlands, or null.
function detectXaf(filePath) {
  let root;
  try { root = readXmlRoot(filePath); } catch { return null; /* unreadable: not ours to judge */ }
  return root && root.name === 'auditfile' ? { namespace: root.namespace } : null;
}

const cell = (v) => String(v ?? '').replace(/[\t\r\n]+/g, ' ').trim();
const num = (s) => { const x = Number(String(s ?? '').trim()); return Number.isFinite(x) ? x : 0; };
// Credit or debit, by the amount's type (D/C); a negative amount turns it over.
const sides = (amnt, tp) => {
  const signed = num(amnt) * (String(tp).toUpperCase() === 'C' ? -1 : 1);
  return { debit: signed > 0 ? signed : 0, credit: signed < 0 ? -signed : 0 };
};

async function importXaf({ dbInstance, filePath, originalName, tableName }) {
  const tsv = utf8CopyPath(filePath);
  const out = fs.createWriteStream(tsv, { encoding: 'utf8' });
  out.write(`${COLUMNS.join('\t')}\n`);
  const header = {};
  let company = {};
  const accounts = new Map();
  const parties = new Map();
  const opening = { date: '', lines: [] };
  let written = 0;
  const write = (row) => { out.write(`${row.map(cell).join('\t')}\n`); written++; };

  try {
    await readRecords(filePath, RECORDS, (kind, v, outer) => {
      if (kind === 'header') Object.assign(header, v);
      else if (kind === 'company') company = v;
      else if (kind === 'party') parties.set(v.custSupID, v.custSupName || '');
      else if (kind === 'account') accounts.set(v.accID, { description: v.accDesc || '', type: (v.accTp || '').toUpperCase(), rgs: rgsOf(v) });
      else if (kind === 'opening') opening.date = v.opBalDate || '';
      else if (kind === 'obLine') opening.lines.push(v);
      else if (kind === 'line') {
        const journal = outer.journal || {};
        const tx = outer.transaction || {};
        // An opening journal repeats the opening balance the file already lists.
        if (opening.lines.length && String(journal.jrnTp).toUpperCase() === 'O') return;
        const { debit, credit } = sides(v.amnt, v.amntTp);
        write([
          journal.jrnID, journal.desc, tx.nr, v.effDate || tx.trDt, v.accID, accounts.get(v.accID)?.description,
          v.custSupID, (v.custSupID && parties.get(v.custSupID)) || '', v.docRef, '', v.desc || tx.desc,
          debit.toFixed(2), credit.toFixed(2), '', '', tx.trDt, v['currency/curAmnt'], v['currency/curCode'] || header.curCode,
        ]);
      }
    });
  } catch (err) {
    discardStream(out);
    throw new Error(`${originalName} could not be read as an XML Auditfile Financieel: ${err.message}`);
  }
  if (!written) {
    discardStream(out);
    throw new Error(`${originalName} holds no transactions: export an XML Auditfile Financieel 3.2 or 4.0 with its journals`);
  }
  const openingDate = opening.date || header.startDate;
  for (const ob of opening.lines) {
    const { debit, credit } = sides(ob.amnt, ob.amntTp);
    write(['OB', 'Opening balance', 'OB', openingDate, ob.accID, accounts.get(ob.accID)?.description, '', '', '', '', 'Opening balance',
      debit.toFixed(2), credit.toFixed(2), '', '', '', '', header.curCode]);
  }
  await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));

  const classify = (accID) => {
    const a = accounts.get(accID) || {};
    if (a.rgs) return rgs.classifyAccount(a.rgs);
    if (a.type === 'B') return { accountClass: 'B', statement: 'Balance sheet', section: 'Balance sheet', line: 'B12 Balance-sheet accounts without RGS code', lineNo: 112 };
    return { accountClass: a.type === 'P' ? 'W' : '', statement: 'Unclassified', section: 'Unclassified', line: 'Unclassified', lineNo: 999 };
  };
  const summary = await importEntries({
    dbInstance, filePath: tsv, layout: LAYOUT, tableName, classify,
    fiscalYear: Number(header.fiscalYear) || Number(String(header.endDate || '').slice(0, 4)) || null,
    sourceFile: path.basename(String(originalName || '')),
  });
  // A company is its VAT or Chamber of Commerce number; the package's own
  // number ("1" in Exact) only with its name.
  const companyId = company.taxRegIdent || company.Commercenr
    || (company.companyIdent && company.companyName ? `${company.companyName}#${company.companyIdent}` : null);
  return {
    kind: 'xaf',
    chart: 'rgs',
    country: 'NL',
    currency: header.curCode || 'EUR',
    companyId,
    companyName: company.companyName || null,
    // How many accounts carried an RGS code: without one, the books need mapping.
    rgsAccounts: [...accounts.values()].filter((a) => a.rgs).length,
    ...summary,
  };
}

module.exports = { detectXaf, importXaf, rgsOf };
