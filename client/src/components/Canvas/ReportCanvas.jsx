import { useRef, useState, useEffect, useCallback, memo, useMemo } from 'react';
import { createPortal } from 'react-dom';
import Draggable from 'react-draggable';
import { TbCode, TbX, TbCopy } from 'react-icons/tb';
import { WIDGET_TYPES } from '../Widgets';
import MaxRowsWarning from '../Widgets/MaxRowsWarning';
import { evaluateColorCondition } from '../../utils/conditionalFormat';

function buildGradientCSS(g) {
  if (!g?.enabled) return null;
  return `linear-gradient(${g.angle ?? 180}deg, ${g.color1 || '#ffffff'}, ${g.color2 || '#e2e8f0'})`;
}

function buildShadowCSS(s) {
  if (!s?.enabled) return null;
  const angleRad = ((s.angle ?? 135) * Math.PI) / 180;
  const dist = (s.blur ?? 10) / 2;
  const x = Math.round(Math.cos(angleRad) * dist);
  const y = Math.round(Math.sin(angleRad) * dist);
  const inset = s.type === 'inner' ? 'inset ' : '';
  return `${inset}${x}px ${y}px ${s.blur ?? 10}px ${s.spread ?? 2}px ${s.color || 'rgba(0,0,0,0.15)'}`;
}

