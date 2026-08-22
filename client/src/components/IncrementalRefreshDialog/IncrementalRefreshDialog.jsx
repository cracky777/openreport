import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import api from '../../utils/api';
import { toast } from '../Toast/toast';

// Incremental cache refresh — a MODEL-level setting (models.date_column +
// incremental_months): the rollup tables are shared by every report built on
// the model, so the refresh strategy is necessarily shared too. Saving
// reshapes the rollup grain, so the server drops the cache; the next Refresh
// rebuilds it. Rendered through a portal so no ancestor transform can turn
// position:fixed into a local offset.
export default function IncrementalRefreshDialog({ modelId, onClose }) {
  const [model, setModel] = useState(null);
  const [reportCount, setReportCount] = useState(null);
  const [dateColumn, setDateColumn] = useState('');
  const [months, setMonths] = useState(0);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    api.get(`/models/${modelId}`)
      .then((res) => {
        const m = res.data.model;
        setModel(m);
        setDateColumn(m.dateColumn || '');
        setMonths(m.incremental_months || 0);
      })
      .catch((err) => setLoadError(err.response?.data?.error || 'Failed to load the model'));
    // How many reports share this cache — makes the blast radius explicit.
    api.get('/reports')
      .then((res) => setReportCount((res.data.reports || []).filter((r) => r.model_id === modelId).length))
      .catch(() => { /* count stays unknown */ });
  }, [modelId]);

  const effectiveType = (d) => {
    const ov = model?.column_types && model.column_types[`${d.table}.${d.column}`];
    return !ov ? d.type : (typeof ov === 'string' ? ov : ov.type);
  };
  const dateDims = (model?.dimensions || []).filter((d) => effectiveType(d) === 'date');

  // Explicit affordance instead of a silent success: with no date column the
  // only effective action is turning incremental OFF — if it already is off,
  // there is nothing to save and the button stays disabled.
  const wasOn = !!(model && model.incremental_months && model.dateColumn);
  const turnsOff = !dateColumn || !months;
  const isNoop = turnsOff && !wasOn;

  const save = async () => {
    setSaving(true);
    try {
      const effectiveMonths = dateColumn ? (months || null) : null;
      await api.put(`/models/${modelId}`, { dateColumn, incrementalMonths: effectiveMonths });
      toast(effectiveMonths
        ? `Incremental refresh on — next refresh re-queries the last ${effectiveMonths} month${effectiveMonths === 1 ? '' : 's'} only`
        : 'Incremental refresh off — next refresh rebuilds everything', 'success');
      onClose(true);
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div style={overlayStyle} onClick={() => onClose(false)}>
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 2 }}>Incremental cache refresh</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>
          Model &quot;{model?.name || '…'}&quot;
          {reportCount != null && reportCount > 0 && ` — shared by ${reportCount} report${reportCount === 1 ? '' : 's'}`}
        </div>
        {loadError ? (
          <div style={{ fontSize: 13, color: 'var(--state-danger)', marginBottom: 12 }}>{loadError}</div>
        ) : !model ? (
          <div style={{ fontSize: 13, color: 'var(--text-disabled)', marginBottom: 12 }}>Loading…</div>
        ) : dateDims.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
            This model has no date-typed dimension — flag a date column as a dimension
            in the model editor first.
          </div>
        ) : (
          <>
            <label style={labelStyle}>Date column (the rows&apos; business date)</label>
            <select
              value={dateColumn}
              onChange={(e) => {
                setDateColumn(e.target.value);
                // No date column → no window: the engine ignores one without
                // the other, so don't let the UI carry a phantom setting.
                if (!e.target.value) setMonths(0);
              }}
              style={{ ...inputStyle, marginBottom: 10 }}
            >
              <option value="">— none —</option>
              {dateDims.map((d) => (
                <option key={`${d.table}.${d.column}`} value={`${d.table}.${d.column}`}>{d.table}.{d.column}</option>
              ))}
            </select>
            <label style={labelStyle}>Window</label>
            <select
              value={months}
              onChange={(e) => setMonths(Number(e.target.value))}
              disabled={!dateColumn}
              style={{ ...inputStyle, marginBottom: 10 }}
            >
              <option value={0}>Off — full rebuild</option>
              {[...new Set([1, 3, 6, 12, ...(months ? [months] : [])])].sort((a, b) => a - b).map((m) => (
                <option key={m} value={m}>Last {m} month{m === 1 ? '' : 's'}</option>
              ))}
            </select>
            <div style={{ fontSize: 11, color: 'var(--text-disabled)', marginBottom: 8 }}>
              Each refresh re-queries only the window; older rows keep their cached
              values until a full rebuild (Off + refresh). Saving resets the cache.
            </div>
          </>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
          <button className="btn-hover" style={secondaryBtnStyle} onClick={() => onClose(false)}>Cancel</button>
          {model && dateDims.length > 0 && (
            <button
              className="btn-hover btn-hover-primary"
              style={{ ...primaryBtnStyle, opacity: isNoop ? 0.5 : 1, cursor: isNoop ? 'not-allowed' : 'pointer' }}
              onClick={save}
              disabled={saving || isNoop}
              title={isNoop ? 'Pick a date column and a window first — incremental refresh is already off' : undefined}
            >
              {saving ? 'Saving…' : (turnsOff && wasOn ? 'Disable incremental refresh' : 'Save')}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

const overlayStyle = {
  position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 300,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};
const panelStyle = {
  width: 460, maxWidth: '92vw', maxHeight: '90vh', overflowY: 'auto',
  background: 'var(--bg-panel)', border: '1px solid var(--border-default)',
  borderRadius: 10, padding: 20, boxShadow: '0 8px 30px rgba(0,0,0,0.2)',
};
const labelStyle = { display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4, fontWeight: 500 };
const inputStyle = {
  width: '100%', padding: '8px 10px', border: '1px solid var(--border-default)', borderRadius: 6,
  fontSize: 13, outline: 'none', boxSizing: 'border-box', background: 'var(--bg-panel)', color: 'var(--text-primary)',
};
const primaryBtnStyle = { padding: '8px 14px', fontSize: 13, fontWeight: 600, border: 'none', borderRadius: 6, background: 'var(--accent-primary)', color: '#fff' };
const secondaryBtnStyle = { padding: '8px 14px', fontSize: 13, background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border-default)', borderRadius: 6, cursor: 'pointer' };
