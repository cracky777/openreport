import { useEffect, useMemo, useState } from 'react';
import { TbListDetails, TbSearch } from 'react-icons/tb';
import api from '../../utils/api';
import Modal from '../Modal/Modal';
import { PrimaryButton, SecondaryButton } from '../PageHeader/PageHeader';
import { toast } from '../Toast/toast';

const head = { display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 };
const headIcon = { width: 40, height: 40, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--accent-primary-soft)', color: 'var(--accent-primary)', flexShrink: 0 };
const titleStyle = { margin: 0, fontSize: 18, fontWeight: 600, color: 'var(--text-primary)' };
const subStyle = { margin: '4px 0 0', fontSize: 13, color: 'var(--text-secondary)' };
const toolbar = { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 };
const searchWrap = { position: 'relative', flex: '1 1 220px', minWidth: 0 };
const searchIcon = { position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' };
const inputStyle = {
  width: '100%', padding: '7px 10px 7px 30px', fontSize: 13, borderRadius: 6, boxSizing: 'border-box',
  border: '1px solid var(--border-default)', background: 'var(--bg-input)', color: 'var(--text-primary)',
};
const selectStyle = {
  padding: '6px 8px', fontSize: 13, borderRadius: 6, maxWidth: '100%',
  border: '1px solid var(--border-default)', background: 'var(--bg-input)', color: 'var(--text-primary)',
};
const tableWrap = { maxHeight: '52vh', overflow: 'auto', border: '1px solid var(--border-default)', borderRadius: 8 };
const tableStyle = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
const th = { position: 'sticky', top: 0, background: 'var(--bg-panel)', textAlign: 'left', padding: '7px 8px', fontWeight: 600, color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-default)', zIndex: 1 };
const td = { padding: '5px 8px', borderBottom: '1px solid var(--border-subtle, var(--border-default))', color: 'var(--text-primary)', verticalAlign: 'middle' };
const num = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
const changedRow = { background: 'var(--accent-primary-soft)' };
const mappedDot = { display: 'inline-block', width: 6, height: 6, borderRadius: 3, background: 'var(--accent-primary)', marginRight: 6, verticalAlign: 'middle' };
const actions = { display: 'flex', gap: 8, marginTop: 14, alignItems: 'center', flexWrap: 'wrap' };
const muted = { fontSize: 12, color: 'var(--text-muted)' };

const FILTERS = [['all', 'All accounts'], ['unclassified', 'Not placed'], ['income', 'Income statement'], ['balance', 'Balance sheet'], ['mapped', 'Placed by hand']];
const money = (v) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(v || 0);

// Where each account of a source of books sits — an income statement line, a
// balance-sheet group — and the way to move it: one by one or several at
// once. A move is kept with the source and applied again to every refresh
// and every fiscal year merged in (server: utils/accounting/accountMap.js).
export default function AccountMappingDialog({ datasourceId, name, onClose, onSaved }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [changes, setChanges] = useState({});
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState(false);

  const load = () => {
    setData(null);
    api.get(`/upload/${datasourceId}/accounts`)
      .then((res) => {
        setData(res.data);
        // Open on what needs a hand when something does.
        if (res.data.accounts.some((a) => a.lineNo === 999)) setFilter('unclassified');
      })
      .catch((err) => setError(err.response?.data?.error || err.message));
  };
  useEffect(load, [datasourceId]);

  const targets = useMemo(() => new Map((data?.targets || []).map((t) => [t.lineNo, t])), [data]);
  const groups = useMemo(() => {
    const by = {};
    for (const t of data?.targets || []) (by[t.statement] = by[t.statement] || []).push(t);
    return Object.entries(by);
  }, [data]);
  const lineOf = (a) => (a.account in changes ? changes[a.account] : a.lineNo);
  const statementOf = (a) => targets.get(lineOf(a))?.statement;

  const needle = query.trim().toLowerCase();
  const shown = (data?.accounts || []).filter((a) => {
    if (needle && !`${a.account} ${a.label || ''}`.toLowerCase().includes(needle)) return false;
    // An account placed here stays in sight until the change is saved.
    if (filter === 'unclassified') return a.lineNo === 999 || a.account in changes;
    if (filter === 'income') return statementOf(a) === 'Income statement';
    if (filter === 'balance') return statementOf(a) === 'Balance sheet';
    if (filter === 'mapped') return a.mapped || a.account in changes;
    return true;
  });

  const place = (accounts, lineNo) => setChanges((c) => {
    const next = { ...c };
    for (const a of accounts) {
      if (lineNo === a.lineNo) delete next[a.account]; else next[a.account] = lineNo;
    }
    return next;
  });
  const toggle = (account) => setSelected((s) => {
    const next = new Set(s);
    if (next.has(account)) next.delete(account); else next.add(account);
    return next;
  });
  const allShownSelected = shown.length > 0 && shown.every((a) => selected.has(a.account));
  const toggleAll = () => setSelected((s) => {
    const next = new Set(s);
    for (const a of shown) { if (allShownSelected) next.delete(a.account); else next.add(a.account); }
    return next;
  });

  const save = async () => {
    setBusy(true);
    try {
      await api.put(`/upload/${datasourceId}/accounts`, { changes });
      toast(`${Object.keys(changes).length} account${Object.keys(changes).length > 1 ? 's' : ''} placed: the reports read the books again`, 'success');
      setChanges({});
      setSelected(new Set());
      onSaved?.();
      load();
    } catch (err) {
      toast(err.response?.data?.error || 'The accounts could not be placed');
    } finally {
      setBusy(false);
    }
  };

  const options = (
    <>
      {groups.map(([statement, list]) => (
        <optgroup key={statement} label={statement}>
          {list.map((t) => <option key={t.lineNo} value={t.lineNo}>{t.line}</option>)}
        </optgroup>
      ))}
    </>
  );
  const pending = Object.keys(changes).length;
  const unplaced = data ? data.accounts.filter((a) => lineOf(a) === 999).length : 0;
  const canEdit = !!data?.canEdit;

  return (
    <Modal onClose={busy ? undefined : onClose} width={920}>
      <div style={head}>
        <span style={headIcon}><TbListDetails size={22} /></span>
        <div style={{ minWidth: 0 }}>
          <h2 style={titleStyle}>Account mapping{name ? ` — ${name}` : ''}</h2>
          <p style={subStyle}>
            {data ? `${data.chartName} · ${data.accounts.length} accounts${unplaced ? ` · ${unplaced} not placed` : ''}` : 'Reading the books…'}
            {canEdit ? ' — place an account on another line of the statements; the books keep it through every refresh.' : ''}
          </p>
        </div>
      </div>
      {error && <div style={{ ...muted, color: 'var(--state-danger)' }}>{error}</div>}
      {data && (
        <>
          <div style={toolbar}>
            <div style={searchWrap}>
              <TbSearch size={14} style={searchIcon} />
              <input style={inputStyle} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search an account number or label…" aria-label="Search accounts" />
            </div>
            <select style={selectStyle} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Show">
              {FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            {canEdit && selected.size > 0 && (
              <select style={selectStyle} value="" aria-label="Move the selected accounts"
                onChange={(e) => { place(data.accounts.filter((a) => selected.has(a.account)), Number(e.target.value)); setSelected(new Set()); }}>
                <option value="" disabled>Move {selected.size} selected to…</option>
                {options}
              </select>
            )}
          </div>
          <div style={tableWrap}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  {canEdit && <th style={{ ...th, width: 28 }}><input type="checkbox" checked={allShownSelected} onChange={toggleAll} aria-label="Select all shown" /></th>}
                  <th style={th}>Account</th>
                  <th style={th}>Label</th>
                  <th style={{ ...th, textAlign: 'right' }}>Debit</th>
                  <th style={{ ...th, textAlign: 'right' }}>Credit</th>
                  <th style={th}>Line</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((a) => (
                  <tr key={a.account} style={a.account in changes ? changedRow : undefined}>
                    {canEdit && <td style={td}><input type="checkbox" checked={selected.has(a.account)} onChange={() => toggle(a.account)} aria-label={`Select ${a.account}`} /></td>}
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      {(a.mapped || a.account in changes) && <span style={mappedDot} title="Placed by hand" />}
                      {a.account}
                    </td>
                    <td style={td}>{a.label}</td>
                    <td style={num}>{money(a.debit)}</td>
                    <td style={num}>{money(a.credit)}</td>
                    <td style={td}>
                      {canEdit ? (
                        <select style={selectStyle} value={lineOf(a)} onChange={(e) => place([a], Number(e.target.value))} aria-label={`Line of ${a.account}`}>
                          {options}
                        </select>
                      ) : targets.get(lineOf(a))?.line}
                    </td>
                  </tr>
                ))}
                {!shown.length && <tr><td style={{ ...td, ...muted }} colSpan={6}>No account here.</td></tr>}
              </tbody>
            </table>
          </div>
          <div style={actions}>
            {canEdit && (
              <PrimaryButton onClick={save} disabled={busy || !pending}>
                {busy ? 'Placing…' : pending ? `Save ${pending} change${pending > 1 ? 's' : ''}` : 'Save'}
              </PrimaryButton>
            )}
            <SecondaryButton onClick={onClose} disabled={busy}>{pending ? 'Discard' : 'Close'}</SecondaryButton>
            {pending > 0 && <span style={muted}>An account set back on the line its chart gave it is no longer kept as a change.</span>}
          </div>
        </>
      )}
    </Modal>
  );
}
