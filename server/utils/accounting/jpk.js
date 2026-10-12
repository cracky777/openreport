// JPK_KR_PD — the Polish Standard Audit File of the books (Jednolity Plik
// Kontrolny, księgi rachunkowe), filed every year with the income tax return
// from 2025 on and written by every Polish accounting package. Recognised by
// its root element (JPK) and the Ministry of Finance's namespace.
//
// Its trial balance (ZOiS) lists every account with its opening balance and
// the marker (S_12_1) that places it in the financial statements; its journal
// (Dziennik) holds the entries, each with its posting lines (KontoZapis:
// account, debit or credit). The lines are written out in the FEC's own shape
// (fec.js reads them from there), so Polish books become the same `entries`
// table, classified by marker (pl.js), with the same Finance package. The
// older JPK_KR (1), sent only on request, has no markers: refused, with what
// to export instead.
const fs = require('fs');
const path = require('path');
const { readRecords, readXmlRoot } = require('./xmlStream');
const { importEntries } = require('./fec');
const { utf8CopyPath } = require('../textFile');
const pl = require('./pl');

const COLUMNS = ['JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompteLib', 'CompAuxNum', 'CompAuxLib',
  'PieceRef', 'PieceDate', 'EcritureLib', 'Debit', 'Credit', 'EcritureLet', 'DateLet', 'ValidDate', 'Montantdevise', 'Idevise'];
const LAYOUT = { delimiter: '\t', columns: Object.fromEntries(COLUMNS.map((c) => [c, c])), amounts: 'debitCredit' };

const RECORDS = {
  'JPK/Naglowek': 'header',
  'JPK/Podmiot1': 'entity',
  'JPK/Kontrahent': 'party',
  'JPK/Dziennik': 'entry',
  'JPK/Dziennik/KontoZapis': 'line',
};
// The trial balance comes in one of eight shapes, by kind of entity (ZOiS7:
// ordinary companies); each lists its accounts alike.
for (let i = 1; i <= 8; i++) RECORDS[`JPK/ZOiS/ZOiS${i}`] = 'account';

function detectJpk(filePath) {
  let root;
  try { root = readXmlRoot(filePath); } catch { return null; /* unreadable: not ours to judge */ }
  if (!root || root.name !== 'JPK' || !/jpk\.mf\.gov\.pl/i.test(root.namespace)) return null;
  // JPK_KR (1), of 2016: no account markers.
  return { legacy: /\/2016\//.test(root.namespace) };
}

const cell = (v) => String(v ?? '').replace(/[\t\r\n]+/g, ' ').trim();
const num = (s) => { const x = Number(String(s ?? '').trim()); return Number.isFinite(x) ? x : 0; };

async function importJpk({ dbInstance, filePath, originalName, jpk, tableName }) {
  if (jpk.legacy) throw new Error(`${originalName} is a JPK_KR (1) file, which marks no account: export the JPK_KR_PD file, which places every account in the statements`);
  const tsv = utf8CopyPath(filePath);
  const out = fs.createWriteStream(tsv, { encoding: 'utf8' });
  out.write(`${COLUMNS.join('\t')}\n`);
  const header = {};
  let entity = {};
  const accounts = new Map();
  const parties = new Map();
  let written = 0;
  const write = (row) => { out.write(`${row.map(cell).join('\t')}\n`); written++; };

  try {
    await readRecords(filePath, RECORDS, (kind, v, outer) => {
      if (kind === 'header') Object.assign(header, v);
      else if (kind === 'entity') entity = v;
      else if (kind === 'party') parties.set(v.T_1, v.T_3 || '');
      else if (kind === 'account') {
        accounts.set(v.S_1, { name: v.S_2 || '', parent: v.S_3 || '', marker: v.S_12_1 || '', opening: num(v.S_4) - num(v.S_5) });
      } else if (kind === 'line') {
        const e = outer.entry || {};
        const party = e.D_3 || '';
        const taxId = party && parties.get(party);
        write([
          e.D_2, e.D_2, e.D_1, e.D_8 || e.D_6, v.Z_3, accounts.get(v.Z_3)?.name, party, party ? (taxId ? `${party} (${taxId})` : party) : '',
          e.D_4, e.D_7, v.Z_2 || e.D_10, num(v.Z_4).toFixed(2), num(v.Z_7).toFixed(2), '', '', e.D_8,
          v.Z_5 || v.Z_8, v.Z_6 || v.Z_9,
        ]);
      }
    });
  } catch (err) {
    out.destroy();
    throw new Error(`${originalName} could not be read as a JPK_KR_PD file: ${err.message}`);
  }
  if (!written) {
    out.destroy();
    throw new Error(`${originalName} holds no journal entries (Dziennik)`);
  }
  // Opening balances: the trial balance lists parent accounts with their
  // sub-accounts' totals; only accounts that are no one's parent count.
  const parents = new Set([...accounts.values()].map((a) => a.parent).filter(Boolean));
  const openingDate = header.DataOd || header.RokDataOd;
  for (const [id, a] of accounts) {
    if (!a.opening || parents.has(id) || !openingDate) continue;
    const isIncome = pl.classifyAccount(a.marker).statement === 'Income statement';
    if (isIncome) continue;
    write(['BO', 'Opening balance', 'BO', openingDate, id, a.name, '', '', '', '', 'Opening balance',
      (a.opening > 0 ? a.opening : 0).toFixed(2), (a.opening < 0 ? -a.opening : 0).toFixed(2), '', '', '', '', '']);
  }
  await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));

  const summary = await importEntries({
    dbInstance, filePath: tsv, layout: LAYOUT, tableName,
    classify: (id) => pl.classifyAccount(accounts.get(id)?.marker || ''),
    fiscalYear: Number(String(header.RokDataDo || header.DataDo || '').slice(0, 4)) || null,
    sourceFile: path.basename(String(originalName || '')),
  });
  return {
    kind: 'jpk',
    chart: 'pl',
    country: 'PL',
    currency: header.DomyslnyKodWaluty || 'PLN',
    companyId: entity['IdentyfikatorPodmiotu/NIP'] || null,
    companyName: entity['IdentyfikatorPodmiotu/PelnaNazwa'] || null,
    ...summary,
  };
}

module.exports = { detectJpk, importJpk };
