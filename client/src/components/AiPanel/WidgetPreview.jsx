import { useState, useRef, useEffect } from 'react';
import { WIDGET_TYPES } from '../Widgets';
import { useWidgetPreview } from '../../hooks/useWidgetPreview';
import { chartTable } from '../../utils/chartTable';

const PREVIEW_HEIGHTS = { scorecard: 90, gauge: 150, table: 200, pivotTable: 200 };
const DEFAULT_HEIGHT = 180;
const boxStyle = { border: '1px solid var(--border-default)', borderRadius: 6, background: 'var(--bg-panel)', overflow: 'hidden' };
const noteStyle = {
  fontSize: 11, color: 'var(--text-muted)', wordBreak: 'break-word', height: '100%',
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 8, textAlign: 'center',
};

// The proposed visual itself, drawn by the component the canvas will use, on
// the rows the canvas will get. Read-only: no handler is wired, so clicking a
// bar in a proposal cannot cross-filter the page behind it.
// The page's dressing has no rows to fetch: drawn as it is, on its own data.
const DECOR = new Set(['text', 'shape', 'image']);
const DECOR_HEIGHT = 60;
const tableWrap = { height: '100%', overflow: 'auto' };
const tableStyle = { width: '100%', borderCollapse: 'collapse', fontSize: 12 };
const thStyle = (numeric) => ({ position: 'sticky', top: 0, padding: '6px 10px', textAlign: numeric ? 'right' : 'left', fontWeight: 600, color: 'var(--text-secondary)', background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border-default)', whiteSpace: 'nowrap' });
const tdStyle = (numeric) => ({ padding: '5px 10px', textAlign: numeric ? 'right' : 'left', color: 'var(--text-primary)', borderBottom: '1px solid var(--border-default)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' });

// The chart's numbers as a table (`asTable`): the rows and the series it draws,
// from its own data — the year before, a variance, a combo's line included.
function DataTable({ table }) {
  return (
    <div style={tableWrap}>
      <table style={tableStyle}>
        <thead><tr>{table.columns.map((c, i) => <th key={i} style={thStyle(c.numeric)}>{c.label}</th>)}</tr></thead>
        <tbody>{table.rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} style={tdStyle(table.columns[j]?.numeric)}>{v}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export default function WidgetPreview({ widget, model, reportId, settings, height, asTable = false }) {
  const boxRef = useRef(null);
  const [width, setWidth] = useState(0);
  const decor = DECOR.has(widget.type);
  const fetched = useWidgetPreview(widget, { model, reportId, settings, enabled: !decor });
  const { data, loading, error } = decor ? { data: { ...(widget.data || {}), _rowCount: 1 }, loading: false, error: null } : fetched;
  const h = height || (decor ? DECOR_HEIGHT : PREVIEW_HEIGHTS[widget.type] || DEFAULT_HEIGHT);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const Component = WIDGET_TYPES[widget.type]?.component;
  let body = null;
  if (loading) body = <div style={noteStyle}>Loading preview…</div>;
  else if (error) body = <div style={noteStyle}>Preview unavailable: {error}</div>;
  else if (!data?._rowCount) body = <div style={noteStyle}>No rows for this selection</div>;
  else if (asTable && chartTable(data, widget.config?.xAxisTitle)) body = <DataTable table={chartTable(data, widget.config?.xAxisTitle)} />;
  else if (Component && width > 0) {
    body = <Component data={data} config={widget.config || {}} chartWidth={width} chartHeight={h} columnOrder={widget.dataBinding?.columnOrder} editable={false} />;
  }
  return <div ref={boxRef} aria-label="Visual preview" style={{ ...boxStyle, height: h }}>{body}</div>;
}
