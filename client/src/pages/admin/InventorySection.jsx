import { useCallback, useEffect, useMemo, useState } from 'react';
import { TbTrash } from 'react-icons/tb';
import api from '../../utils/api';
import ConfirmDialog from '../../components/ConfirmDialog/ConfirmDialog';
import { toast } from '../../components/Toast/toast';

// Admin › Resources: every data source, data model and report of the
// instance — who created it, the workspace it lives in, the workspaces it is
// shared into. Metadata only: the admin manages everything, reading data
// stays with the roles workspaces give (server/utils/workspaceAccess.js).
// Deleting goes through the usual routes, which refuse to strand anything: a
// source still under a model, a model still under a report (409).

const KINDS = [
  { key: 'datasources', label: 'Data sources', noun: 'data source', path: '/datasources' },
  { key: 'models', label: 'Data models', noun: 'data model', path: '/models' },
  { key: 'reports', label: 'Reports', noun: 'report', path: '/reports' },
];

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
// Why a row cannot go yet, or null. Mirrors the server's 409 so the button
// says it before the click.
const BLOCKER = {
  datasources: (r) => (r.modelCount > 0 ? `Used by ${plural(r.modelCount, 'data model')}. Delete them first.` : null),
  models: (r) => (r.reportCount > 0 ? `Used by ${plural(r.reportCount, 'report')}. Delete them first.` : null),
  reports: () => null,
};

