import { useRef, useState, useEffect, useCallback, memo } from 'react';
import Draggable from 'react-draggable';
import { WIDGET_TYPES } from '../Widgets';
import MaxRowsWarning from '../Widgets/MaxRowsWarning';

const WidgetItem = memo(function WidgetItem({ item, widget, isSelected, readOnly, onSelect, onDragStop, onStartResize, onAutoHeight, onLoadMore }) {
  const nodeRef = useRef(null);
  const WidgetType = WIDGET_TYPES[widget.type];
  if (!WidgetType) return null;

  const Component = WidgetType.component;
  const w = item.w || 400;
  const isAutoHeight = widget.type === 'table' && widget.config?.autoHeight;
  const h = isAutoHeight ? 'auto' : (item.h || 300);
  const titleHeight = widget.config?.title ? 30 : 0;
  const contentWidth = Math.max(50, (typeof w === 'number' ? w : 400) - 16);
  const contentHeight = Math.max(50, (typeof h === 'number' ? h : 300) - titleHeight - 16);

  return (
    <Draggable
      nodeRef={nodeRef}
      position={{ x: item.x || 0, y: item.y || 0 }}
      onStop={(e, data) => onDragStop(item.i, data)}
      disabled={readOnly}
      cancel=".widget-content, .resize-handle"
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
          background: widget.config?.backgroundColor || '#ffffff',
          borderRadius: widget.config?.borderRadius || 8,
          border: isSelected
            ? '2px solid #3b82f6'
            : `1px solid ${widget.config?.borderColor || '#e2e8f0'}`,
          boxShadow: isSelected
            ? '0 0 0 3px rgba(59,130,246,0.15)'
            : '0 1px 3px rgba(0,0,0,0.05)',
          cursor: readOnly ? 'default' : 'move',
          overflow: 'hidden',
        }}
      >
        {widget.config?.title && (
          <div style={{ padding: '8px 12px 0', fontSize: 13, fontWeight: 600, color: '#475569' }}>
            {widget.config.title}
          </div>
        )}
        <div className="widget-content" style={{
          padding: 8,
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
            onLoadMore={widget.type === 'table' ? () => onLoadMore?.(item.i) : undefined}
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

        {/* Max rows warning */}
        {widget.data?._maxReached && <MaxRowsWarning />}

        {/* Resize handle - bottom right corner */}
        {!readOnly && (
          <div
            className="resize-handle"
            onMouseDown={(e) => onStartResize(e, item.i)}
            style={{
              position: 'absolute',
              bottom: 0,
              right: 0,
              width: 20,
              height: 20,
              cursor: 'se-resize',
              zIndex: 10,
            }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10"
              style={{ position: 'absolute', bottom: 4, right: 4 }}>
              <line x1="9" y1="1" x2="1" y2="9" stroke={isSelected ? '#3b82f6' : '#94a3b8'} strokeWidth="1.5" />
              <line x1="9" y1="5" x2="5" y2="9" stroke={isSelected ? '#3b82f6' : '#94a3b8'} strokeWidth="1.5" />
            </svg>
          </div>
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
}) {
  const [resizing, setResizing] = useState(null);

  const pageWidth = settings.pageWidth || 1140;
  const pageHeight = settings.pageHeight || 800;

  const canvasHeight = (() => {
    const maxBottom = layout.length > 0
      ? Math.max(...layout.map((item) => (item.y || 0) + (item.h || 300)))
      : 0;
    return Math.max(pageHeight, maxBottom + 300);
  })();

  const handleDragStop = useCallback((id, data) => {
    onLayoutChange(layout.map((item) =>
      item.i === id ? { ...item, x: Math.max(0, data.x), y: Math.max(0, data.y) } : item
    ));
  }, [layout, onLayoutChange]);

  const handleAutoHeight = useCallback((id, newH) => {
    onLayoutChange(layout.map((item) =>
      item.i === id ? { ...item, h: newH } : item
    ));
  }, [layout, onLayoutChange]);

  useEffect(() => {
    if (!resizing) return;

    const handleMouseMove = (e) => {
      const dx = e.clientX - resizing.startX;
      const dy = e.clientY - resizing.startY;
      const newW = Math.max(80, resizing.startW + dx);
      const newH = Math.max(40, resizing.startH + dy);

      onLayoutChange(layout.map((item) =>
        item.i === resizing.id ? { ...item, w: newW, h: newH } : item
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

  const startResize = useCallback((e, id) => {
    e.stopPropagation();
    e.preventDefault();
    const item = layout.find((l) => l.i === id);
    if (!item) return;
    setResizing({
      id,
      startW: item.w || 400,
      startH: item.h || 300,
      startX: e.clientX,
      startY: e.clientY,
    });
  }, [layout]);

  return (
    <div
      onClick={() => onSelectWidget?.(null)}
      style={{
        flex: 1,
        backgroundColor: '#f1f5f9',
        overflow: 'auto',
        padding: 20,
      }}
    >
      <div
        style={{
          width: pageWidth,
          minWidth: pageWidth,
          margin: '0 auto',
          minHeight: canvasHeight,
          backgroundColor: settings.backgroundColor || '#ffffff',
          backgroundImage: settings.backgroundImage ? `url(${settings.backgroundImage})` : 'none',
          backgroundSize: settings.backgroundSize || 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: settings.backgroundSize === 'repeat' ? 'repeat' : 'no-repeat',
          borderRadius: 8,
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          position: 'relative',
        }}
      >
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
            />
          );
        })}
      </div>
    </div>
  );
}

const spinnerStyle = {
  width: 16,
  height: 16,
  border: '2px solid #e2e8f0',
  borderTopColor: '#3b82f6',
  borderRadius: '50%',
  animation: 'spin 0.8s linear infinite',
};
