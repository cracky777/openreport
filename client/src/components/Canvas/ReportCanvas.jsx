import { useRef, useState, useEffect, useCallback, memo, useMemo } from 'react';
import Draggable from 'react-draggable';
import { WIDGET_TYPES } from '../Widgets';
import MaxRowsWarning from '../Widgets/MaxRowsWarning';

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

const WidgetItem = memo(function WidgetItem({ item, widget, isSelected, readOnly, onSelect, onDragStop, onStartResize, onAutoHeight, onLoadMore, onWidgetUpdate, onSlicerFilter, onCrossFilter, onDrillUp, onDrillReset, crossHighlight, snapGrid, reportFilters }) {
  const nodeRef = useRef(null);
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
          background: widget.config?.transparentBg
            ? 'transparent'
            : (buildGradientCSS(widget.config?.gradientBg) || widget.config?.backgroundColor || '#ffffff'),
          borderRadius: (widget.type === 'shape' && widget.config?.shape === 'round') ? '50%' : (widget.config?.borderRadius ?? 8),
          border: isSelected
            ? '2px solid #7c3aed'
            : (widget.config?.borderEnabled === false
                ? 'none'
                : `1px solid ${widget.config?.borderColor || '#e2e8f0'}`),
          boxShadow: [
            isSelected ? '0 0 0 3px rgba(124,58,237,0.15)' : null,
            buildShadowCSS(widget.config?.shadow),
            !isSelected && !widget.config?.shadow?.enabled && widget.config?.borderEnabled !== false ? '0 1px 3px rgba(0,0,0,0.05)' : null,
          ].filter(Boolean).join(', ') || 'none',
          overflow: widget.config?.shadow?.enabled ? 'visible' : 'hidden',
        }}>
        {widget.config?.title && (
          <div style={{ padding: '8px 12px 0', fontSize: 13, fontWeight: 600, color: '#475569' }}>
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

        {/* Loading spinner */}
        {widget._loading && (
          <div style={{
            position: 'absolute', top: 8, right: 40, zIndex: 10,
          }}>
            <div style={spinnerStyle} />
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
    if (viewMode === 'actual' || containerSize.w <= 0) return 1;
    if (viewMode === 'fitToWidth') return Math.min(1, containerSize.w / pageWidth);
    if (viewMode === 'fitToPage') return Math.min(1, containerSize.w / pageWidth, containerSize.h / canvasHeight);
    return 1;
  }, [viewMode, containerSize, pageWidth, canvasHeight]);

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
        backgroundColor: '#f1f5f9',
        overflowX: 'hidden',
        overflowY: viewMode === 'fitToPage' ? 'hidden' : 'auto',
        padding: 20,
        minWidth: 0, minHeight: 0,
      }}
    >
      {/* Scale wrapper — takes the visual size in the layout */}
      <div style={{
        width: scale < 1 ? pageWidth * scale : pageWidth,
        minHeight: scale < 1 ? canvasHeight * scale : canvasHeight,
        margin: '0 auto',
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
            backgroundColor: settings.transparentBg ? 'transparent' : (settings.backgroundColor || '#ffffff'),
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
  borderTopColor: '#7c3aed',
  borderRadius: '50%',
  animation: 'spin 0.8s linear infinite',
};

const drillBtnStyle = {
  width: 22, height: 22, padding: 0, lineHeight: 1,
  fontSize: 13, fontWeight: 600,
  color: '#475569', background: '#ffffff',
  border: '1px solid #e2e8f0', borderRadius: 4,
  cursor: 'pointer', boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
};
