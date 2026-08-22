import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  TbArrowLeft, TbTelescope, TbTable, TbChartBar, TbDownload, TbDeviceFloppy,
  TbLoader2, TbCode, TbX,
} from 'react-icons/tb';
import api from '../utils/api';
import { toast } from '../components/Toast/toast';
import FilterRulesEditor, { buildDefaultFilterRule } from '../components/FilterRulesEditor/FilterRulesEditor';
import { useEchartsInstance } from '../hooks/useEchartsInstance';
import { CHART_COLORS } from '../utils/chartPalette';
import { tokenizeSql } from '../utils/sqlHighlight';
import { buildExploreBody, exploreColumns, sortRows, rowsToCsv } from '../utils/exploreQuery';
import { useAuth } from '../hooks/useAuth';

// Ad-hoc exploration: pick a model, tick dimensions and measures, filter,
// and read the answer immediately — table always, quick bar chart when the
// shape allows, no report required. RLS and access rules apply through the
// normal /query path. "Save as report" bridges a keeper into the editor.

export default function Explore() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const [models, setModels] = useState([]);
  const [modelId, setModelId] = useState(searchParams.get('modelId') || '');
  const [model, setModel] = useState(null);
  const [dims, setDims] = useState([]);
  const [measures, setMeasures] = useState([]);
  const [filters, setFilters] = useState([]);
  const [limit, setLimit] = useState(1000);
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState(null);
  const [sql, setSql] = useState(null);
  const [showSql, setShowSql] = useState(false);
  const [elapsed, setElapsed] = useState(null);
  const [running, setRunning] = useState(false);
  const [view, setView] = useState('table');
  const [sort, setSort] = useState({ key: null, dir: null });
  const [saving, setSaving] = useState(false);
  const seqRef = useRef(0);

  useEffect(() => {
    api.get('/models')
      .then((res) => setModels(res.data.models || []))
      .catch((err) => toast(err.response?.data?.error || 'Failed to load models'));
  }, []);

  // Switching models resets the picks — fields belong to one model.
  useEffect(() => {
    setDims([]); setMeasures([]); setFilters([]); setRows(null); setSql(null); setSort({ key: null, dir: null });
    if (!modelId) { setModel(null); return; }
    let stale = false;
    api.get(`/models/${modelId}`)
      .then((res) => { if (!stale) setModel(res.data.model); })
      .catch((err) => toast(err.response?.data?.error || 'Failed to load the model'));
    return () => { stale = true; };
  }, [modelId]);

  // Auto-run, debounced: exploration should answer as you pick, not make
  // you press a button after every change. Sequence guard so a slow older
  // response can never overwrite a newer one.
  useEffect(() => {
    if (!modelId || (dims.length === 0 && measures.length === 0)) { setRows(null); setSql(null); return; }
    const seq = ++seqRef.current;
    const t = setTimeout(async () => {
      setRunning(true);
      const t0 = performance.now();
      try {
        const body = buildExploreBody({ modelId, dims, measures, filters, limit });
        delete body._modelId;
        const res = await api.post(`/models/${modelId}/query`, body);
        if (seq !== seqRef.current) return;
        setRows(res.data.rows || []);
        setSql(res.data.sql || null);
        setElapsed(Math.round(performance.now() - t0));
      } catch (err) {
        if (seq !== seqRef.current) return;
        setRows([]);
        setSql(null);
        toast(err.response?.data?.error || 'Query failed');
      } finally {
        if (seq === seqRef.current) setRunning(false);
      }
    }, 450);
    return () => clearTimeout(t);
  }, [modelId, dims, measures, filters, limit]);

  const columns = useMemo(
    () => exploreColumns({ dims, measures, model }),
    [dims, measures, model]
  );
  const sortedRows = useMemo(
    () => sortRows(rows || [], sort.key, sort.dir),
    [rows, sort]
  );

  const toggle = (name, list, setList) => {
    setList(list.includes(name) ? list.filter((x) => x !== name) : [...list, name]);
  };
  const headerSort = (key) => {
    setSort((prev) => prev.key !== key
      ? { key, dir: 'asc' }
      : prev.dir === 'asc' ? { key, dir: 'desc' } : { key: null, dir: null });
  };

  const exportCsv = () => {
    const csv = rowsToCsv(sortedRows, columns);
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `exploration_${model?.name || 'data'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const saveAsReport = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await api.post('/reports', {
        title: `Exploration — ${model?.name || 'model'}`,
        modelId,
      });
      const reportId = res.data.report?.id || res.data.id;
      const type = view === 'bar' && chartApplies ? 'bar' : 'table';
      await api.put(`/reports/${reportId}`, {
        widgets: {
          w1: {
            type,
            dataBinding: {
              selectedDimensions: dims,
              selectedMeasures: measures,
              ...(filters.length > 0 ? { widgetFilters: filters } : {}),
            },
          },
        },
        layout: [{ i: 'w1', x: 40, y: 40, w: 760, h: 420 }],
      });
      toast('Report created from this exploration', 'success');
      navigate(`/edit/${reportId}`);
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to save as report');
    } finally {
      setSaving(false);
    }
  };

  // Quick bar chart — meaningful for exactly one dim + at least one measure.
  const chartApplies = dims.length === 1 && measures.length >= 1;
  const chartOption = useMemo(() => {
    if (!chartApplies || !rows || rows.length === 0 || columns.length < 2) return null;
    const dimKey = columns[0].key;
    const measCols = columns.slice(1);
    const labels = sortedRows.map((r) => String(r[dimKey] ?? ''));
    return {
      tooltip: { trigger: 'axis' },
      legend: measCols.length > 1 ? { bottom: 0 } : undefined,
      grid: { left: 48, right: 16, top: 16, bottom: measCols.length > 1 ? 46 : 28 },
      xAxis: { type: 'category', data: labels, axisLabel: { rotate: labels.length > 12 ? 40 : 0 } },
      yAxis: { type: 'value' },
      series: measCols.map((c, i) => ({
        name: c.key, type: 'bar',
        data: sortedRows.map((r) => Number(r[c.key]) || 0),
        itemStyle: { color: CHART_COLORS[i % CHART_COLORS.length] },
      })),
    };
  }, [chartApplies, rows, sortedRows, columns]);
  const chartRef = useEchartsInstance({ option: view === 'bar' ? chartOption : null });

  const fieldMatches = (f) => !search
    || (f.label || f.name).toLowerCase().includes(search.toLowerCase());
  const canWrite = user && user.role !== 'viewer';

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <button className="btn-hover" onClick={() => navigate('/')} style={backBtn}>
          <TbArrowLeft size={16} /> Back
        </button>
        <div style={titleStyle}><TbTelescope size={18} /> Explore</div>
        <select value={modelId} onChange={(e) => setModelId(e.target.value)} style={modelSelect}>
          <option value="">— choose a model —</option>
          {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        {rows && rows.length > 0 && (
          <>
            <button className="btn-hover" onClick={exportCsv} style={toolBtn} title="Download these rows as CSV">
              <TbDownload size={15} /> CSV
            </button>
            {canWrite && (
              <button className="btn-hover" onClick={saveAsReport} disabled={saving} style={toolBtn}
                title="Create a report pre-filled with this exploration">
                {saving ? <TbLoader2 size={15} className="spin" /> : <TbDeviceFloppy size={15} />} Save as report
              </button>
            )}
          </>
        )}
      </header>

      <div style={bodyStyle}>
        {/* ── field picker ── */}
        <aside style={asideStyle}>
          {!model ? (
            <div style={hintStyle}>Pick a model to see its fields.</div>
          ) : (
            <>
              <input
                value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search fields…" style={searchStyle}
              />
              <div style={sectionTitle}>Dimensions</div>
              {(model.dimensions || []).filter(fieldMatches).map((d) => (
                <label key={d.name} style={fieldRow}>
                  <input type="checkbox" checked={dims.includes(d.name)}
                    onChange={() => toggle(d.name, dims, setDims)} />
                  <span style={fieldLabel}>{d.label || d.name}</span>
                </label>
              ))}
              <div style={sectionTitle}>Measures</div>
              {(model.measures || []).filter(fieldMatches).map((m) => (
                <label key={m.name} style={fieldRow}>
                  <input type="checkbox" checked={measures.includes(m.name)}
                    onChange={() => toggle(m.name, measures, setMeasures)} />
                  <span style={{ ...fieldLabel, color: 'var(--state-success)' }}>{m.label || m.name}</span>
                </label>
              ))}
              <div style={sectionTitle}>Filters</div>
              <select
                value="" style={{ ...searchStyle, marginBottom: 6 }}
                onChange={(e) => {
                  if (!e.target.value) return;
                  setFilters([...filters, buildDefaultFilterRule(model, e.target.value, false)]);
                }}
              >
                <option value="">+ Add a filter on…</option>
                {(model.dimensions || []).map((d) => (
                  <option key={d.name} value={d.name}>{d.label || d.name}</option>
                ))}
              </select>
              {filters.length > 0 && (
                <FilterRulesEditor
                  model={model} modelId={modelId} rules={filters} onChange={setFilters}
                  styles={{ inputStyle: ruleInput, cardStyle: ruleCard, labelStyle: ruleLabel }}
                />
              )}
              <div style={sectionTitle}>Row limit</div>
              <input type="number" min={1} max={10000} value={limit}
                onChange={(e) => setLimit(e.target.value)} style={searchStyle} />
            </>
          )}
        </aside>

        {/* ── results ── */}
        <main style={mainStyle}>
          {!model || (dims.length === 0 && measures.length === 0) ? (
            <div style={emptyStyle}>
              Tick at least one dimension or measure — the answer appears here as you pick.
            </div>
          ) : (
            <>
              <div style={resultBar}>
                <div style={viewToggle}>
                  <button onClick={() => setView('table')} style={toggleBtn(view === 'table')} title="Table">
                    <TbTable size={15} />
                  </button>
                  <button
                    onClick={() => setView('bar')}
                    style={toggleBtn(view === 'bar')}
                    disabled={!chartApplies}
                    title={chartApplies ? 'Bar chart' : 'Bar chart needs exactly one dimension'}
                  >
                    <TbChartBar size={15} />
                  </button>
                </div>
                <div style={statusStyle}>
                  {running
                    ? <><TbLoader2 size={13} className="spin" /> running…</>
                    : rows ? `${rows.length} row${rows.length === 1 ? '' : 's'}${elapsed != null ? ` · ${elapsed} ms` : ''}` : ''}
                </div>
                {sql && (
                  <button className="btn-hover" onClick={() => setShowSql((v) => !v)} style={toolBtn} title="Show the SQL that ran">
                    <TbCode size={14} /> SQL
                  </button>
                )}
              </div>
              {showSql && sql && (
                <pre style={sqlBox}>
                  <button onClick={() => setShowSql(false)} style={sqlClose} title="Close"><TbX size={13} /></button>
                  {tokenizeSql(sql).map((t, i) => (
                    <span key={i} style={{ color: SQL_COLORS[t.type] || 'inherit' }}>{t.text}</span>
                  ))}
                </pre>
              )}
              {view === 'bar' && chartApplies ? (
                <div style={chartWrap}><div ref={chartRef} style={{ width: '100%', height: '100%' }} /></div>
              ) : (
                <div style={tableWrap}>
                  <table style={tableStyle}>
                    <thead>
                      <tr>
                        {columns.map((c) => (
                          <th key={c.key} onClick={() => headerSort(c.key)} style={thStyle} title="Click to sort">
                            {c.key}{sort.key === c.key ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sortedRows.map((r, i) => (
                        <tr key={i} style={{ background: i % 2 ? 'var(--bg-subtle)' : 'transparent' }}>
                          {columns.map((c) => (
                            <td key={c.key} style={{ ...tdStyle, textAlign: c.kind === 'measure' ? 'right' : 'left' }}>
                              {r[c.key] == null ? '' : String(r[c.key])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {rows && rows.length === 0 && !running && <div style={emptyStyle}>No rows.</div>}
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

const SQL_COLORS = {
  keyword: '#7c3aed', string: '#16a34a', number: '#b45309',
  identifier: 'var(--text-primary)', comment: 'var(--text-disabled)',
};

const pageStyle = { height: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-app)' };
const headerStyle = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px',
  background: 'var(--bg-panel)', borderBottom: '1px solid var(--border-default)', flexShrink: 0,
};
const backBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 10px', fontSize: 13,
  background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border-default)',
  borderRadius: 6, cursor: 'pointer',
};
const titleStyle = { display: 'flex', alignItems: 'center', gap: 7, fontSize: 15, fontWeight: 600 };
const modelSelect = {
  padding: '7px 10px', fontSize: 13, borderRadius: 6, border: '1px solid var(--border-default)',
  background: 'var(--bg-panel)', color: 'var(--text-primary)', minWidth: 200, outline: 'none',
};
const toolBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 10px', fontSize: 12.5,
  background: 'var(--bg-subtle)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)',
  borderRadius: 6, cursor: 'pointer',
};
const bodyStyle = { display: 'flex', flex: 1, minHeight: 0 };
const asideStyle = {
  width: 250, flexShrink: 0, overflowY: 'auto', padding: 12,
  background: 'var(--bg-panel)', borderRight: '1px solid var(--border-default)',
};
const hintStyle = { fontSize: 12.5, color: 'var(--text-muted)', padding: 6, lineHeight: 1.5 };
const searchStyle = {
  width: '100%', padding: '6px 8px', fontSize: 12.5, borderRadius: 6, boxSizing: 'border-box',
  border: '1px solid var(--border-default)', outline: 'none',
  background: 'var(--bg-panel)', color: 'var(--text-primary)',
};
const sectionTitle = {
  fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)',
  margin: '14px 0 6px', letterSpacing: 0.4,
};
const fieldRow = { display: 'flex', alignItems: 'center', gap: 7, padding: '3px 2px', cursor: 'pointer' };
const fieldLabel = { fontSize: 13, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const ruleCard = { border: '1px solid var(--border-default)', borderRadius: 6, padding: '7px 8px', marginBottom: 6, background: 'var(--bg-subtle)' };
const ruleInput = {
  width: '100%', padding: '5px 7px', fontSize: 12, borderRadius: 5, boxSizing: 'border-box',
  border: '1px solid var(--border-default)', background: 'var(--bg-panel)', color: 'var(--text-primary)',
};
const ruleLabel = { display: 'block', fontSize: 10.5, color: 'var(--text-muted)', marginBottom: 3 };
const mainStyle = { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', padding: 14 };
const emptyStyle = { color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', marginTop: 60, lineHeight: 1.6 };
const resultBar = { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexShrink: 0 };
const viewToggle = { display: 'inline-flex', gap: 4 };
const toggleBtn = (active) => ({
  display: 'inline-flex', alignItems: 'center', padding: '6px 9px', borderRadius: 6, cursor: 'pointer',
  border: '1px solid ' + (active ? 'var(--accent-primary)' : 'var(--border-default)'),
  background: active ? 'var(--accent-primary-soft)' : 'var(--bg-panel)',
  color: active ? 'var(--accent-primary)' : 'var(--text-secondary)',
});
const statusStyle = { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-muted)', flex: 1 };
const sqlBox = {
  position: 'relative', fontSize: 12, lineHeight: 1.5, padding: '10px 28px 10px 12px', margin: '0 0 10px',
  background: 'var(--bg-subtle)', border: '1px solid var(--border-default)', borderRadius: 8,
  whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 180, overflowY: 'auto',
  fontFamily: 'ui-monospace, monospace', flexShrink: 0, color: 'var(--text-secondary)',
};
const sqlClose = { position: 'absolute', top: 6, right: 6, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-disabled)' };
const chartWrap = { flex: 1, minHeight: 0, background: 'var(--bg-panel)', border: '1px solid var(--border-default)', borderRadius: 10, padding: 12 };
const tableWrap = { flex: 1, minHeight: 0, overflow: 'auto', background: 'var(--bg-panel)', border: '1px solid var(--border-default)', borderRadius: 10 };
const tableStyle = { borderCollapse: 'collapse', width: '100%', fontSize: 12.5 };
const thStyle = {
  position: 'sticky', top: 0, background: 'var(--bg-subtle)', textAlign: 'left',
  padding: '8px 12px', fontWeight: 600, color: 'var(--text-secondary)', cursor: 'pointer',
  borderBottom: '1px solid var(--border-default)', whiteSpace: 'nowrap', userSelect: 'none',
};
const tdStyle = { padding: '6px 12px', color: 'var(--text-primary)', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border-subtle, transparent)' };
