import { useState } from 'react';
import api from '../../utils/api';

const _hs89 = {
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
      };
const _hs90 = {
          background: 'var(--bg-panel)', borderRadius: 8, padding: 20,
          width: 'min(900px, 92vw)', maxHeight: '85vh', overflow: 'auto',
          boxShadow: '0 16px 48px rgba(0,0,0,0.2)',
        };
const _hs91 = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 };
const _hs92 = { fontSize: 14, fontWeight: 600, margin: 0 };
const _hs93 = { color: 'var(--text-secondary)' };
const _hs94 = { display: 'flex', alignItems: 'center', gap: 10 };
const _hs95 = { background: 'transparent', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--text-muted)' };
const _hs96 = { fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 };
const _hs97 = { color: 'var(--text-muted)', fontSize: 13 };
const _hs98 = { color: 'var(--state-danger)', fontSize: 13 };
const _hs99 = { display: 'flex', gap: 24, marginBottom: 16, fontSize: 12, color: 'var(--text-secondary)', flexWrap: 'wrap', alignItems: 'center' };
const _hs100 = {
                fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5,
                padding: '3px 8px', borderRadius: 4,
                background: 'var(--bg-accent-soft)', color: 'var(--text-accent)',
              };
const _hs101 = { width: '100%', borderCollapse: 'collapse', fontSize: 12 };
const _hs102 = { borderBottom: '1px solid var(--border-default)', textAlign: 'left', color: 'var(--text-muted)' };
const _hs103 = { borderBottom: '1px solid var(--border-subtle)' };
const _hs104 = { color: 'var(--text-disabled)' };
const _hs105 = { color: 'var(--text-muted)', fontSize: 13 };
const cellStyle = { padding: '8px 10px', verticalAlign: 'top' };

function CacheInspectorModal({ reportId, reportTitle, workspaceId, canManage, data, loading, error, onClose, onCleared, formatBytes }) {
  const [clearing, setClearing] = useState(false);
  const [clearMsg, setClearMsg] = useState(null);
  const handleClearWorkspace = async () => {
    if (!workspaceId || clearing) return;
    if (!window.confirm(
      'Clear ALL cache (rollups + in-memory results) for every model used '
      + 'by this workspace’s reports?\n\nThe cache rebuilds on the next warm '
      + 'or query. A model shared with other workspaces will have its cache '
      + 'cleared too.'
    )) return;
    setClearing(true);
    setClearMsg(null);
    try {
      const res = await api.post(`/cache-schedules/clear-workspace/${workspaceId}`);
      const d = res.data || {};
      setClearMsg(`Cache cleared: ${d.clearedModels ?? 0} model(s), ${d.droppedRollups ?? 0} rollup(s) dropped.`);
      onCleared?.();
    } catch (err) {
      setClearMsg(err.response?.data?.error || err.message || 'Clear failed');
    } finally {
      setClearing(false);
    }
  };
  return (
    <div
      onClick={onClose}
      style={_hs89}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={_hs90}
      >
        <div style={_hs91}>
          <h3 style={_hs92}>
            Cache breakdown — <span style={_hs93}>{reportTitle || reportId.slice(0, 8)}</span>
          </h3>
          <div style={_hs94}>
            {canManage && workspaceId && (
              <button
                onClick={handleClearWorkspace}
                disabled={clearing}
                title="Drops all rollups + the in-memory cache for this workspace’s models"
                style={{
                  background: 'transparent', border: '1px solid var(--state-danger)',
                  color: 'var(--state-danger)', borderRadius: 6, padding: '5px 10px',
                  fontSize: 12, fontWeight: 600, cursor: clearing ? 'default' : 'pointer',
                  opacity: clearing ? 0.6 : 1,
                }}
              >
                {clearing ? 'Clearing…' : 'Clear workspace cache'}
              </button>
            )}
            <button onClick={onClose} style={_hs95}>×</button>
          </div>
        </div>
        {clearMsg && (
          <div style={_hs96}>{clearMsg}</div>
        )}

        {loading && <div style={_hs97}>Loading…</div>}
        {error && <div style={_hs98}>{error}</div>}

        {data && (
          <>
            <div style={_hs99}>
              <span style={_hs100}>
                {data.storageMode === 'source' ? 'Source DB' : 'Local disk (DuckDB)'}
              </span>
              <div>
                <strong>Rollup storage</strong>: {formatBytes(data.diskBytes)} on disk
                {' · '}{data.rollupCount} rollup{data.rollupCount === 1 ? '' : 's'}
                {' · '}{(data.totalRows || 0).toLocaleString()} rows
              </div>
            </div>

            {data.rollups?.length > 0 ? (
              <table style={_hs101}>
                <thead>
                  <tr style={_hs102}>
                    <th style={cellStyle} title="The dimensions this rollup is grouped by (display + drill + cross-filter + widget-own filter dims).">Dimensions (grain)</th>
                    <th style={{ ...cellStyle, textAlign: 'right' }}>#&nbsp;dims</th>
                    <th style={cellStyle} title="Measures recomposable from this rollup's stored additive components.">Measures</th>
                    <th style={cellStyle} title="The report's global filter bar values baked into this rollup at build time.">Global filter (baked)</th>
                    <th style={{ ...cellStyle, textAlign: 'right' }}>Rows</th>
                    <th style={{ ...cellStyle, textAlign: 'right' }} title="Estimated on-disk volume of this grain (row count × estimated row width).">Size</th>
                    <th style={{ ...cellStyle, textAlign: 'right' }}>Built</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rollups.map((r) => {
                    // Identifiers are fully qualified (schema.table.column)
                    // and blow out the table width — show only the last
                    // segment; the full path stays in the cell `title`.
                    const shortName = (s) => String(s).split('.').pop();
                    const dimsFull = (r.grainDims || []).join(' × ') || '(grand total)';
                    const dimsShort = (r.grainDims || []).map(shortName).join(' × ') || '(grand total)';
                    const measFull = (r.measures || []).join(', ');
                    const measShort = (r.measures || []).map(shortName).join(', ');
                    const bf = (r.baseFilters || []);
                    const bfLabel = bf.length === 0
                      ? '—'
                      : bf.map((f) => `${shortName(f.field)} (${(f.values || []).length})`).join(', ');
                    const built = r.builtAt ? new Date(r.builtAt).toLocaleString() : '—';
                    return (
                      <tr key={r.grainHash} style={_hs103}>
                        <td style={{ ...cellStyle, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace' }} title={dimsFull}>
                          {dimsShort}
                        </td>
                        <td style={{ ...cellStyle, textAlign: 'right' }}>{r.grainCount}</td>
                        <td style={{ ...cellStyle, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={measFull}>
                          {(r.measures || []).length} <span style={_hs104}>({measShort || '—'})</span>
                        </td>
                        <td style={{ ...cellStyle, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: bf.length ? 'inherit' : 'var(--text-disabled)' }}
                            title={bf.length ? bf.map((f) => `${f.field} ${f.op} [${(f.values || []).join(', ')}]`).join('\n') : 'No global filter baked'}>
                          {bfLabel}
                        </td>
                        <td style={{ ...cellStyle, textAlign: 'right' }}>{(r.rowCount || 0).toLocaleString()}</td>
                        <td style={{ ...cellStyle, textAlign: 'right', fontWeight: r.bytes > 1024 * 1024 ? 600 : 400 }}>{formatBytes(r.bytes || 0)}</td>
                        <td style={{ ...cellStyle, textAlign: 'right', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{built}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div style={_hs105}>
                No cache built yet for this report's model — click Refresh to build it.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default CacheInspectorModal;
