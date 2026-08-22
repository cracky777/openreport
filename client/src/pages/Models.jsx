import { useState, useMemo, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../utils/api';
import { toast } from '../components/Toast/toast';
import { TbRefresh, TbLoader2, TbClock } from 'react-icons/tb';
import { EditIcon, ICON_SIZE } from '../components/actionIcons';
import { cardActionBtn } from '../components/dashboardModalStyles';
import IncrementalRefreshDialog from '../components/IncrementalRefreshDialog/IncrementalRefreshDialog';
import { PrimaryButton } from '../components/PageHeader/PageHeader';
import Modal from '../components/Modal/Modal';
import { useGraph } from '../hooks/graphContext';
import { useJourneyFocus } from '../hooks/useJourneyFocus';
import FilterCrumb from '../components/AppShell/FilterCrumb';
import JoinAdd from '../components/AppShell/JoinAdd';
import SourceIcon from '../components/AppShell/SourceIcon';
import ConfirmDeleteButton from '../components/ConfirmDeleteButton/ConfirmDeleteButton';

// Fills the stage slot AppShell gives it; the shell owns the viewport height.
const _hs0 = { flex: 1, overflow: 'auto', backgroundColor: 'var(--bg-app)' };
// Action bar sitting at the top of the panel — the stage switcher in the shell
// already says where we are, so this row carries actions only.
// Three columns: the action sits in the middle one, on the axis of the cards,
// and stays put whether or not the crumb is showing. See Datasources.
const _hs1 = {
  display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)',
  alignItems: 'center', gap: 8, marginBottom: 20,
};
const crumbSlot = { justifySelf: 'start' };
const _hs2 = { padding: '32px 24px' };
const _hs3 = { fontSize: 16, fontWeight: 600, marginBottom: 16 };
const _hs4 = { marginBottom: 12 };
const _hs5 = { marginBottom: 12 };
const _hs6 = { fontSize: 12, color: 'var(--state-danger)', marginTop: 4 };
const _hs7 = { color: 'var(--accent-primary)', background: 'transparent', border: '1px solid transparent', cursor: 'pointer', fontSize: 12, padding: '2px 6px', borderRadius: 4 };
const _hs8 = { marginBottom: 16 };
const _hs9 = { display: 'flex', gap: 8, justifyContent: 'flex-end' };
const _hs10 = { color: 'var(--text-disabled)', textAlign: 'center', marginTop: 60 };
const _hs11 = { textAlign: 'center', marginTop: 80 };
const _hs12 = { fontSize: 16, color: 'var(--text-muted)', marginBottom: 4 };
const _hs13 = { fontSize: 13, color: 'var(--text-disabled)', marginBottom: 16 };
const _hs14 = { display: 'flex', flexDirection: 'column', gap: 8 };
const _hs15 = { cursor: 'pointer', flex: 1 };
const _hs16 = { fontWeight: 600, color: 'var(--text-primary)', fontSize: 15 };
const _hs17 = { fontSize: 13, color: 'var(--text-muted)', marginTop: 2 };
const _hs18 = { fontSize: 12, color: 'var(--text-disabled)', marginTop: 2 };
const _hs19 = { display: 'flex', alignItems: 'center', gap: 8 };

