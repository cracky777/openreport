// SAF-T Financial — the OECD Standard Audit File for Tax: the general ledger
// as XML, which Norway (since 2020), Portugal, Poland, Lithuania, Romania,
// Luxembourg or Austria ask of companies. Recognised by its root element
// (AuditFile), never by its name.
//
// The entries are written out in the FEC's own shape (fec.js reads them from
// there), so a SAF-T becomes the same `entries` table a FEC does and the same
// Finance package reads it: one table, one pack, one merge of fiscal years.
// Accounts are classified on the chart the file's country prescribes; in a
// country without one here, every account waits to be placed by hand.
const fs = require('fs');
const path = require('path');
const { readRecords, readXmlRoot } = require('./xmlStream');
const { importEntries } = require('./fec');
const { utf8CopyPath, discardStream } = require('../textFile');
const ns4102 = require('./ns4102');
const snc = require('./snc');
const ro = require('./ro');
const pcn = require('./pcn');
const dk = require('./dk');
const at = require('./at');
const generic = require('./generic');

const COLUMNS = ['JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompteLib', 'CompAuxNum', 'CompAuxLib',
  'PieceRef', 'PieceDate', 'EcritureLib', 'Debit', 'Credit', 'EcritureLet', 'DateLet', 'ValidDate', 'Montantdevise', 'Idevise'];
const LAYOUT = { delimiter: '\t', columns: Object.fromEntries(COLUMNS.map((c) => [c, c])), amounts: 'debitCredit' };

// The charts read here, by country (Luxembourg's FAIA is a SAF-T too). Norway's audit file names the standard
// account (NS 4102) of every account in StandardAccountID; Romania's may name
// the chart's account the same way; Portugal numbers its accounts on the SNC.
const CHARTS_BY_COUNTRY = {
  NO: { chart: 'ns4102', classify: (account) => ns4102.classifyAccount(account.standard || account.id) },
  PT: { chart: 'snc', classify: (account) => snc.classifyAccount(account.id) },
  RO: { chart: 'ro', classify: (account) => ro.classifyAccount(account.standard || account.id) },
  // Luxembourg's FAIA: StandardAccountID holds the PCN account when AccountID differs.
  LU: { chart: 'pcn', classify: (account) => pcn.classifyAccount(account.standard || account.id) },
  // Denmark: StandardAccountID is the account of the common public standard chart.
  DK: { chart: 'dk', classify: (account) => dk.classifyAccount(account.standard || account.id) },
  // Austria (SAF-T AT 1.01, on request): each account names its EKR account.
  AT: { chart: 'at', classify: (account) => at.classifyAccount(account.standard || account.id) },
};
// Portugal lists its grouping accounts (GR, GA) and management-accounting
// ones (AR, AA, AM) beside the accounts entries go to (GM): their balances
// add up their sub-accounts', never to be counted again.
const SUMMING_ACCOUNTS = new Set(['GR', 'GA', 'AR', 'AA', 'AM']);

// An audit file, or null. A Cash Register file shares the root element but
// holds no ledger: refused by name rather than read empty.
function detectSaft(filePath) {
  let root;
  try { root = readXmlRoot(filePath); } catch { return null; /* unreadable: not ours to judge */ }
  if (!root || root.name !== 'AuditFile') return null;
  return { namespace: root.namespace, cashRegister: /CashRegister/i.test(root.namespace) };
}

// Norway names a party inline, the OECD 2.0 schema (Romania) under
// CompanyStructure, Portugal as CompanyName.
const partyName = (v) => v.Name || v['CompanyStructure/Name'] || v.CompanyName || '';
const cell = (v) => String(v ?? '').replace(/[\t\r\n]+/g, ' ').trim();
const amount = (n) => { const x = Number(String(n ?? '').trim()); return Number.isFinite(x) ? x : 0; };

// Records the reader keeps whole: the path of their element, and where they go.
const RECORDS = {
  'AuditFile/Header': 'header',
  'AuditFile/MasterFiles/GeneralLedgerAccounts/Account': 'account',
  'AuditFile/MasterFiles/Customers/Customer': 'customer',
  'AuditFile/MasterFiles/Suppliers/Supplier': 'supplier',
  // Portugal lists them straight under MasterFiles.
  'AuditFile/MasterFiles/Customer': 'customer',
  'AuditFile/MasterFiles/Supplier': 'supplier',
  'AuditFile/GeneralLedgerEntries/Journal': 'journal',
  'AuditFile/GeneralLedgerEntries/Journal/Transaction': 'transaction',
  'AuditFile/GeneralLedgerEntries/Journal/Transaction/Line': 'line',
  // Bulgaria names them TransactionLine.
  'AuditFile/GeneralLedgerEntries/Journal/Transaction/TransactionLine': 'line',
  // Portugal's variant splits the lines by side.
  'AuditFile/GeneralLedgerEntries/Journal/Transaction/Lines/DebitLine': 'line',
  'AuditFile/GeneralLedgerEntries/Journal/Transaction/Lines/CreditLine': 'line',
};