const bar = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 };
const kindBtn = (active) => ({
  padding: '6px 12px', fontSize: 13, borderRadius: 6, cursor: 'pointer',
  border: '1px solid var(--border-default)',
  background: active ? 'var(--bg-active)' : 'var(--bg-panel)',
  color: active ? 'var(--accent-primary)' : 'var(--text-secondary)',
  fontWeight: active ? 600 : 500,
});
const countStyle = { fontSize: 11, color: 'var(--text-muted)', marginLeft: 4 };
const search = {
  flex: '1 1 220px', minWidth: 0, padding: '6px 10px', fontSize: 13, borderRadius: 6,
  border: '1px solid var(--border-default)', background: 'var(--bg-panel)', color: 'var(--text-primary)',
};
const tableWrap = { overflowX: 'auto', border: '1px solid var(--border-default)', borderRadius: 8, background: 'var(--bg-panel)' };
const table = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
const th = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid var(--border-default)', color: 'var(--text-muted)', fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap' };
const td = { padding: '8px 10px', borderBottom: '1px solid var(--border-subtle, var(--border-default))', color: 'var(--text-secondary)', verticalAlign: 'top' };
const nameCell = { ...td, color: 'var(--text-primary)', fontWeight: 500 };
const sub = { fontSize: 11, color: 'var(--text-muted)' };
const chip = { display: 'inline-block', margin: '0 4px 4px 0', padding: '1px 6px', fontSize: 11, borderRadius: 4, border: '1px solid var(--border-default)', color: 'var(--text-secondary)', whiteSpace: 'nowrap' };
const personalChip = { ...chip, color: 'var(--text-muted)', borderStyle: 'dashed' };
const muted = { color: 'var(--text-disabled)' };
const deleteBtn = (blocked) => ({
  display: 'inline-flex', alignItems: 'center', padding: 4, borderRadius: 6, border: 'none', background: 'none',
  color: blocked ? 'var(--text-disabled)' : 'var(--state-danger)', cursor: blocked ? 'not-allowed' : 'pointer',
});
const empty = { padding: 24, textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' };

const day = (iso) => (iso ? new Date(`${String(iso).replace(' ', 'T')}Z`).toLocaleDateString() : '');
const who = (c) => (c && (c.name || c.email)) || 'deleted user';

function Workspace({ ws }) {
  if (!ws) return <span style={muted}>—</span>;
  return <span style={ws.personal ? personalChip : chip}>{ws.name}</span>;
}

function DeleteButton({ blocker, onClick }) {
  return (
    <button
      type="button"
      style={deleteBtn(!!blocker)}
      disabled={!!blocker}
      title={blocker || 'Delete'}
      aria-label="Delete"
      onClick={onClick}
    >
      <TbTrash size={15} />
    </button>
  );
}

// The second column says what the row is built on or used by.
const DETAIL = {
  datasources: { head: 'Type', cell: (r) => <>{r.dbType}<div style={sub}>{r.modelCount} model{r.modelCount === 1 ? '' : 's'}</div></> },
  models: { head: 'Data source', cell: (r) => <>{r.datasourceName || <span style={muted}>—</span>}<div style={sub}>{r.reportCount} report{r.reportCount === 1 ? '' : 's'}</div></> },
  reports: { head: 'Data model', cell: (r) => <>{r.modelName || <span style={muted}>—</span>}{r.isPublic && <div style={sub}>public link</div>}</> },
};

export default function InventorySection() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [kind, setKind] = useState('datasources');
  const [q, setQ] = useState('');
  const [pending, setPending] = useState(null);

  const load = useCallback(() => api.get('/admin/inventory')
    .then((res) => setData(res.data))
    .catch((err) => setError(err.response?.data?.error || 'Could not load the resources')), []);
  useEffect(() => { load(); }, [load]);

  // Reloading afterwards keeps the usage counts of the parents honest.
  const remove = async () => {
    const { row, kind: k } = pending;
    setPending(null);
    try {
      await api.delete(`${k.path}/${row.id}`);
      toast(`"${row.name}" deleted`, 'success');
    } catch (err) {
      toast(err.response?.data?.error || `Could not delete this ${k.noun}`);
    }
    load();
  };

  // One search over name, creator and every workspace named on the row.
  const rows = useMemo(() => {
    const list = (data && data[kind]) || [];
    const needle = q.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((r) => [
      r.name, r.creator?.name, r.creator?.email, r.workspace?.name,
      ...(r.sharedIn || []).map((w) => w && w.name),
    ].some((v) => v && String(v).toLowerCase().includes(needle)));
  }, [data, kind, q]);

  if (error) return <div style={empty}>{error}</div>;
  if (!data) return <div style={empty}>Loading…</div>;
  const detail = DETAIL[kind];
  const current = KINDS.find((k) => k.key === kind);

  return (
    <div>
      {pending && (
        <ConfirmDialog
          title={`Delete "${pending.row.name}"?`}
          body={`This ${pending.kind.noun} is deleted for everyone, in every workspace it is shared with. This cannot be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={remove}
          onCancel={() => setPending(null)}
        />
      )}
      <div style={bar}>
        {KINDS.map((k) => (
          <button key={k.key} type="button" style={kindBtn(kind === k.key)} onClick={() => setKind(k.key)}>
            {k.label}<span style={countStyle}>{(data[k.key] || []).length}</span>
          </button>
        ))}
        <input style={search} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, creator or workspace" />
      </div>
      <div style={tableWrap}>
        {rows.length === 0 ? (
          <div style={empty}>{q ? 'Nothing matches this search.' : 'Nothing here yet.'}</div>
        ) : (
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Name</th>
                <th style={th}>{detail.head}</th>
                <th style={th}>Created by</th>
                <th style={th}>Workspace</th>
                <th style={th}>Shared with</th>
                <th style={th} aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={nameCell}>{r.name}<div style={sub}>created {day(r.createdAt)}</div></td>
                  <td style={td}>{detail.cell(r)}</td>
                  <td style={td}>{who(r.creator)}{r.creator?.name && r.creator?.email && <div style={sub}>{r.creator.email}</div>}</td>
                  <td style={td}><Workspace ws={r.workspace} /></td>
                  <td style={td}>
                    {r.sharedIn.length === 0
                      ? <span style={muted}>—</span>
                      : r.sharedIn.map((w) => <Workspace key={w.id} ws={w} />)}
                  </td>
                  <td style={td}>
                    <DeleteButton blocker={BLOCKER[kind](r)} onClick={() => setPending({ row: r, kind: current })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