const WidgetItem = memo(function WidgetItem({ item, widget, isSelected, readOnly, onSelect, onDragStop, onStartResize, onAutoHeight, onLoadMore, onWidgetUpdate, onSlicerFilter, onCrossFilter, onDrillUp, onDrillReset, crossHighlight, snapGrid, reportFilters, editInteractionsActive, isExcludedFromSource, onToggleCrossFilter, onCancelFetch }) {
  const nodeRef = useRef(null);
  const [showSql, setShowSql] = useState(false);
  const WidgetType = WIDGET_TYPES[widget.type];
  if (!WidgetType) return null;

  const Component = WidgetType.component;
  const w = item.w || 400;
  const isAutoHeight = widget.type === 'table' && widget.config?.autoHeight;
  const h = isAutoHeight ? 'auto' : (item.h || 300);
  const titleHeight = widget.config?.title ? 30 : 0;
  // Filter widgets use tighter padding (4px vs 8px) for a more compact look
  const contentPadding = widget.type === 'filter' ? 2 : 8;
  const paddingTotal = contentPadding * 2;
  const contentWidth = Math.max(50, (typeof w === 'number' ? w : 400) - paddingTotal);
  const contentHeight = Math.max(50, (typeof h === 'number' ? h : 300) - titleHeight - paddingTotal);

  return (
    <Draggable
      nodeRef={nodeRef}
      position={{ x: item.x || 0, y: item.y || 0 }}
      onStop={(e, data) => onDragStop(item.i, data)}
      disabled={readOnly}
      cancel=".widget-content, .resize-handle"
      grid={snapGrid}
    >
      <div
        ref={nodeRef}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(item.i);
        }}
        style={{
          position: 'absolute',
          width: w,
          height: h,
          zIndex: Math.max(1, item.z || 1),
          cursor: readOnly ? 'default' : 'move',
        }}
      >
        <div style={{
          width: '100%', height: '100%',
          transform: widget.config?.rotation ? `rotate(${widget.config.rotation}deg)` : undefined,
          transformOrigin: 'center center',
          background: (() => {
            // Conditional formatting (driven by colorMeasure binding) takes priority
            // over the static container background settings when a rule matches.
            const cc = widget.config?.colorCondition;
            const cond = cc?.enabled ? evaluateColorCondition(cc, widget.data?._colorValue) : null;
            if (cond) return cond;
            return widget.config?.transparentBg
              ? 'transparent'
              : (buildGradientCSS(widget.config?.gradientBg) || widget.config?.backgroundColor || (widget.type === 'filter' ? 'transparent' : 'var(--bg-panel)'));
          })(),
          borderRadius: (widget.type === 'shape' && widget.config?.shape === 'round') ? '50%' : (widget.config?.borderRadius ?? 8),
          border: isSelected
            ? '2px solid var(--accent-primary)'
            : (widget.config?.borderEnabled === false
                ? 'none'
                : `1px solid ${widget.config?.borderColor || 'var(--border-default)'}`),
          boxShadow: [
            isSelected ? '0 0 0 3px rgba(124,58,237,0.15)' : null,
            buildShadowCSS(widget.config?.shadow),
            !isSelected && !widget.config?.shadow?.enabled && widget.config?.borderEnabled !== false ? '0 1px 3px rgba(0,0,0,0.05)' : null,
          ].filter(Boolean).join(', ') || 'none',
          overflow: widget.config?.shadow?.enabled ? 'visible' : 'hidden',
        }}>
        {widget.config?.title && (
          <div style={{ padding: '8px 12px 0', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
            {widget.config.title}
          </div>
        )}
        {/* Drag overlay: allows dragging from borders/edges of the widget */}
        {!readOnly && (
          <>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 8 + (widget.config?.title ? 30 : 0), cursor: 'move', zIndex: 2 }} />
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 8, cursor: 'move', zIndex: 2 }} />
            <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: 8, cursor: 'move', zIndex: 2 }} />
            <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 8, cursor: 'move', zIndex: 2 }} />
          </>
        )}
        <div className="widget-content" style={{
          padding: contentPadding,
          width: contentWidth,
          height: contentHeight,
          overflow: 'hidden',
          cursor: 'default',
        }}>
          <Component
            data={widget.data}
            config={widget.config}
            chartWidth={contentWidth}
            chartHeight={contentHeight}
            onAutoHeight={isAutoHeight ? (newH) => onAutoHeight(item.i, newH) : undefined}
            columnOrder={widget.dataBinding?.columnOrder}
            onLoadMore={widget.type === 'table' ? () => onLoadMore?.(item.i) : undefined}
            onConfigUpdate={onWidgetUpdate ? (key, val) => onWidgetUpdate(item.i, { ...widget, config: { ...widget.config, [key]: val } }) : undefined}
            onFilterChange={widget.type === 'filter' && onSlicerFilter ? (vals) => {
              const dimName = widget.dataBinding?.selectedDimensions?.[0];
              if (dimName) onSlicerFilter(item.i, dimName, vals);
            } : undefined}
            activeSelection={widget.type === 'filter' && reportFilters ? reportFilters[widget.dataBinding?.selectedDimensions?.[0]] : undefined}
            onDataClick={onCrossFilter ? (dimName, value) => onCrossFilter(item.i, dimName, value) : undefined}
            highlightValue={crossHighlight?.widgetId === item.i ? crossHighlight.value : null}
          />
        </div>

        {/* Loading spinner + Cancel button. The cancel aborts the in-flight
            fetch so the user isn't stuck with a permanent spinner on a slow
            query. */}
        {widget._loading && (
          <div style={{ position: 'absolute', top: 6, right: 38, zIndex: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={spinnerStyle} />
            {!readOnly && onCancelFetch && (
              <button
                onClick={(e) => { e.stopPropagation(); onCancelFetch(); }}
                title="Cancel query"
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  height: 22, padding: '0 8px', borderRadius: 11,
                  fontSize: 11, fontWeight: 500,
                  background: 'var(--bg-panel)', color: 'var(--state-danger)',
                  border: '1px solid var(--state-danger)', cursor: 'pointer',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                }}
              >
                Cancel
              </button>
            )}
          </div>
        )}

        {/* "View SQL" — small icon button on selected widgets that hit the
            query API. Opens a portal modal showing the raw SQL. Hidden in
            read-only mode, during Edit Interactions, and on widgets that
            don't query (text / shape / filter / custom visual). */}
        {isSelected && !readOnly && !editInteractionsActive
          && !['text', 'shape', 'filter', 'customVisual'].includes(widget.type) && (
          <button
            onClick={(e) => { e.stopPropagation(); setShowSql(true); }}
            title="View the SQL query"
            style={{
              position: 'absolute', top: 6, right: 6, zIndex: 11,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 24, height: 24, borderRadius: 12, padding: 0,
              border: '1px solid var(--border-default)', background: 'var(--bg-panel)',
              color: 'var(--text-secondary)', cursor: 'pointer',
              boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-primary)'; e.currentTarget.style.borderColor = 'var(--accent-primary)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'var(--border-default)'; }}
          >
            <TbCode size={14} />
          </button>
        )}
        {showSql && createPortal(
          <SqlViewerModal sql={widget.data?._sql} onClose={() => setShowSql(false)} />,
          document.body,
        )}

        {/* Edit Interactions overlay — appears on every non-source widget while
            the user is configuring which targets a click on the source filters. */}
        {editInteractionsActive && onToggleCrossFilter && (
          <div
            onClick={(e) => { e.stopPropagation(); onToggleCrossFilter(item.i); }}
            style={{
              position: 'absolute', top: 6, right: 6, zIndex: 12,
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '4px 8px', borderRadius: 16, fontSize: 11, fontWeight: 600,
              background: isExcludedFromSource ? 'var(--bg-panel)' : 'var(--accent-primary)',
              color: isExcludedFromSource ? 'var(--text-secondary)' : '#fff',
              border: `1px solid ${isExcludedFromSource ? 'var(--border-default)' : 'var(--accent-primary)'}`,
              cursor: 'pointer', userSelect: 'none',
              boxShadow: '0 2px 6px rgba(0,0,0,0.12)',
            }}
            title={isExcludedFromSource ? 'Click to enable cross-filter from the selected widget' : 'Click to disable cross-filter from the selected widget'}
          >
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: isExcludedFromSource ? 'var(--text-disabled)' : '#fff' }} />
            {isExcludedFromSource ? 'None' : 'Filter'}
          </div>
        )}

        {/* Drill-down controls (up / reset) — shown when widget has an active drill path */}
        {widget.data?._drillDepth > 0 && (onDrillUp || onDrillReset) && (
          <div style={{
            position: 'absolute', top: 6, left: 6, zIndex: 11,
            display: 'flex', gap: 2, pointerEvents: 'auto',
          }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {onDrillUp && (
              <button
                title="Drill up"
                onClick={(e) => { e.stopPropagation(); onDrillUp(item.i); }}
                style={drillBtnStyle}
              >↑</button>
            )}
            {onDrillReset && (
              <button
                title="Reset drill"
                onClick={(e) => { e.stopPropagation(); onDrillReset(item.i); }}
                style={drillBtnStyle}
              >⟲</button>
            )}
          </div>
        )}

        {/* Max rows warning */}
        {widget.data?._maxReached && <MaxRowsWarning />}

        {/* Query error overlay — shown when the widget's last fetch failed (e.g. missing table/column after datasource change) */}
        {widget.data?._error && !widget._loading && widget.type !== 'text' && widget.type !== 'shape' && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 6,
            background: 'var(--state-danger-soft)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            padding: 16, textAlign: 'center', gap: 6,
            borderRadius: 'inherit', pointerEvents: 'none',
          }}>
            <div style={{ fontSize: 22 }}>⚠️</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--state-danger)' }}>Data error</div>
            <div style={{ fontSize: 11, color: 'var(--state-danger)', maxWidth: 280, lineHeight: 1.4, wordBreak: 'break-word' }}>
              {widget.data._error}
            </div>
            <div style={{ fontSize: 10, color: 'var(--state-danger)', marginTop: 4 }}>
              Check the model — a referenced field may have been removed or renamed.
            </div>
          </div>
        )}
        </div>{/* end rotation wrapper */}

        {/* Resize handles — all edges and corners, only when selected */}
        {!readOnly && isSelected && (
          <>
            {/* Edges */}
            <div className="resize-handle" onMouseDown={(e) => onStartResize(e, item.i, 'n')}
              style={{ position: 'absolute', top: -3, left: 6, right: 6, height: 6, cursor: 'n-resize', zIndex: 10 }} />
            <div className="resize-handle" onMouseDown={(e) => onStartResize(e, item.i, 's')}
              style={{ position: 'absolute', bottom: -3, left: 6, right: 6, height: 6, cursor: 's-resize', zIndex: 10 }} />
            <div className="resize-handle" onMouseDown={(e) => onStartResize(e, item.i, 'w')}
              style={{ position: 'absolute', left: -3, top: 6, bottom: 6, width: 6, cursor: 'w-resize', zIndex: 10 }} />
            <div className="resize-handle" onMouseDown={(e) => onStartResize(e, item.i, 'e')}
              style={{ position: 'absolute', right: -3, top: 6, bottom: 6, width: 6, cursor: 'e-resize', zIndex: 10 }} />
            {/* Corners */}
            <div className="resize-handle" onMouseDown={(e) => onStartResize(e, item.i, 'nw')}
              style={{ position: 'absolute', top: -3, left: -3, width: 8, height: 8, cursor: 'nw-resize', zIndex: 11 }} />
            <div className="resize-handle" onMouseDown={(e) => onStartResize(e, item.i, 'ne')}
              style={{ position: 'absolute', top: -3, right: -3, width: 8, height: 8, cursor: 'ne-resize', zIndex: 11 }} />
            <div className="resize-handle" onMouseDown={(e) => onStartResize(e, item.i, 'sw')}
              style={{ position: 'absolute', bottom: -3, left: -3, width: 8, height: 8, cursor: 'sw-resize', zIndex: 11 }} />
            <div className="resize-handle" onMouseDown={(e) => onStartResize(e, item.i, 'se')}
              style={{ position: 'absolute', bottom: -3, right: -3, width: 8, height: 8, cursor: 'se-resize', zIndex: 11 }} />
          </>
        )}
      </div>
    </Draggable>
  );
});

