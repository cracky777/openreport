import { useState } from 'react';
import { WIDGET_TYPES, BAR_SUB_TYPES, LINE_SUB_TYPES } from '../Widgets';
import DataPanel from '../DataPanel/DataPanel';
import DropZone from '../DropZone/DropZone';

// Left column: widget configuration (always present, collapsible)
export function WidgetConfigPanel({ widgetId, widget, onUpdate, onDelete, onBringToFront, onSendToBack, onBringForward, onSendBackward, model }) {
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    return (
      <div style={collapsedPanelStyle}>
        <button onClick={() => setCollapsed(false)} style={chevronBtn} title="Open config panel">
          «
        </button>
      </div>
    );
  }

  if (!widgetId || !widget) {
    return (
      <div style={configPanelStyle}>
        <div style={panelHeader}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>Configuration</span>
          <button onClick={() => setCollapsed(true)} style={chevronBtn} title="Collapse panel">»</button>
        </div>
        <div style={{ color: '#94a3b8', fontSize: 13, textAlign: 'center', marginTop: 40 }}>
          Select a widget to configure it
        </div>
      </div>
    );
  }

  const updateConfig = (key, value) => {
    onUpdate(widgetId, { ...widget, config: { ...widget.config, [key]: value } });
  };

  const updateData = (key, value) => {
    onUpdate(widgetId, { ...widget, data: { ...widget.data, [key]: value } });
  };

  // Build field info lookup for tooltips
  const fieldInfos = {};
  if (model) {
    for (const d of (model.dimensions || [])) fieldInfos[d.name] = { table: d.table, column: d.column };
    for (const m of (model.measures || [])) fieldInfos[m.name] = { table: m.table, column: m.column };
  }

  const widgetMeta = WIDGET_TYPES[widget.type];
  const binding = widget.dataBinding || {};
  const selectedDims = binding.selectedDimensions || [];
  const selectedMeass = binding.selectedMeasures || [];

  const updateBinding = (newBinding) => {
    onUpdate(widgetId, { ...widget, dataBinding: { ...binding, ...newBinding } });
  };

  const addDimension = (name) => {
    if (!selectedDims.includes(name)) {
      updateBinding({ selectedDimensions: [...selectedDims, name] });
    }
  };

  const removeDimension = (name) => {
    updateBinding({ selectedDimensions: selectedDims.filter((d) => d !== name) });
  };

  const addMeasure = (name) => {
    if (!selectedMeass.includes(name)) {
      updateBinding({ selectedMeasures: [...selectedMeass, name] });
    }
  };

  const removeMeasure = (name) => {
    updateBinding({ selectedMeasures: selectedMeass.filter((m) => m !== name) });
  };

  const groupBy = binding.groupBy || [];

  const addGroupBy = (name) => {
    if (!groupBy.includes(name)) {
      updateBinding({ groupBy: [...groupBy, name] });
    }
  };

  const removeGroupBy = (name) => {
    updateBinding({ groupBy: groupBy.filter((g) => g !== name) });
  };

  const handleDrop = (zone) => (fieldName, fieldType) => {
    if (zone === 'groupBy') {
      addGroupBy(fieldName);
    } else if (fieldType === 'dimension') {
      addDimension(fieldName);
    } else if (fieldType === 'measure') {
      addMeasure(fieldName);
    }
  };

  const handleRemove = (fieldName) => {
    if (selectedDims.includes(fieldName)) removeDimension(fieldName);
    else if (selectedMeass.includes(fieldName)) removeMeasure(fieldName);
  };

  const handleRemoveGroupBy = (fieldName) => {
    removeGroupBy(fieldName);
  };

  // Build field wells per widget type
  const renderFieldWells = () => {
    const type = widget.type;

    if (type === 'bar') {
      return (
        <Section title="Fields">
          <DropZone label="Axis" accepts={['dimension']} fields={selectedDims}
            onDrop={handleDrop('axis')} onRemove={handleRemove} fieldInfos={fieldInfos} />
          <DropZone label="Legend" accepts={['dimension']} fields={groupBy}
            onDrop={handleDrop('groupBy')} onRemove={handleRemoveGroupBy} fieldInfos={fieldInfos} />
          <DropZone label="Values" accepts={['measure']} fields={selectedMeass}
            onDrop={handleDrop('values')} onRemove={handleRemove} multiple fieldInfos={fieldInfos} />
        </Section>
      );
    }

    if (type === 'line') {
      return (
        <Section title="Fields">
          <DropZone label="Axis" accepts={['dimension']} fields={selectedDims}
            onDrop={handleDrop('axis')} onRemove={handleRemove} fieldInfos={fieldInfos} />
          <DropZone label="Values" accepts={['measure']} fields={selectedMeass}
            onDrop={handleDrop('values')} onRemove={handleRemove} multiple fieldInfos={fieldInfos} />
        </Section>
      );
    }

    if (type === 'pie') {
      return (
        <Section title="Fields">
          <DropZone label="Category" accepts={['dimension']} fields={selectedDims}
            onDrop={handleDrop('category')} onRemove={handleRemove} fieldInfos={fieldInfos} />
          <DropZone label="Value" accepts={['measure']} fields={selectedMeass}
            onDrop={handleDrop('value')} onRemove={handleRemove} fieldInfos={fieldInfos} />
        </Section>
      );
    }

    if (type === 'table') {
      return (
        <Section title="Fields">
          <DropZone label="Columns" accepts={['dimension', 'measure']} fields={[...selectedDims, ...selectedMeass]}
            onDrop={handleDrop('columns')} onRemove={handleRemove} multiple fieldInfos={fieldInfos} />
        </Section>
      );
    }

    if (type === 'scorecard') {
      return (
        <Section title="Fields">
          <DropZone label="Value" accepts={['measure']} fields={selectedMeass}
            onDrop={handleDrop('value')} onRemove={handleRemove} fieldInfos={fieldInfos} />
        </Section>
      );
    }

    if (type === 'filter') {
      return (
        <Section title="Fields">
          <DropZone label="Filter field" accepts={['dimension']} fields={selectedDims}
            onDrop={handleDrop('filter')} onRemove={handleRemove} fieldInfos={fieldInfos} />
        </Section>
      );
    }

    return null;
  };

  return (
    <div style={configPanelStyle}>
      <div style={panelHeader}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>Configuration</span>
        <button onClick={() => setCollapsed(true)} style={chevronBtn} title="Collapse panel">»</button>
      </div>

      <div style={headerStyle}>
        <span>{widgetMeta?.icon} {widgetMeta?.label}</span>
        <div style={{ display: 'flex', gap: 3 }}>
          <button onClick={() => onSendToBack(widgetId)} title="Send to back" style={layerBtn}>⇊</button>
          <button onClick={() => onSendBackward(widgetId)} title="Back one" style={layerBtn}>↓</button>
          <button onClick={() => onBringForward(widgetId)} title="Forward one" style={layerBtn}>↑</button>
          <button onClick={() => onBringToFront(widgetId)} title="Bring to front" style={layerBtn}>⇈</button>
          <button onClick={() => onDelete(widgetId)} style={deleteStyle}>Del</button>
        </div>
      </div>

      {/* Field wells - drag & drop zones */}
      {renderFieldWells()}

      {widget.type === 'bar' && (
        <Section title="Chart Type">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {BAR_SUB_TYPES.map((st) => (
              <label key={st.value} style={radioRow}>
                <input type="radio" name="barSubType" checked={(widget.config?.subType || 'grouped') === st.value}
                  onChange={() => updateConfig('subType', st.value)} />
                {st.label}
              </label>
            ))}
          </div>
        </Section>
      )}

      {widget.type === 'bar' && (
        <Section title="Sort">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {[
              { value: 'none', label: 'No sort' },
              { value: 'desc', label: 'Descending (largest first)' },
              { value: 'asc', label: 'Ascending (smallest first)' },
            ].map((opt) => (
              <label key={opt.value} style={radioRow}>
                <input type="radio" name="sortOrder"
                  checked={(widget.config?.sortOrder || ((widget.config?.subType === 'stacked' || widget.config?.subType === 'stacked100') ? 'desc' : 'none')) === opt.value}
                  onChange={() => updateConfig('sortOrder', opt.value)} />
                {opt.label}
              </label>
            ))}
          </div>
        </Section>
      )}

      {widget.type === 'line' && (
        <Section title="Chart Type">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {LINE_SUB_TYPES.map((st) => (
              <label key={st.value} style={radioRow}>
                <input type="radio" name="lineSubType" checked={(widget.config?.subType || 'line') === st.value}
                  onChange={() => updateConfig('subType', st.value)} />
                {st.label}
              </label>
            ))}
          </div>
        </Section>
      )}

      {widget.type === 'filter' && (
        <Section title="Filter Options">
          <Field label="Multi-select">
            <input type="checkbox" checked={widget.config?.multiSelect ?? true}
              onChange={(e) => updateConfig('multiSelect', e.target.checked)} />
          </Field>
        </Section>
      )}

      <Section title="Title">
        <input type="text" value={widget.config?.title || ''} onChange={(e) => updateConfig('title', e.target.value)}
          placeholder="Widget title" style={inputStyle} />
      </Section>

      {widget.type !== 'text' && (
        <Section title="Data">
          <Field label="Row limit">
            <input type="number" min={1} max={10000} value={widget.config?.dataLimit || 1000}
              onChange={(e) => updateConfig('dataLimit', parseInt(e.target.value) || 1000)}
              style={{ ...inputStyle, width: 80, marginBottom: 0 }} />
          </Field>
        </Section>
      )}

      <Section title="Style">
        <Field label="Background">
          <input type="color" value={widget.config?.backgroundColor || '#ffffff'}
            onChange={(e) => updateConfig('backgroundColor', e.target.value)} />
        </Field>
        <Field label="Border color">
          <input type="color" value={widget.config?.borderColor || '#e2e8f0'}
            onChange={(e) => updateConfig('borderColor', e.target.value)} />
        </Field>
        <Field label="Border radius">
          <input type="range" min={0} max={24} value={widget.config?.borderRadius || 8}
            onChange={(e) => updateConfig('borderRadius', parseInt(e.target.value))} />
        </Field>
        {(widget.type === 'bar' || widget.type === 'line') && (
          <Field label="Color">
            <input type="color" value={widget.config?.color || '#5470c6'}
              onChange={(e) => updateConfig('color', e.target.value)} />
          </Field>
        )}
        {(widget.type === 'bar' || widget.type === 'line' || widget.type === 'table' || widget.type === 'pie') && (
          <Field label="Show column names">
            <input type="checkbox" checked={widget.config?.showColumnNames ?? true}
              onChange={(e) => updateConfig('showColumnNames', e.target.checked)} />
          </Field>
        )}
        {(widget.type === 'bar' || widget.type === 'line' || widget.type === 'pie') && (
          <Field label="Hide zero values">
            <input type="checkbox" checked={widget.config?.hideZeros ?? false}
              onChange={(e) => updateConfig('hideZeros', e.target.checked)} />
          </Field>
        )}
        {(widget.type === 'bar' || widget.type === 'line' || widget.type === 'pie') && (
          <>
            <Field label="Show legend">
              <input type="checkbox" checked={widget.config?.showLegend ?? false}
                onChange={(e) => updateConfig('showLegend', e.target.checked)} />
            </Field>
            {widget.config?.showLegend && (
              <Field label="Legend position">
                <select value={widget.config?.legendPosition || 'top'}
                  onChange={(e) => updateConfig('legendPosition', e.target.value)}
                  style={{ ...inputStyle, width: 90, marginBottom: 0 }}>
                  <option value="top">Top</option>
                  <option value="bottom">Bottom</option>
                  <option value="left">Left</option>
                  <option value="right">Right</option>
                </select>
              </Field>
            )}
          </>
        )}
      </Section>

      {widget.type === 'text' && (
        <Section title="Content">
          <textarea value={widget.data?.text || ''} onChange={(e) => updateData('text', e.target.value)}
            rows={4} style={{ ...inputStyle, resize: 'vertical' }} placeholder="Enter text..." />
          <Field label="Font size">
            <input type="number" min={10} max={72} value={widget.config?.fontSize || 16}
              onChange={(e) => updateConfig('fontSize', parseInt(e.target.value))}
              style={{ ...inputStyle, width: 60 }} />
          </Field>
        </Section>
      )}

      {widget.type === 'scorecard' && (
        <Section title="Data">
          <Field label="Label">
            <input type="text" value={widget.data?.label || ''} onChange={(e) => updateData('label', e.target.value)} style={inputStyle} />
          </Field>
          <Field label="Value">
            <input type="text" value={widget.data?.value || ''} onChange={(e) => updateData('value', e.target.value)} style={inputStyle} />
          </Field>
          <Field label="Value size">
            <input type="number" min={16} max={72} value={widget.config?.valueSize || 36}
              onChange={(e) => updateConfig('valueSize', parseInt(e.target.value))} style={{ ...inputStyle, width: 60 }} />
          </Field>
        </Section>
      )}

      {widget.type === 'line' && (
        <Section title="Options">
          <Field label="Smooth">
            <input type="checkbox" checked={widget.config?.smooth ?? true} onChange={(e) => updateConfig('smooth', e.target.checked)} />
          </Field>
          <Field label="Show area">
            <input type="checkbox" checked={widget.config?.showArea || false} onChange={(e) => updateConfig('showArea', e.target.checked)} />
          </Field>
        </Section>
      )}

      {widget.type === 'pie' && (
        <Section title="Options">
          <Field label="Donut">
            <input type="checkbox" checked={widget.config?.donut || false} onChange={(e) => updateConfig('donut', e.target.checked)} />
          </Field>
          <Field label="Show labels">
            <input type="checkbox" checked={widget.config?.showLabels ?? true} onChange={(e) => updateConfig('showLabels', e.target.checked)} />
          </Field>
        </Section>
      )}
    </div>
  );
}