export default function Models() {
  const navigate = useNavigate();
  // Rows come from the shell-level graph so this column is already populated
  // when the carousel slides it in.
  const {
    setModels, datasources, reportsByModelAll, activeModelIds, loading,
    orderedModels: graphOrderedModels,
  } = useGraph();
  // The branch the journey is focused on, resolved once for all three stages.
  const focus = useJourneyFocus();

  // Order comes from the graph — models sit in their source's block, which is
  // what keeps the joins from crossing. Only the filter is local.
  const orderedModels = useMemo(() => (
    focus.modelIds ? graphOrderedModels.filter((m) => focus.modelIds.has(m.id)) : graphOrderedModels
  ), [graphOrderedModels, focus.modelIds]);
  // Which sources are uploaded files, so a model can say what it actually sits
  // on rather than making the user walk back a column to find out.
  // `extra_config` comes off the row as JSON text.
  const fileDatasourceIds = useMemo(() => {
    const ids = new Set();
    for (const ds of datasources) {
      let extra = ds.extra_config;
      if (typeof extra === 'string') {
        try { extra = JSON.parse(extra); } catch { extra = null; /* malformed row — read it as a connection */ }
      }
      if (extra?.sourceFile) ids.add(ds.id);
    }
    return ids;
  }, [datasources]);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', datasourceId: '', description: '' });
  // Cache actions moved here from the report cards: the rollup cache is
  // MODEL-scoped (one shared table set for every report on the model), so
  // refreshing it and tuning its incremental window belong to the model.
  const [refreshingIds, setRefreshingIds] = useState(() => new Set());
  const [incrModelId, setIncrModelId] = useState(null);

  // Creating from a focused column pre-picks the datasource we are standing in:
  // arriving through its join and then re-choosing it by hand is busywork.
  const openForm = () => {
    if (focus.stage === 'sources') setForm((f) => ({ ...f, datasourceId: focus.id }));
    setShowForm(true);
  };

  // The "+" on a source card lands here with that source already chosen. This
  // watches the parameters instead of firing on mount, because the stage never
  // unmounts — all three ride the same ribbon — so arriving from Sources is a
  // parameter change and nothing more. Stripping them afterwards keeps a
  // refresh from re-opening the dialog.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.get('newModel') !== '1') return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm((f) => ({ ...f, datasourceId: searchParams.get('datasourceId') || '' }));
    setShowForm(true);
    const rest = new URLSearchParams(searchParams);
    rest.delete('newModel');
    rest.delete('datasourceId');
    setSearchParams(rest, { replace: true });
  }, [searchParams, setSearchParams]);

  const handleCreate = async () => {
    if (!form.name || !form.datasourceId) return;
    try {
      const res = await api.post('/models', form);
      navigate(`/models/${res.data.model.id}`);
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to create model');
    }
  };

  const refreshModelCache = async (m) => {
    if (refreshingIds.has(m.id)) return;
    setRefreshingIds((p) => new Set(p).add(m.id));
    try {
      const res = await api.post(`/rollups/run-now/${m.id}`);
      const { built = 0, errors = [] } = res.data || {};
      if (errors.length) toast(`Cache refresh finished with errors: ${String(errors[0]).slice(0, 140)}`);
      else if (built > 0) toast(`Cache refreshed — ${built} rollup${built === 1 ? '' : 's'} built`, 'success');
      else toast('Nothing to build — add widgets to a report on this model first');
    } catch (err) {
      toast(err.response?.data?.error || 'Cache refresh failed');
    } finally {
      setRefreshingIds((p) => { const n = new Set(p); n.delete(m.id); return n; });
    }
  };

  const handleDelete = async (id) => {
    try {
      await api.delete(`/models/${id}`);
      setModels((prev) => prev.filter((m) => m.id !== id));
    } catch (err) {
      toast(err.response?.data?.error || 'Delete failed');
    }
  };

  return (
    <div style={_hs0}>
      <main style={_hs2}>
        <div style={_hs1}>
          <div style={crumbSlot}>
            {focus.active && (
              <FilterCrumb
                label={focus.label}
                verb={focus.stage === 'models' ? 'Showing' : 'Following'}
                onClear={focus.clear}
              />
            )}
          </div>
          <PrimaryButton onClick={openForm}>+ New Model</PrimaryButton>
        </div>
        {showForm && (
          <Modal onClose={() => setShowForm(false)} width={520}>
            <h2 style={_hs3}>New Data Model</h2>
            <div style={_hs4}>
              <label style={labelStyle}>Name</label>
              <input
                style={inputStyle}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Sales Analysis"
              />
            </div>
            <div style={_hs5}>
              <label style={labelStyle}>Data Source</label>
              <select
                style={inputStyle}
                value={form.datasourceId}
                onChange={(e) => setForm({ ...form, datasourceId: e.target.value })}
              >
                <option value="">Select a data source...</option>
                {datasources.map((ds) => (
                  <option key={ds.id} value={ds.id}>{ds.name} ({ds.db_type})</option>
                ))}
              </select>
              {datasources.length === 0 && (
                <p style={_hs6}>
                  No data sources configured.{' '}
                  <button className="btn-hover btn-hover-accent" onClick={() => navigate('/datasources')} style={_hs7}>
                    Add one first
                  </button>
                </p>
              )}
            </div>
            <div style={_hs8}>
              <label style={labelStyle}>Description (optional)</label>
              <input
                style={inputStyle}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="What does this model represent?"
              />
            </div>
            <div style={_hs9}>
              <button className="btn-hover" onClick={() => setShowForm(false)} style={secondaryBtn}>Cancel</button>
              <button className="btn-hover btn-hover-primary" onClick={handleCreate} style={primaryBtn}>Create & Configure</button>
            </div>
          </Modal>
        )}

        {loading ? (
          <div style={_hs10}>Loading...</div>
        ) : orderedModels.length === 0 && !showForm ? (
          // A filter that matches nothing must say so, otherwise the column just
          // looks broken — and the way out has to be one click away.
          focus.active ? (
            <div style={_hs11}>
              <p style={_hs12}>Nothing here for this filter</p>
              <p style={_hs13}>No model is linked to it.</p>
              <button className="btn-hover btn-hover-primary" onClick={focus.clear} style={primaryBtn}>Show every model</button>
            </div>
          ) : (
            <div style={_hs11}>
              <p style={_hs12}>No data models yet</p>
              <p style={_hs13}>
                Models define which tables, dimensions, and measures are available in your reports.
              </p>
              <button className="btn-hover btn-hover-primary" onClick={openForm} style={primaryBtn}>Create your first model</button>
            </div>
          )
        ) : (
          <div style={_hs14}>
            {orderedModels.map((m) => {
              // Guard on the unscoped count: the server refuses while any report uses it.
              const reportCount = reportsByModelAll.get(m.id) || 0;
              return (
              <div key={m.id} style={activeModelIds && !activeModelIds.has(m.id) ? dimmedRowStyle : joinRowStyle}>
              <div className="journey-card" data-join-anchor={`models:${m.id}`} style={cardStyle}>
                <SourceIcon file={fileDatasourceIds.has(m.datasource_id)} />
                <div onClick={() => navigate(`/models/${m.id}`)} style={_hs15}>
                  <div style={_hs16}>{m.name}</div>
                  <div style={_hs17}>
                    Source: {m.datasource_name} — Updated {new Date(m.updated_at).toLocaleDateString()}
                  </div>
                  {m.description && <div style={_hs18}>{m.description}</div>}
                </div>
                {/* Same icon-button language as the report cards, so the two
                    columns read as one system: edit / refresh / incremental /
                    delete, all compact icons with tooltips. */}
                <div style={_hs19}>
                  <button
                    onClick={() => navigate(`/models/${m.id}`)}
                    title="Edit model"
                    {...cardActionBtn()}
                  >
                    <EditIcon size={ICON_SIZE.card} />
                  </button>
                  <button
                    onClick={() => refreshModelCache(m)}
                    disabled={refreshingIds.has(m.id)}
                    title={refreshingIds.has(m.id) ? 'Refreshing cache…' : 'Refresh the cache — rebuilds the rollups shared by every report on this model'}
                    {...cardActionBtn(refreshingIds.has(m.id) ? 'accent' : 'muted')}
                  >
                    {refreshingIds.has(m.id) ? <TbLoader2 size={16} className="spin" /> : <TbRefresh size={16} />}
                  </button>
                  <button
                    onClick={() => setIncrModelId(m.id)}
                    title="Incremental cache refresh…"
                    {...cardActionBtn('muted')}
                  >
                    <TbClock size={16} />
                  </button>
                  <ConfirmDeleteButton
                    variant="icon"
                    label="Delete model"
                    onConfirm={() => handleDelete(m.id)}
                    blockedReason={reportCount ? `Used by ${reportCount} report${reportCount > 1 ? 's' : ''} — delete those first` : null}
                  />
                </div>
                {/* Same parameters the model editor already sends when it
                    bounces back into the new-report wizard. */}
                <JoinAdd
                  title={`Add a report on ${m.name}`}
                  onClick={() => navigate(`/?focus=models:${m.id}&newReport=1&modelId=${m.id}`)}
                />
              </div>
              </div>
              );
            })}
          </div>
        )}
      {incrModelId && (
        <IncrementalRefreshDialog modelId={incrModelId} onClose={() => setIncrModelId(null)} />
      )}
      </main>
    </div>
  );
}

