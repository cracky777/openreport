import { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import { LEDGER_CHARTS } from '../../utils/accountingPack';

// A general ledger exported to CSV or Excel, read as books: which chart its
// accounts follow, and which column is what. The server reads the file with
// these settings (server/utils/accounting/ledger.js) and keeps them for the
// next refresh.

const AMOUNT_MODES = [['debitCredit', 'Debit and credit columns'], ['signed', 'One amount, debit positive'], ['side', 'An amount and a debit/credit column']];
const CURRENCIES = ['EUR', 'GBP', 'CHF', 'USD', 'SEK', 'NOK', 'DKK', 'PLN', 'RON', 'CZK', 'HUF'];
const FIELDS = [
  ['date', 'Date', true], ['account', 'Account number', true], ['accountName', 'Account name'],
  ['debit', 'Debit', 'debitCredit'], ['credit', 'Credit', 'debitCredit'], ['amount', 'Amount', 'amount'], ['side', 'Debit / credit', 'side'],
  ['journal', 'Journal'], ['entry', 'Entry number'], ['label', 'Description'], ['partyName', 'Customer / supplier'], ['document', 'Document reference'],
];
// A field's third value says when it applies: always and required (true),
// with that way of writing amounts ('debitCredit', 'side'), with a single
// amount column ('amount'), or always and optional (none).
const applies = (when, amounts) => !when || when === true || when === amounts || (when === 'amount' && amounts !== 'debitCredit');
const required = (when, amounts) => !!when && applies(when, amounts);

const box = { marginTop: 12, paddingTop: 10, borderTop: '1px dashed var(--border-default)' };
const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginTop: 8 };
const label = { display: 'block', marginBottom: 4, color: 'var(--text-secondary)', fontSize: 12 };
const select = {
  width: '100%', padding: '6px 8px', borderRadius: 6, fontSize: 13,
  border: '1px solid var(--border-default)', background: 'var(--bg-input)', color: 'var(--text-primary)',
};
const check = { display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-primary)', fontSize: 13 };
const hint = { color: 'var(--text-disabled)', fontSize: 12, marginTop: 6 };
const star = { color: 'var(--state-danger)' };

// The column names of a CSV (its first line) or of a workbook's first chosen sheet.
async function readHeaders(file, kind, { delimiter: chosen, sheet: chosenSheet }) {
  if (kind === 'excel') {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', sheetRows: 1 });
    const sheet = chosenSheet || wb.SheetNames[0];
    const [row = []] = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1 });
    return row.map((c) => String(c ?? '').trim()).filter(Boolean);
  }
  const bytes = new Uint8Array(await file.slice(0, 65536).arrayBuffer());
  let text;
  // The UTF-8 decoder drops a byte-order mark itself.
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { text = new TextDecoder('windows-1252').decode(bytes); }
  const first = text.split(/\r?\n/)[0] || '';
  const named = { comma: ',', semicolon: ';', tab: '\t', pipe: '|' }[chosen];
  const delimiter = named || [';', ',', '\t', '|'].reduce((best, d) => (first.split(d).length > first.split(best).length ? d : best), ',');
  return first.split(delimiter).map((c) => c.trim().replace(/^"(.*)"$/, '$1')).filter(Boolean);
}

export default function LedgerOptions({ file, kind, options, onChange }) {
  const ledger = options.ledger || null;
  const [columns, setColumns] = useState(null);
  const set = (next) => onChange({ ...options, ledger: next });

  // The header is read again only when what decides it changes.
  const on = !!ledger;
  const delimiter = options.delimiter;
  const sheet = (options.sheets || [])[0];
  useEffect(() => {
    if (!on || !file) return undefined;
    let live = true;
    readHeaders(file, kind, { delimiter, sheet }).then((names) => { if (live) setColumns(names); }).catch(() => { if (live) setColumns([]); });
    return () => { live = false; };
  }, [on, file, kind, delimiter, sheet]);

  return (
    <div style={box}>
      <label style={check}>
        <input type="checkbox" checked={!!ledger}
          onChange={(e) => set(e.target.checked ? { chart: 'generic', currency: 'EUR', amounts: 'debitCredit', columns: {} } : null)} />
        This file is a general ledger — read it as accounting books
      </label>
      {ledger && (
        <>
          <div style={grid}>
            <label>
              <span style={label}>Chart of accounts</span>
              <select style={select} value={ledger.chart} onChange={(e) => set({ ...ledger, chart: e.target.value })}>
                {LEDGER_CHARTS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
            <label>
              <span style={label}>Currency</span>
              <select style={select} value={ledger.currency} onChange={(e) => set({ ...ledger, currency: e.target.value })}>
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label>
              <span style={label}>Amounts</span>
              <select style={select} value={ledger.amounts} onChange={(e) => set({ ...ledger, amounts: e.target.value })}>
                {AMOUNT_MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          </div>
          <div style={grid}>
            {FIELDS.filter(([, , when]) => applies(when, ledger.amounts)).map(([field, name, when]) => (
              <label key={field}>
                <span style={label}>{name}{required(when, ledger.amounts) && <span style={star}> *</span>}</span>
                <select style={select} value={ledger.columns[field] || ''}
                  onChange={(e) => set({ ...ledger, columns: { ...ledger.columns, [field]: e.target.value || undefined } })}>
                  <option value="">{columns === null ? 'Reading the columns…' : '—'}</option>
                  {(columns || []).map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
            ))}
          </div>
          <div style={hint}>
            The ledger becomes books with the Finance package. With &ldquo;map the accounts yourself&rdquo;, place them after the import (Account mapping on the source&apos;s card).
          </div>
        </>
      )}
    </div>
  );
}
