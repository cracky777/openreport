import { WIDGET_TYPES } from '../Widgets';

export default function PropertyPanel({ widgetId, widget, onUpdate, onDelete }) {
  if (!widgetId || !widget) {
    return (
      <div style={panelStyle}>
        <div style={{ color: '#94a3b8', textAlign: 'center', marginTop: 40 }}>
          Select a widget to edit its properties
        </div>
      </div>
    );
  }

  const updateConfig = (key, value) => {
    onUpdate(widgetId, {
      ...widget,
      config: { ...widget.config, [key]: value },
    });
  };

  const updateData = (key, value) => {
    onUpdate(widgetId, {
      ...widget,
      data: { ...widget.data, [key]: value },
    });
  };

  const widgetMeta = WIDGET_TYPES[widget.type];

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>
        <span>{widgetMeta?.icon} {widgetMeta?.label}</span>
        <button onClick={() => onDelete(widgetId)} style={deleteStyle}>Delete</button>
      </div>

      <Section title="Title">
        <input
          type="text"
          value={widget.config?.title || ''}
          onChange={(e) => updateConfig('title', e.target.value)}
          placeholder="Widget title"
          style={inputStyle}
        />
      </Section>

      <Section title="Style">
        <Field label="Background">
          <input
            type="color"
            value={widget.config?.backgroundColor || '#ffffff'}
            onChange={(e) => updateConfig('backgroundColor', e.target.value)}
          />
        </Field>
        <Field label="Border color">
          <input
            type="color"
            value={widget.config?.borderColor || '#e2e8f0'}
            onChange={(e) => updateConfig('borderColor', e.target.value)}
          />
        </Field>
        <Field label="Border radius">
          <input
            type="range"
            min={0}
            max={24}
            value={widget.config?.borderRadius || 8}
            onChange={(e) => updateConfig('borderRadius', parseInt(e.target.value))}
          />
        </Field>
        {(widget.type === 'bar' || widget.type === 'line') && (
          <Field label="Color">
            <input
              type="color"
              value={widget.config?.color || '#5470c6'}
              onChange={(e) => updateConfig('color', e.target.value)}
            />
          </Field>
        )}
      </Section>

      {widget.type === 'text' && (
        <Section title="Content">
          <textarea
            value={widget.data?.text || ''}
            onChange={(e) => updateData('text', e.target.value)}
            rows={4}
            style={{ ...inputStyle, resize: 'vertical' }}
            placeholder="Enter text..."
          />
          <Field label="Font size">
            <input
              type="number"
              min={10}
              max={72}
              value={widget.config?.fontSize || 16}
              onChange={(e) => updateConfig('fontSize', parseInt(e.target.value))}
              style={{ ...inputStyle, width: 60 }}
            />
          </Field>
        </Section>
      )}

      {widget.type === 'scorecard' && (
        <Section title="Data">
          <Field label="Label">
            <input
              type="text"
              value={widget.data?.label || ''}
              onChange={(e) => updateData('label', e.target.value)}
              style={inputStyle}
            />
          </Field>
          <Field label="Value">
            <input
              type="text"
              value={widget.data?.value || ''}
              onChange={(e) => updateData('value', e.target.value)}
              style={inputStyle}
            />
          </Field>
          <Field label="Value size">
            <input
              type="number"
              min={16}
              max={72}
              value={widget.config?.valueSize || 36}
              onChange={(e) => updateConfig('valueSize', parseInt(e.target.value))}
              style={{ ...inputStyle, width: 60 }}
            />
          </Field>
        </Section>
      )}

      {widget.type === 'line' && (
        <Section title="Options">
          <Field label="Smooth">
            <input
              type="checkbox"
              checked={widget.config?.smooth ?? true}
              onChange={(e) => updateConfig('smooth', e.target.checked)}
            />
          </Field>
          <Field label="Show area">
            <input
              type="checkbox"
              checked={widget.config?.showArea || false}
              onChange={(e) => updateConfig('showArea', e.target.checked)}
            />
          </Field>
        </Section>
      )}

      {widget.type === 'pie' && (
        <Section title="Options">
          <Field label="Donut">
            <input
              type="checkbox"
              checked={widget.config?.donut || false}
              onChange={(e) => updateConfig('donut', e.target.checked)}
            />
          </Field>
          <Field label="Show labels">
            <input
              type="checkbox"
              checked={widget.config?.showLabels ?? true}
              onChange={(e) => updateConfig('showLabels', e.target.checked)}
            />
          </Field>
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 8 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
      <span style={{ fontSize: 13, color: '#475569' }}>{label}</span>
      {children}
    </div>
  );
}

const panelStyle = {
  width: 280,
  backgroundColor: '#fff',
  borderLeft: '1px solid #e2e8f0',
  padding: 16,
  overflowY: 'auto',
  flexShrink: 0,
};

const headerStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 16,
  paddingBottom: 12,
  borderBottom: '1px solid #e2e8f0',
  fontWeight: 600,
  fontSize: 14,
};

const deleteStyle = {
  fontSize: 12,
  color: '#dc2626',
  background: 'none',
  border: '1px solid #fca5a5',
  borderRadius: 4,
  padding: '4px 8px',
  cursor: 'pointer',
};

const inputStyle = {
  width: '100%',
  padding: '6px 8px',
  border: '1px solid #e2e8f0',
  borderRadius: 4,
  fontSize: 13,
  marginBottom: 8,
  outline: 'none',
  boxSizing: 'border-box',
};
