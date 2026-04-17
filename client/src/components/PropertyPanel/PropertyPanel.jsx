import { useState, useCallback } from 'react';
import { WIDGET_TYPES, BAR_SUB_TYPES, LINE_SUB_TYPES, TABLE_SUB_TYPES } from '../Widgets';
import DataPanel from '../DataPanel/DataPanel';
import DropZone from '../DropZone/DropZone';
import TablePropertySections from './TablePropertySections';

// Track which sections are collapsed
const useSectionState = () => {
  const [collapsed, setCollapsed] = useState({});
  const toggle = useCallback((key) => setCollapsed((p) => ({ ...p, [key]: !p[key] })), []);
  return { collapsed, toggle };
};

// Left column: widget configuration (always present, collapsible)
export function WidgetConfigPanel({ widgetId, widget, onUpdate, onDelete, onBringToFront, onSendToBack, onBringForward, onSendBackward, model }) {
  const [collapsed, setCollapsed] = useState(false);
  const sections = useSectionState();

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
  const columnDims = binding.columnDimensions || [];

  const addGroupBy = (name) => {
    if (!groupBy.includes(name)) updateBinding({ groupBy: [...groupBy, name] });
  };
  const removeGroupBy = (name) => {
    updateBinding({ groupBy: groupBy.filter((g) => g !== name) });
  };

  const addColumnDim = (name) => {
    if (!columnDims.includes(name)) updateBinding({ columnDimensions: [...columnDims, name] });
  };
  const removeColumnDim = (name) => {
    updateBinding({ columnDimensions: columnDims.filter((d) => d !== name) });
  };

  const handleDrop = (zone) => (fieldName, fieldType) => {
    if (zone === 'groupBy') {
      addGroupBy(fieldName);
    } else if (zone === 'pivotColumns') {
      addColumnDim(fieldName);
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
        <Section title="" bare>
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
        <Section title="" bare>
          <DropZone label="Axis" accepts={['dimension']} fields={selectedDims}
            onDrop={handleDrop('axis')} onRemove={handleRemove} fieldInfos={fieldInfos} />
          <DropZone label="Legend" accepts={['dimension']} fields={groupBy}
            onDrop={handleDrop('groupBy')} onRemove={handleRemoveGroupBy} fieldInfos={fieldInfos} />
          <DropZone label="Values" accepts={['measure']} fields={selectedMeass}
            onDrop={handleDrop('values')} onRemove={handleRemove} multiple fieldInfos={fieldInfos} />
        </Section>
      );
    }

    if (type === 'pie') {
      return (
        <Section title="" bare>
          <DropZone label="Category" accepts={['dimension']} fields={selectedDims}
            onDrop={handleDrop('category')} onRemove={handleRemove} fieldInfos={fieldInfos} />
          <DropZone label="Value" accepts={['measure']} fields={selectedMeass}
            onDrop={handleDrop('value')} onRemove={handleRemove} fieldInfos={fieldInfos} />
        </Section>
      );
    }

    if (type === 'table') {
      return (
        <Section title="" bare>
          <DropZone label="Columns" accepts={['dimension', 'measure']} fields={[...selectedDims, ...selectedMeass]}
            onDrop={handleDrop('columns')} onRemove={handleRemove} multiple fieldInfos={fieldInfos} />
        </Section>
      );
    }

    if (type === 'scorecard') {
      return (
        <Section title="" bare>
          <DropZone label="Value" accepts={['measure']} fields={selectedMeass}
            onDrop={handleDrop('value')} onRemove={handleRemove} fieldInfos={fieldInfos} />
        </Section>
      );
    }

    if (type === 'pivotTable') {
      return (
        <Section title="" bare>
          <DropZone label="Rows" accepts={['dimension']} fields={selectedDims}
            onDrop={handleDrop('rows')} onRemove={handleRemove} multiple fieldInfos={fieldInfos} />
          <DropZone label="Columns" accepts={['dimension']} fields={columnDims}
            onDrop={handleDrop('pivotColumns')} onRemove={removeColumnDim} multiple fieldInfos={fieldInfos} />
          <DropZone label="Values" accepts={['measure']} fields={selectedMeass}
            onDrop={handleDrop('values')} onRemove={handleRemove} multiple fieldInfos={fieldInfos} />
        </Section>
      );
    }

    if (type === 'filter') {
      return (
        <Section title="" bare>
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
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          {(() => { const I = widgetMeta?.icon; return I ? <I size={16} /> : null; })()} {widgetMeta?.label}
        </span>
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

      {(widget.type === 'bar' || widget.type === 'line' || widget.type === 'pie') && (
        <Section title="Sort">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {[
              { value: 'none', label: 'No sort' },
              { value: 'desc', label: 'Descending (largest first)' },
              { value: 'asc', label: 'Ascending (smallest first)' },
            ].map((opt) => (
              <label key={opt.value} style={radioRow}>
                <input type="radio" name="sortOrder"
                  checked={(widget.config?.sortOrder || 'none') === opt.value}
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

      {(widget.type === 'table' || widget.type === 'pivotTable') && (
        <Section title="Table Type">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {TABLE_SUB_TYPES.map((st) => (
              <label key={st.value} style={radioRow}>
                <input type="radio" name="tableSubType" checked={widget.type === st.value}
                  onChange={() => {
                    if (widget.type !== st.value) {
                      onUpdate(widgetId, { ...widget, type: st.value, data: {} });
                    }
                  }} />
                {st.label}
              </label>
            ))}
          </div>
        </Section>
      )}

      {widget.type === 'filter' && (
        <Section title="Slicer Options" sectionState={sections}>
          <Field label="Style">
            <select value={widget.config?.slicerStyle || 'list'}
              onChange={(e) => updateConfig('slicerStyle', e.target.value)}
              style={{ ...inputStyle, width: 95, marginBottom: 0 }}>
              <option value="list">List</option>
              <option value="dropdown">Dropdown</option>
              <option value="buttons">Buttons</option>
              <option value="range">Range</option>
            </select>
          </Field>
          {widget.config?.slicerStyle !== 'range' && (
            <Field label="Multi-select">
              <input type="checkbox" checked={widget.config?.multiSelect ?? true}
                onChange={(e) => updateConfig('multiSelect', e.target.checked)} />
            </Field>
          )}
          {(widget.config?.slicerStyle === 'list' || !widget.config?.slicerStyle) && (
            <>
              <Field label="Search bar">
                <input type="checkbox" checked={widget.config?.showSearch ?? true}
                  onChange={(e) => updateConfig('showSearch', e.target.checked)} />
              </Field>
              <Field label="Select all">
                <input type="checkbox" checked={widget.config?.showSelectAll ?? true}
                  onChange={(e) => updateConfig('showSelectAll', e.target.checked)} />
              </Field>
            </>
          )}
          {(widget.config?.slicerStyle === 'list' || widget.config?.slicerStyle === 'buttons' || !widget.config?.slicerStyle) && (
            <Field label="Orientation">
              <select value={widget.config?.orientation || 'vertical'}
                onChange={(e) => updateConfig('orientation', e.target.value)}
                style={{ ...inputStyle, width: 90, marginBottom: 0 }}>
                <option value="vertical">Vertical</option>
                <option value="horizontal">Horizontal</option>
              </select>
            </Field>
          )}
          <Field label="Font size">
            <input type="number" min={8} max={24} value={widget.config?.slicerFontSize || 12}
              onChange={(e) => updateConfig('slicerFontSize', parseInt(e.target.value) || 12)}
              style={{ ...inputStyle, width: 55, marginBottom: 0 }} />
          </Field>
          <Field label="Font color">
            <ColorInput value={widget.config?.slicerFontColor || '#0f172a'}
              onChange={(v) => updateConfig('slicerFontColor', v)} />
          </Field>
          <Field label="Selected color">
            <ColorInput value={widget.config?.slicerSelectedColor || '#3b82f6'}
              onChange={(v) => updateConfig('slicerSelectedColor', v)} />
          </Field>
          <Field label="Selected bg">
            <ColorInput value={widget.config?.slicerSelectedBg || '#eff6ff'}
              onChange={(v) => updateConfig('slicerSelectedBg', v)} />
          </Field>
        </Section>
      )}

      <Section title="Title">
        <input type="text" value={widget.config?.title || ''} onChange={(e) => updateConfig('title', e.target.value)}
          placeholder="Widget title" style={inputStyle} />
      </Section>

      {widget.type !== 'text' && (
        <Section title="Data" sectionState={sections}>
          {widget.type === 'scorecard' && (
            <>
              <Field label="Label">
                <input type="text" value={widget.data?.label || ''} onChange={(e) => updateData('label', e.target.value)} style={inputStyle} />
              </Field>
              <Field label="Value size">
                <input type="number" min={16} max={72} value={widget.config?.valueSize || 36}
                  onChange={(e) => updateConfig('valueSize', parseInt(e.target.value))} style={{ ...inputStyle, width: 60 }} />
              </Field>
            </>
          )}
          {widget.type !== 'scorecard' && (
            <Field label="Row limit">
              <input type="number" min={1} max={10000} value={widget.config?.dataLimit || 1000}
                onChange={(e) => updateConfig('dataLimit', parseInt(e.target.value) || 1000)}
                style={{ ...inputStyle, width: 80, marginBottom: 0 }} />
            </Field>
          )}
        </Section>
      )}

      {/* ── Container ── */}
      <Section title="Container" sectionState={sections}>
        <Field label="Show border">
          <input type="checkbox" checked={widget.config?.borderEnabled ?? true}
            onChange={(e) => updateConfig('borderEnabled', e.target.checked)} />
        </Field>
        {(widget.config?.borderEnabled ?? true) && (
          <>
            <Field label="Border color">
              <ColorInput value={widget.config?.borderColor || '#e2e8f0'}
                onChange={(v) => updateConfig('borderColor', v)} />
            </Field>
          </>
        )}
        <Field label="Border radius" vertical>
          <RangeInput min={0} max={24} value={widget.config?.borderRadius || 8}
            onChange={(e) => updateConfig('borderRadius', parseInt(e.target.value))} />
        </Field>
        <Field label="Transparent bg">
          <input type="checkbox" checked={widget.config?.transparentBg ?? false}
            onChange={(e) => updateConfig('transparentBg', e.target.checked)} />
        </Field>
        {!(widget.config?.transparentBg) && (
          <>
            <Field label="Gradient">
              <input type="checkbox" checked={widget.config?.gradientBg?.enabled ?? false}
                onChange={(e) => updateConfig('gradientBg', { ...widget.config?.gradientBg, enabled: e.target.checked })} />
            </Field>
            {widget.config?.gradientBg?.enabled ? (
              <SubSection label="Gradient">
                <Field label="Angle" vertical>
                  <RangeInput min={0} max={360} value={widget.config?.gradientBg?.angle ?? 180} suffix="°"
                    onChange={(e) => updateConfig('gradientBg', { ...widget.config?.gradientBg, angle: parseInt(e.target.value) })} />
                </Field>
                <Field label="Color 1">
                  <ColorInput value={widget.config?.gradientBg?.color1 || '#ffffff'}
                    onChange={(v) => updateConfig('gradientBg', { ...widget.config?.gradientBg, color1: v })} />
                </Field>
                <Field label="Color 2">
                  <ColorInput value={widget.config?.gradientBg?.color2 || '#e2e8f0'}
                    onChange={(v) => updateConfig('gradientBg', { ...widget.config?.gradientBg, color2: v })} />
                </Field>
              </SubSection>
            ) : (
              <Field label="Background">
                <ColorInput value={widget.config?.backgroundColor || '#ffffff'}
                  onChange={(v) => updateConfig('backgroundColor', v)} />
              </Field>
            )}
          </>
        )}
        <Field label="Shadow">
          <input type="checkbox" checked={widget.config?.shadow?.enabled ?? false}
            onChange={(e) => updateConfig('shadow', { ...widget.config?.shadow, enabled: e.target.checked })} />
        </Field>
        {widget.config?.shadow?.enabled && (
          <SubSection label="Shadow">
            <Field label="Type">
              <select value={widget.config?.shadow?.type || 'outer'}
                onChange={(e) => updateConfig('shadow', { ...widget.config?.shadow, type: e.target.value })}
                style={{ ...inputStyle, width: 80, marginBottom: 0 }}>
                <option value="outer">Outer</option>
                <option value="inner">Inner</option>
              </select>
            </Field>
            <Field label="Angle" vertical>
              <RangeInput min={0} max={360} value={widget.config?.shadow?.angle ?? 135} suffix="°"
                onChange={(e) => updateConfig('shadow', { ...widget.config?.shadow, angle: parseInt(e.target.value) })} />
            </Field>
            <Field label="Blur" vertical>
              <RangeInput min={0} max={40} value={widget.config?.shadow?.blur ?? 10}
                onChange={(e) => updateConfig('shadow', { ...widget.config?.shadow, blur: parseInt(e.target.value) })} />
            </Field>
            <Field label="Spread" vertical>
              <RangeInput min={0} max={20} value={widget.config?.shadow?.spread ?? 2}
                onChange={(e) => updateConfig('shadow', { ...widget.config?.shadow, spread: parseInt(e.target.value) })} />
            </Field>
            <Field label="Shadow color">
              <ColorInput value={widget.config?.shadow?.color || '#000000'}
                onChange={(v) => updateConfig('shadow', { ...widget.config?.shadow, color: v })} />
            </Field>
          </SubSection>
        )}
      </Section>

      {/* ── Chart options ── */}
      {(widget.type === 'bar' || widget.type === 'line' || widget.type === 'pie') && (
        <Section title="Chart" sectionState={sections}>
          {(widget.type === 'bar' || widget.type === 'line') && (
            <Field label="Color">
              <ColorInput value={widget.config?.color || '#5470c6'}
                onChange={(v) => updateConfig('color', v)} />
            </Field>
          )}
          <Field label="Value format">
            <select value={widget.config?.valueAbbreviation || 'none'}
              onChange={(e) => updateConfig('valueAbbreviation', e.target.value)}
              style={{ ...inputStyle, width: 90, marginBottom: 0 }}>
              <option value="none">Full</option>
              <option value="auto">Auto (K/M)</option>
              <option value="K">K (milliers)</option>
              <option value="M">M (millions)</option>
              <option value="B">B (milliards)</option>
            </select>
          </Field>
          <Field label="Data labels">
            <input type="checkbox" checked={widget.config?.showDataLabels ?? false}
              onChange={(e) => updateConfig('showDataLabels', e.target.checked)} />
          </Field>
          {widget.config?.showDataLabels && (
            <SubSection label="Data labels">
              <Field label="Label shows">
                <select value={widget.config?.dataLabelContent || 'value'}
                  onChange={(e) => updateConfig('dataLabelContent', e.target.value)}
                  style={{ ...inputStyle, width: 100, marginBottom: 0 }}>
                  <option value="value">Value</option>
                  <option value="name">Name</option>
                  <option value="percent">Percent</option>
                  <option value="nameValue">Name + Value</option>
                </select>
              </Field>
              <Field label="Label format">
                <select value={widget.config?.dataLabelAbbr || 'none'}
                  onChange={(e) => updateConfig('dataLabelAbbr', e.target.value)}
                  style={{ ...inputStyle, width: 90, marginBottom: 0 }}>
                  <option value="none">Full</option>
                  <option value="auto">Auto (K/M)</option>
                  <option value="K">K (milliers)</option>
                  <option value="M">M (millions)</option>
                  <option value="B">B (milliards)</option>
                </select>
              </Field>
              <Field label="Position">
                <select value={widget.config?.dataLabelPosition || 'top'}
                  onChange={(e) => updateConfig('dataLabelPosition', e.target.value)}
                  style={{ ...inputStyle, width: 110, marginBottom: 0 }}>
                  <option value="top">Au-dessus</option>
                  <option value="inside">Int. milieu</option>
                  <option value="insideTop">Int. haut</option>
                  <option value="insideBottom">Int. bas</option>
                </select>
              </Field>
              <Field label="Angle" vertical>
                <RangeInput min={-90} max={90} value={widget.config?.dataLabelRotate ?? 0} suffix="°"
                  onChange={(e) => updateConfig('dataLabelRotate', parseInt(e.target.value))} />
              </Field>
              <Field label="Label color">
                <ColorInput value={widget.config?.dataLabelColor || '#475569'}
                  onChange={(v) => updateConfig('dataLabelColor', v)} />
              </Field>
              <Field label="Label bg color">
                <ColorInput value={widget.config?.dataLabelBgColor || '#ffffff'}
                  onChange={(v) => updateConfig('dataLabelBgColor', v)} />
              </Field>
              <Field label="Label bg opacity" vertical>
                <RangeInput min={0} max={100} value={widget.config?.dataLabelBgOpacity ?? 0} suffix="%"
                  onChange={(e) => updateConfig('dataLabelBgOpacity', parseInt(e.target.value))} />
              </Field>
            </SubSection>
          )}
          <Field label="Show column names">
            <input type="checkbox" checked={widget.config?.showColumnNames ?? true}
              onChange={(e) => updateConfig('showColumnNames', e.target.checked)} />
          </Field>
          <Field label="Hide zero values">
            <input type="checkbox" checked={widget.config?.hideZeros ?? false}
              onChange={(e) => updateConfig('hideZeros', e.target.checked)} />
          </Field>
          <Field label="Show legend">
            <input type="checkbox" checked={widget.config?.showLegend ?? false}
              onChange={(e) => updateConfig('showLegend', e.target.checked)} />
          </Field>
          {widget.config?.showLegend && (
            <SubSection label="Legend">
              <Field label="Position">
                <select value={widget.config?.legendPosition || 'top'}
                  onChange={(e) => updateConfig('legendPosition', e.target.value)}
                  style={{ ...inputStyle, width: 90, marginBottom: 0 }}>
                  <option value="top">Top</option>
                  <option value="bottom">Bottom</option>
                  <option value="left">Left</option>
                  <option value="right">Right</option>
                </select>
              </Field>
            </SubSection>
          )}
          {(widget.type === 'bar' || widget.type === 'line') && (
            <>
              <Field label="Show X axis">
                <input type="checkbox" checked={widget.config?.showXAxis ?? true}
                  onChange={(e) => updateConfig('showXAxis', e.target.checked)} />
              </Field>
              <Field label="Show Y axis">
                <input type="checkbox" checked={widget.config?.showYAxis ?? true}
                  onChange={(e) => updateConfig('showYAxis', e.target.checked)} />
              </Field>
              <Field label="Grid style">
                <select value={widget.config?.gridLineStyle || 'solid'}
                  onChange={(e) => updateConfig('gridLineStyle', e.target.value)}
                  style={{ ...inputStyle, width: 90, marginBottom: 0 }}>
                  <option value="solid">Solid</option>
                  <option value="dashed">Dashed</option>
                  <option value="dotted">Dotted</option>
                </select>
              </Field>
              <Field label="Grid width" vertical>
                <RangeInput min={0} max={5} step={0.5} value={widget.config?.gridLineWidth ?? 1}
                  onChange={(e) => updateConfig('gridLineWidth', parseFloat(e.target.value))} />
              </Field>
              <Field label="Y axis step">
                <input type="number" min={0} step={1}
                  value={widget.config?.yAxisInterval ?? ''}
                  placeholder="Auto"
                  onChange={(e) => updateConfig('yAxisInterval', e.target.value ? parseFloat(e.target.value) : null)}
                  style={{ ...inputStyle, width: 70, marginBottom: 0 }} />
              </Field>
            </>
          )}
        </Section>
      )}

      {/* Table full configuration */}
      {widget.type === 'table' && (
        <TablePropertySections
          widget={widget}
          updateConfig={updateConfig}
          Section={Section}
          SubSection={SubSection}
          Field={Field}
          RangeInput={RangeInput}
          ColorInput={ColorInput}
          inputStyle={inputStyle}
          sections={sections}
        />
      )}

      {/* Pivot Table configuration */}
      {widget.type === 'pivotTable' && (
        <>
          <PivotOptionsSection
            widget={widget}
            updateConfig={updateConfig}
            Section={Section}
            Field={Field}
            inputStyle={inputStyle}
            sections={sections}
          />
          <TablePropertySections
            widget={widget}
            updateConfig={updateConfig}
            Section={Section}
            SubSection={SubSection}
            Field={Field}
            RangeInput={RangeInput}
            ColorInput={ColorInput}
            inputStyle={inputStyle}
            sections={sections}
          />
        </>
      )}

      {widget.type === 'text' && (
        <Section title="Content" sectionState={sections}>
          <textarea value={widget.data?.text || ''} onChange={(e) => updateData('text', e.target.value)}
            rows={4} style={{ ...inputStyle, resize: 'vertical' }} placeholder="Enter text..." />
          <Field label="Font size">
            <input type="number" min={10} max={72} value={widget.config?.fontSize || 16}
              onChange={(e) => updateConfig('fontSize', parseInt(e.target.value))}
              style={{ ...inputStyle, width: 60 }} />
          </Field>
        </Section>
      )}


      {widget.type === 'line' && (
        <Section title="Options" sectionState={sections}>
          <Field label="Smooth">
            <input type="checkbox" checked={widget.config?.smooth ?? true} onChange={(e) => updateConfig('smooth', e.target.checked)} />
          </Field>
          <Field label="Show area">
            <input type="checkbox" checked={widget.config?.showArea || false} onChange={(e) => updateConfig('showArea', e.target.checked)} />
          </Field>
        </Section>
      )}

      {widget.type === 'pie' && (
        <Section title="Options" sectionState={sections}>
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
export function DataModelPanel({ widgetId, widget, onUpdate, model, onModelUpdate, reportFilters }) {
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
      <DataPanel widgetId={widgetId} widget={widget} onUpdate={onUpdate} model={model} onModelUpdate={onModelUpdate} reportFilters={reportFilters} />
    </div>
  );
}

function Section({ title, children, defaultOpen = true, sectionState, bare }) {
  if (bare) {
    return <div style={{ marginBottom: 8 }}>{children}</div>;
  }

  const isCollapsed = sectionState ? sectionState.collapsed[title] ?? !defaultOpen : false;
  const toggle = sectionState ? () => sectionState.toggle(title) : undefined;

  return (
    <div style={sectionStyle}>
      <div onClick={toggle} style={{ ...sectionHeaderStyle, cursor: toggle ? 'pointer' : 'default' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>{title}</span>
        {toggle && (
          <span style={{ fontSize: 10, color: '#94a3b8', transition: 'transform 0.15s', transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>▼</span>
        )}
      </div>
      {!isCollapsed && (
        <div style={{ padding: '8px 10px 4px' }}>
          {children}
        </div>
      )}
    </div>
  );
}

function SubSection({ label, children }) {
  return (
    <div style={{ marginTop: 6, marginBottom: 6 }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
      <div style={subSectionStyle}>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children, vertical }) {
  if (vertical) {
    return (
      <div style={{ marginBottom: 6 }}>
        <div style={{ fontSize: 12, color: '#475569', marginBottom: 3 }}>{label}</div>
        <div>{children}</div>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, gap: 6 }}>
      <span style={{ fontSize: 12, color: '#475569', whiteSpace: 'nowrap' }}>{label}</span>
      <div style={{ flexShrink: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}

function RangeInput({ min, max, step, value, onChange, suffix }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, minWidth: 0 }}>
      <input type="range" min={min} max={max} step={step || 1} value={value}
        onChange={onChange} style={{ flex: 1, minWidth: 0 }} />
      <input type="number" min={min} max={max} step={step || 1} value={value}
        onChange={onChange}
        style={{ width: 48, minWidth: 48, padding: '2px 3px', border: '1px solid #e2e8f0', borderRadius: 3, fontSize: 11, textAlign: 'center', outline: 'none', boxSizing: 'border-box', flexShrink: 0 }} />
      {suffix && <span style={{ fontSize: 10, color: '#94a3b8', flexShrink: 0 }}>{suffix}</span>}
    </div>
  );
}

function ColorInput({ value, onChange }) {
  const isTransparent = value === 'transparent' || value === '';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
      <input type="color" value={isTransparent ? '#ffffff' : value}
        onChange={(e) => onChange(e.target.value)}
        style={{ opacity: isTransparent ? 0.3 : 1 }} />
      <button
        onClick={() => onChange(isTransparent ? '#ffffff' : 'transparent')}
        title={isTransparent ? 'Set color' : 'Set transparent'}
        style={{
          width: 22, height: 22, border: '1px solid #e2e8f0', borderRadius: 3,
          cursor: 'pointer', fontSize: 11, lineHeight: 1,
          background: isTransparent ? '#fff' : 'repeating-conic-gradient(#ddd 0% 25%, #fff 0% 50%) 50%/12px 12px',
          color: isTransparent ? '#3b82f6' : '#94a3b8',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 0, flexShrink: 0,
        }}
      >
        {isTransparent ? '∅' : '∅'}
      </button>
    </div>
  );
}

function PivotOptionsSection({ widget, updateConfig, Section, Field, inputStyle, sections }) {
  const pc = widget.config?.pivotConfig || {};
  const measures = widget.data?._measures || [];
  const [selectedMeasure, setSelectedMeasure] = useState(null);

  // Read: per-measure key first, then global key (with key mapping for aggregation)
  const getVal = (key, defaultVal) => {
    if (selectedMeasure) {
      const mv = pc.perMeasure?.[selectedMeasure]?.[key];
      if (mv !== undefined) return mv;
    }
    // For aggregation, global key is 'defaultAggregation'
    const globalKey = key === 'aggregation' ? 'defaultAggregation' : key;
    return pc[globalKey] ?? defaultVal;
  };

  // Write: per-measure or global (with key mapping)
  const setVal = (key, value) => {
    const newPc = { ...pc };
    if (selectedMeasure) {
      const perMeasure = { ...(newPc.perMeasure || {}) };
      perMeasure[selectedMeasure] = { ...(perMeasure[selectedMeasure] || {}), [key]: value };
      newPc.perMeasure = perMeasure;
    } else {
      const globalKey = key === 'aggregation' ? 'defaultAggregation' : key;
      newPc[globalKey] = value;
    }
    updateConfig('pivotConfig', newPc);
  };

  // Always-global setter
  const setGlobal = (key, value) => {
    updateConfig('pivotConfig', { ...pc, [key]: value });
  };

  return (
    <Section title="Pivot Options" sectionState={sections}>
      <Field label="Row subtotals">
        <input type="checkbox" checked={pc.showRowSubTotals ?? true}
          onChange={(e) => setGlobal('showRowSubTotals', e.target.checked)} />
      </Field>
      <Field label="Grand total row">
        <input type="checkbox" checked={pc.showGrandTotalRow ?? true}
          onChange={(e) => setGlobal('showGrandTotalRow', e.target.checked)} />
      </Field>
      <Field label="Grand total col">
        <input type="checkbox" checked={pc.showGrandTotalCol ?? true}
          onChange={(e) => setGlobal('showGrandTotalCol', e.target.checked)} />
      </Field>

      {measures.length > 0 && (
        <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px solid #f1f5f9' }}>
          <select
            value={selectedMeasure || ''}
            onChange={(e) => setSelectedMeasure(e.target.value || null)}
            style={{ ...inputStyle, marginBottom: 6, fontSize: 11 }}
          >
            <option value="">All measures (global)</option>
            {measures.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      )}
      <Field label="Value format">
        <select value={getVal('valueAbbreviation', 'none')}
          onChange={(e) => setVal('valueAbbreviation', e.target.value)}
          style={{ ...inputStyle, width: 90, marginBottom: 0 }}>
          <option value="none">Full</option>
          <option value="auto">Auto (K/M)</option>
          <option value="K">K</option>
          <option value="M">M</option>
          <option value="B">B</option>
        </select>
      </Field>
      <Field label="Aggregation">
        <select value={getVal('aggregation', 'sum')}
          onChange={(e) => setVal('aggregation', e.target.value)}
          style={{ ...inputStyle, width: 90, marginBottom: 0 }}>
          <option value="sum">Sum</option>
          <option value="avg">Average</option>
          <option value="count">Count</option>
          <option value="min">Min</option>
          <option value="max">Max</option>
        </select>
      </Field>
    </Section>
  );
}

const sectionStyle = {
  marginBottom: 8,
  border: '1px solid #e2e8f0',
  borderRadius: 6,
  overflow: 'hidden',
};

const sectionHeaderStyle = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '6px 10px',
  background: '#f8fafc',
  cursor: 'pointer',
  userSelect: 'none',
};

const subSectionStyle = {
  marginTop: 6, marginBottom: 6,
  padding: '6px 6px',
  border: '1px solid #f1f5f9',
  borderRadius: 4,
  background: '#fafbfc',
  overflow: 'hidden',
};

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