// Read the audit file at `filePath`, writing its lines to `out` (a FEC-shaped
// TSV). Returns its header, accounts and how many lines were written.
async function readAuditFile(filePath, out) {
  const header = {};
  const accounts = new Map();
  const customers = new Map();
  const suppliers = new Map();
  let lines = 0;

  const writeLine = (l, journal = {}, transaction = {}) => {
    // OECD nests the figure in DebitAmount/Amount; Portugal writes it bare.
    const side = (k) => l[`${k}/Amount`] ?? l[k];
    const customer = l.CustomerID || transaction.CustomerID;
    const supplier = l.SupplierID || transaction.SupplierID;
    out.write(`${[
      journal.JournalID, journal.Description, transaction.TransactionID, transaction.TransactionDate,
      l.AccountID, accounts.get(l.AccountID)?.description, customer || supplier,
      (customer && customers.get(customer)) || (supplier && suppliers.get(supplier)) || '',
      l.SourceDocumentID || transaction.SourceDocumentID, l.ValueDate, l.Description || transaction.Description,
      side('DebitAmount') ?? '0', side('CreditAmount') ?? '0', '', '', transaction.GLPostingDate,
      l['DebitAmount/CurrencyAmount'] ?? l['CreditAmount/CurrencyAmount'], l['DebitAmount/CurrencyCode'] ?? l['CreditAmount/CurrencyCode'],
    ].map(cell).join('\t')}\n`);
    lines++;
  };

  await readRecords(filePath, RECORDS, (kind, v, outer) => {
    if (kind === 'header') Object.assign(header, v);
    else if (kind === 'account') {
      accounts.set(v.AccountID, {
        id: v.AccountID,
        description: v.AccountDescription || '',
        standard: v.StandardAccountID || v.AccountID_oeEKR || '',
        opening: SUMMING_ACCOUNTS.has(v.GroupingCategory) ? 0 : amount(v.OpeningDebitBalance) - amount(v.OpeningCreditBalance),
      });
    } else if (kind === 'customer') customers.set(v.CustomerID, partyName(v));
    else if (kind === 'supplier') suppliers.set(v.SupplierID, partyName(v));
    else if (kind === 'line') writeLine(v, outer.journal, outer.transaction);
  });
  return { header, accounts, lines };
}

const isoDate = (y, m) => (y && m ? `${y}-${String(m).padStart(2, '0')}-01` : null);

// Import an audit file into `tableName`. Returns what the import learnt about
// the books, as importEntries does, with the country, company and chart.
async function importSaft({ dbInstance, filePath, originalName, saft, tableName }) {
  if (saft.cashRegister) throw new Error(`${originalName} is a SAF-T Cash Register file: only SAF-T Financial files (the general ledger) can be imported`);
  // Written next to the upload under the name its UTF-8 copy takes: the
  // process that received the upload deletes both (DuckDB may still hold it).
  const tsv = utf8CopyPath(filePath);
  const out = fs.createWriteStream(tsv, { encoding: 'utf8' });
  out.write(`${COLUMNS.join('\t')}\n`);
  let read;
  try {
    read = await readAuditFile(filePath, out);
  } catch (err) {
    discardStream(out);
    throw new Error(`${originalName} could not be read as a SAF-T file: ${err.message}`);
  }
  const { header, accounts, lines } = read;
  if (!lines) {
    discardStream(out);
    // Portugal's invoicing SAF-T (TaxAccountingBasis F) is the common one.
    throw new Error(header.TaxAccountingBasis === 'F'
      ? `${originalName} is an invoicing SAF-T: export the accounting SAF-T (contabilidade) to read the books`
      : `${originalName} holds no general ledger entries (SAF-T GeneralLedgerEntries)`);
  }

  const country = (header.AuditFileCountry
    || (/:NO$/i.test(saft.namespace) ? 'NO' : /:DK$/i.test(saft.namespace) ? 'DK' : /PT_/i.test(saft.namespace) ? 'PT' : /AT_1/i.test(saft.namespace) ? 'AT' : /d406/i.test(saft.namespace) ? 'RO' : '')).toUpperCase();
  // A country whose chart is not read here (Bulgaria, Lithuania, Hungary…):
  // an income statement by nature, every account to be placed by hand.
  const profile = CHARTS_BY_COUNTRY[country] || { chart: 'generic', classify: (account) => generic.classifyAccount(account.id) };
  const classify = (id) => profile.classify(accounts.get(id) || { id });

  // A SAF-T carries opening balances on its accounts, not as entries (a FEC
  // writes them as an opening journal): written as one opening entry on the
  // first day, the balance sheet adds up. Income statement accounts open at
  // nothing in a year read from its start, and a later start is not this
  // file's period to show.
  const sel = (k) => header[`SelectionCriteria/${k}`];
  const openingDate = sel('SelectionStartDate') || isoDate(sel('PeriodStartYear'), sel('PeriodStart')) || header.StartDate;
  if (openingDate) {
    for (const a of accounts.values()) {
      if (!a.opening || classify(a.id).statement === 'Income statement') continue;
      out.write(`${['OB', 'Opening balances', 'OB', openingDate, a.id, a.description, '', '', '', '', 'Opening balance',
        a.opening > 0 ? a.opening : 0, a.opening < 0 ? -a.opening : 0, '', '', '', '', ''].map(cell).join('\t')}\n`);
    }
  }
  await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));

  const year = Number(sel('PeriodEndYear') || header.FiscalYear || String(sel('SelectionEndDate') || header.EndDate || '').slice(0, 4)) || null;
  const summary = await importEntries({
    dbInstance, filePath: tsv, layout: LAYOUT, tableName, classify,
    fiscalYear: year, sourceFile: path.basename(String(originalName || '')),
  });
  return {
    kind: 'saft',
    chart: profile.chart,
    country: country || null,
    currency: header.DefaultCurrencyCode || header.CurrencyCode || null,
    companyId: header['Company/RegistrationNumber'] || header.TaxRegistrationNumber || null,
    companyName: header['Company/Name'] || header.CompanyName || null,
    ...summary,
  };
}

module.exports = { detectSaft, importSaft, readAuditFile };