export default function ReportCanvas({
  layout,
  widgets,
  selectedWidget,
  onLayoutChange,
  onSelectWidget,
  readOnly,
  settings = {},
  onLoadMore,
  onWidgetUpdate,
  reportFilters,
  onSlicerFilter,
  onCrossFilter,
  onDrillUp,
  onDrillReset,
  crossHighlight,
  reportRef,
  editInteractions,
  onToggleCrossFilter,
  onCancelFetch,
  // Print mode strips the surrounding chrome (outer padding + bg-app
  // background + auto-margin centering + fit-to-width scale) so a server
  // -side Puppeteer renderer can capture just the report canvas at its
  // native dimensions.
  printMode,
}) {
  const [resizing, setResizing] = useState(null);
  const containerRef = useRef(null);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });

  // Track container size for fit modes
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerSize({ w: el.clientWidth - 40, h: el.clientHeight - 40 });
    update(); // Initial measurement
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pageWidth = settings.pageWidth || 1140;
  const pageHeight = settings.pageHeight || 800;
  const viewMode = settings.viewMode || 'fitToWidth';

  const canvasHeight = pageHeight;

  const scale = useMemo(() => {
    if (printMode) return 1;
    if (viewMode === 'actual' || containerSize.w <= 0) return 1;
    if (viewMode === 'fitToWidth') return Math.min(1, containerSize.w / pageWidth);
    if (viewMode === 'fitToPage') return Math.min(1, containerSize.w / pageWidth, containerSize.h / canvasHeight);
    return 1;
  }, [viewMode, containerSize, pageWidth, canvasHeight, printMode]);

  const gridSize = (settings.snapToGrid ?? true) ? (settings.gridSize || 20) : 1;
  const snap = useCallback((v) => Math.round(v / gridSize) * gridSize, [gridSize]);
  const snapGrid = (settings.snapToGrid ?? true) ? [gridSize, gridSize] : undefined;

  const handleDragStop = useCallback((id, data) => {
    onLayoutChange(layout.map((item) =>
      item.i === id ? { ...item, x: Math.max(0, snap(data.x)), y: Math.max(0, snap(data.y)) } : item
    ));
  }, [layout, onLayoutChange, snap]);

  const handleAutoHeight = useCallback((id, newH) => {
    onLayoutChange(layout.map((item) =>
      item.i === id ? { ...item, h: newH } : item
    ));
  }, [layout, onLayoutChange]);

  useEffect(() => {
    if (!resizing) return;
    const { dir } = resizing;

    const handleMouseMove = (e) => {
      const dx = e.clientX - resizing.startX;
      const dy = e.clientY - resizing.startY;
      const updates = {};

      // Width changes (snap to grid)
      if (dir.includes('e')) updates.w = Math.max(80, snap(resizing.startW + dx));
      if (dir.includes('w')) { updates.w = Math.max(80, snap(resizing.startW - dx)); updates.x = snap(resizing.startPosX + dx); if (updates.w <= 80) updates.x = resizing.startPosX + resizing.startW - 80; }

      // Height changes (snap to grid)
      if (dir.includes('s')) updates.h = Math.max(40, snap(resizing.startH + dy));
      if (dir.includes('n')) { updates.h = Math.max(40, snap(resizing.startH - dy)); updates.y = snap(resizing.startPosY + dy); if (updates.h <= 40) updates.y = resizing.startPosY + resizing.startH - 40; }

      onLayoutChange(layout.map((item) =>
        item.i === resizing.id ? { ...item, ...updates } : item
      ));
    };

    const handleMouseUp = () => setResizing(null);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizing, layout, onLayoutChange]);

  const startResize = useCallback((e, id, dir = 'se') => {
    e.stopPropagation();
    e.preventDefault();
    const item = layout.find((l) => l.i === id);
    if (!item) return;
    setResizing({
      id, dir,
      startW: item.w || 400,
      startH: item.h || 300,
      startX: e.clientX,
      startY: e.clientY,
      startPosX: item.x || 0,
      startPosY: item.y || 0,
    });
  }, [layout]);

  return (
    <div
      ref={containerRef}
      onClick={() => onSelectWidget?.(null)}
      style={{
        flex: 1,
        backgroundColor: printMode ? 'transparent' : 'var(--bg-app)',
        overflowX: 'hidden',
        overflowY: viewMode === 'fitToPage' || printMode ? 'hidden' : 'auto',
        padding: printMode ? 0 : 20,
        minWidth: 0, minHeight: 0,
      }}
    >
      {/* Scale wrapper — takes the visual size in the layout */}
      <div style={{
        width: scale < 1 ? pageWidth * scale : pageWidth,
        minHeight: scale < 1 ? canvasHeight * scale : canvasHeight,
        margin: printMode ? 0 : '0 auto',
        overflow: 'visible',
      }}>
        <div
          ref={reportRef}
          style={{
            width: pageWidth,
            minWidth: pageWidth,
            minHeight: canvasHeight,
            transform: scale < 1 ? `scale(${scale})` : undefined,
            transformOrigin: 'top left',
            backgroundColor: settings.transparentBg ? 'transparent' : (settings.backgroundColor || 'var(--bg-canvas)'),
            backgroundImage: !settings.transparentBg && settings.backgroundImage ? `url(${settings.backgroundImage})` : 'none',
            backgroundSize: settings.backgroundSize || 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: settings.backgroundSize === 'repeat' ? 'repeat' : 'no-repeat',
            borderRadius: settings.borderRadius ?? 8,
            boxShadow: (settings.showShadow ?? true) ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            border: (settings.showBorder ?? true) ? undefined : 'none',
            position: 'relative',
          }}
        >
        {/* Grid overlay */}
        {settings.showGrid && !readOnly && (
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            backgroundImage: `linear-gradient(rgba(0,0,0,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.05) 1px, transparent 1px)`,
            backgroundSize: `${settings.gridSize || 20}px ${settings.gridSize || 20}px`,
            pointerEvents: 'none', zIndex: 0, borderRadius: settings.borderRadius ?? 8,
          }} />
        )}
        {layout.map((item) => {
          const widget = widgets[item.i];
          if (!widget) return null;
          if (!WIDGET_TYPES[widget.type]) return null;

          // Show the Edit Interactions overlay on every widget except the
          // currently-selected source. The overlay reads the source's
          // `crossFilterExclusions` to render its filter / off state.
          const editInteractionsActive = editInteractions && selectedWidget && selectedWidget !== item.i;
          const sourceWidget = selectedWidget ? widgets[selectedWidget] : null;
          const sourceExclusions = sourceWidget?.config?.crossFilterExclusions || [];
          const isExcludedFromSource = sourceExclusions.includes(item.i);

          return (
            <WidgetItem
              key={item.i}
              item={item}
              widget={widget}
              isSelected={selectedWidget === item.i}
              readOnly={readOnly}
              onSelect={onSelectWidget}
              onDragStop={handleDragStop}
              onStartResize={startResize}
              onAutoHeight={handleAutoHeight}
              onLoadMore={onLoadMore}
              onWidgetUpdate={onWidgetUpdate}
              onSlicerFilter={onSlicerFilter}
              onCrossFilter={onCrossFilter}
              onDrillUp={onDrillUp}
              onDrillReset={onDrillReset}
              crossHighlight={crossHighlight}
              snapGrid={snapGrid}
              reportFilters={reportFilters}
              editInteractionsActive={editInteractionsActive}
              isExcludedFromSource={isExcludedFromSource}
              onToggleCrossFilter={onToggleCrossFilter}
              onCancelFetch={onCancelFetch}
            />
          );
        })}
        </div>
      </div>
    </div>
  );
}