const primaryBtn = {
  padding: '8px 16px', fontSize: 14, fontWeight: 600, border: 'none',
  borderRadius: 6, background: 'var(--accent-primary)', color: '#fff', cursor: 'pointer',
};
const secondaryBtn = {
  padding: '8px 16px', fontSize: 14, background: 'var(--bg-panel)', color: 'var(--text-secondary)',
  border: '1px solid var(--border-default)', borderRadius: 6, cursor: 'pointer',
};
const inputStyle = {
  width: '100%', padding: '8px 10px', border: '1px solid var(--border-default)',
  borderRadius: 6, fontSize: 14, outline: 'none', boxSizing: 'border-box',
};
const labelStyle = { display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4, fontWeight: 500 };
// A row is just a centred card; JoinLayer draws the relations over the space
// either side of it.
const joinRowStyle = { display: 'flex', justifyContent: 'center' };
// Outside the active workspace: dimmed, never hidden — see Datasources.
const dimmedRowStyle = { ...joinRowStyle, opacity: 0.4 };
const cardStyle = { width: 760, flexShrink: 0,
  backgroundColor: 'var(--bg-panel)', padding: '16px 20px', borderRadius: 8,
  border: '1px solid var(--border-default)', display: 'flex', alignItems: 'center', gap: 12,
};
