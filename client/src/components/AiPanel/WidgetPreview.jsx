import { useState, useRef, useEffect } from 'react';
import { WIDGET_TYPES } from '../Widgets';
import { useWidgetPreview } from '../../hooks/useWidgetPreview';

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
export default function WidgetPreview({ widget, model, reportId, settings, height }) {
  const boxRef = useRef(null);
  const [width, setWidth] = useState(0);
  const { data, loading, error } = useWidgetPreview(widget, { model, reportId, settings });
  const h = height || PREVIEW_HEIGHTS[widget.type] || DEFAULT_HEIGHT;

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
  else if (Component && width > 0) {
    body = <Component data={data} config={widget.config || {}} chartWidth={width} chartHeight={h} columnOrder={widget.dataBinding?.columnOrder} editable={false} />;
  }
  return <div ref={boxRef} aria-label="Visual preview" style={{ ...boxStyle, height: h }}>{body}</div>;
}