// Right column: model dimensions & measures (always visible, collapsible)
export function DataModelPanel({ widgetId, widget, onUpdate, model, onModelUpdate }) {
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    return (
      <div style={collapsedPanelStyle}>
        <button onClick={() => setCollapsed(false)} style={chevronBtn} title="Open data panel">
          «
        </button>
      </div>
    );
  }

  return (
    <div style={dataPanelStyle}>
      <div style={panelHeader}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>Données</span>
        <button onClick={() => setCollapsed(true)} style={chevronBtn} title="Collapse panel">»</button>
      </div>
      <DataPanel widgetId={widgetId} widget={widget} onUpdate={onUpdate} model={model} onModelUpdate={onModelUpdate} />
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 8 }}>{title}</div>
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

const configPanelStyle = {
  width: 250, maxWidth: 250, backgroundColor: '#fff', borderLeft: '1px solid #e2e8f0',
  padding: 16, overflowY: 'auto', flexShrink: 0,
  transition: 'width 0.2s ease, max-width 0.2s ease, padding 0.2s ease',
};

const collapsedPanelStyle = {
  width: 32, maxWidth: 32, backgroundColor: '#fff', borderLeft: '1px solid #e2e8f0',
  display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
  paddingTop: 8, flexShrink: 0, overflow: 'hidden',
  transition: 'width 0.2s ease, max-width 0.2s ease',
};

const panelHeader = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid #e2e8f0',
};

const chevronBtn = {
  fontSize: 14, color: '#64748b', background: 'none', border: 'none',
  cursor: 'pointer', padding: '2px 4px', fontWeight: 700,
};

const dataPanelStyle = {
  width: 260, maxWidth: 260, backgroundColor: '#fff', borderLeft: '1px solid #e2e8f0',
  padding: 16, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden',
  transition: 'width 0.2s ease, max-width 0.2s ease, padding 0.2s ease',
};

const headerStyle = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid #e2e8f0', fontWeight: 600, fontSize: 14,
};

const radioRow = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' };

const layerBtn = {
  fontSize: 14, color: '#475569', background: 'none', border: '1px solid #e2e8f0',
  borderRadius: 4, padding: '2px 6px', cursor: 'pointer', lineHeight: 1,
};

const deleteStyle = {
  fontSize: 12, color: '#dc2626', background: 'none', border: '1px solid #fca5a5',
  borderRadius: 4, padding: '4px 8px', cursor: 'pointer',
};

const inputStyle = {
  width: '100%', padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 4,
  fontSize: 13, marginBottom: 8, outline: 'none', boxSizing: 'border-box',
};
