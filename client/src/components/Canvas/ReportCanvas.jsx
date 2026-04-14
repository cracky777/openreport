import { useMemo } from 'react';
import GridLayout from 'react-grid-layout';
import { WIDGET_TYPES } from '../Widgets';
import 'react-grid-layout/css/styles.css';

const COLS = 12;
const ROW_HEIGHT = 80;

export default function ReportCanvas({
  layout,
  widgets,
  selectedWidget,
  onLayoutChange,
  onSelectWidget,
  readOnly,
}) {
  const gridItems = useMemo(() => {
    return layout.map((item) => {
      const widget = widgets[item.i];
      if (!widget) return null;

      const WidgetType = WIDGET_TYPES[widget.type];
      if (!WidgetType) return null;

      const Component = WidgetType.component;
      const isSelected = selectedWidget === item.i;

      return (
        <div
          key={item.i}
          onClick={(e) => {
            e.stopPropagation();
            onSelectWidget?.(item.i);
          }}
          style={{
            background: widget.config?.backgroundColor || '#ffffff',
            borderRadius: widget.config?.borderRadius || 8,
            border: isSelected
              ? '2px solid #3b82f6'
              : `1px solid ${widget.config?.borderColor || '#e2e8f0'}`,
            boxShadow: isSelected
              ? '0 0 0 3px rgba(59,130,246,0.15)'
              : '0 1px 3px rgba(0,0,0,0.05)',
            overflow: 'hidden',
            cursor: readOnly ? 'default' : 'move',
          }}
        >
          {widget.config?.title && (
            <div
              style={{
                padding: '8px 12px 0',
                fontSize: 13,
                fontWeight: 600,
                color: '#475569',
              }}
            >
              {widget.config.title}
            </div>
          )}
          <div style={{ padding: 8, height: widget.config?.title ? 'calc(100% - 30px)' : '100%' }}>
            <Component data={widget.data} config={widget.config} />
          </div>
        </div>
      );
    });
  }, [layout, widgets, selectedWidget, onSelectWidget, readOnly]);

  return (
    <div
      onClick={() => onSelectWidget?.(null)}
      style={{
        flex: 1,
        backgroundColor: '#f1f5f9',
        minHeight: '100%',
        padding: 20,
      }}
    >
      <div
        style={{
          backgroundColor: '#ffffff',
          minHeight: 800,
          borderRadius: 8,
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          padding: 10,
        }}
      >
        <GridLayout
          className="layout"
          layout={layout}
          cols={COLS}
          rowHeight={ROW_HEIGHT}
          width={1140}
          isDraggable={!readOnly}
          isResizable={!readOnly}
          onLayoutChange={onLayoutChange}
          compactType={null}
          preventCollision
          margin={[10, 10]}
        >
          {gridItems}
        </GridLayout>
      </div>
    </div>
  );
}