const spinnerStyle = {
  width: 16,
  height: 16,
  border: '2px solid #e2e8f0',
  borderTopColor: 'var(--accent-primary)',
  borderRadius: '50%',
  animation: 'spin 0.8s linear infinite',
};

const drillBtnStyle = {
  width: 22, height: 22, padding: 0, lineHeight: 1,
  fontSize: 13, fontWeight: 600,
  color: 'var(--text-secondary)', background: 'var(--bg-panel)',
  border: '1px solid var(--border-default)', borderRadius: 4,
  cursor: 'pointer', boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
};

function SqlViewerModal({ sql, onClose }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(sql || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked — silently ignore */ }
  };
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: 'var(--bg-panel)', border: '1px solid var(--border-default)', borderRadius: 10,
        width: 'min(720px, 92vw)', maxHeight: '80vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
      }}>
        <div style={{
          padding: '12px 14px', borderBottom: '1px solid var(--border-default)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>SQL query</span>
          <span style={{ flex: 1 }} />
          <button onClick={handleCopy} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '5px 10px', fontSize: 12, fontWeight: 500,
            background: copied ? 'var(--state-success-soft)' : 'var(--bg-subtle)',
            color: copied ? 'var(--state-success)' : 'var(--text-secondary)',
            border: '1px solid var(--border-default)', borderRadius: 6, cursor: 'pointer',
          }}>
            <TbCopy size={13} />
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button onClick={onClose} style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 26, height: 26, padding: 0, borderRadius: 6,
            background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-disabled)',
          }}>
            <TbX size={14} />
          </button>
        </div>
        <pre style={{
          margin: 0, padding: 14, overflow: 'auto', flex: 1,
          fontSize: 12, lineHeight: 1.5,
          fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
          color: 'var(--text-primary)', background: 'var(--bg-subtle)',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          {sql || '(no SQL captured for this widget)'}
        </pre>
      </div>
    </div>
  );
}
