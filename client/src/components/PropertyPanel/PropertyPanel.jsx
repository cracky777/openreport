import { useState, useCallback } from 'react';
import { WIDGET_TYPES, BAR_SUB_TYPES, LINE_SUB_TYPES, COMBO_SUB_TYPES, TABLE_SUB_TYPES } from '../Widgets';
import DataPanel from '../DataPanel/DataPanel';
import DropZone from '../DropZone/DropZone';
import TablePropertySections from './TablePropertySections';
import { TbLayersSubtract, TbLayersLinked, TbArrowBigDown, TbArrowBigUp, TbTrash, TbChartBar } from 'react-icons/tb';

function getWidgetDisplayInfo(widget) {
  if (!widget) return { label: '', icon: null };
  const meta = WIDGET_TYPES[widget.type];
  if (!meta) return { label: widget.type, icon: null };

  // Check sub-types for specific label/icon
  const subType = widget.config?.subType;
  if (widget.type === 'bar' && subType) {
    const st = BAR_SUB_TYPES.find((s) => s.value === subType);
    if (st) return { label: st.label, icon: st.icon || meta.icon };
  }
  if (widget.type === 'line' && subType) {
    const st = LINE_SUB_TYPES.find((s) => s.value === subType);
    if (st) return { label: st.label, icon: st.icon || meta.icon };
  }
  if (widget.type === 'combo' && subType) {
    const st = COMBO_SUB_TYPES.find((s) => s.value === subType);
    if (st) return { label: st.label, icon: st.icon || meta.icon };
  }
  if (widget.type === 'table' || widget.type === 'pivotTable') {
    const st = TABLE_SUB_TYPES.find((s) => s.value === widget.type);
    if (st) return { label: st.label, icon: st.icon || meta.icon };
  }
  return { label: meta.label, icon: meta.icon };
}

// Track which sections are collapsed
// Persisted across widget changes — sections stay open/closed
let _sectionState = {};
const useSectionState = () => {
  const [collapsed, setCollapsed] = useState(_sectionState);
  const toggle = useCallback((key) => {
    setCollapsed((p) => {
      // Default state is collapsed (true) when key is not yet set
      const current = p[key] ?? true;
      const next = { ...p, [key]: !current };
      _sectionState = next;
      return next;
    });
  }, []);
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

  // Build field info lookup for tooltips and type detection
  const fieldInfos = {};
  const dimensionNames = new Set();
  if (model) {
    for (const d of (model.dimensions || [])) { fieldInfos[d.name] = { table: d.table, column: d.column }; dimensionNames.add(d.name); }
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

  const removeFromZone = (sourceZone, fieldName) => {
    if (!sourceZone) return;
    const updates = {};
    if (sourceZone === 'axis' || sourceZone === 'category' || sourceZone === 'filter' || sourceZone === 'rows') {
      updates.selectedDimensions = selectedDims.filter((d) => d !== fieldName);
    } else if (sourceZone === 'values' || sourceZone === 'value') {
      updates.selectedMeasures = selectedMeass.filter((m) => m !== fieldName);
    } else if (sourceZone === 'groupBy') {
      updates.groupBy = groupBy.filter((g) => g !== fieldName);
    } else if (sourceZone === 'pivotColumns') {
      updates.columnDimensions = columnDims.filter((d) => d !== fieldName);
    } else if (sourceZone === 'columns') {
      if (selectedDims.includes(fieldName)) updates.selectedDimensions = selectedDims.filter((d) => d !== fieldName);
      if (selectedMeass.includes(fieldName)) updates.selectedMeasures = selectedMeass.filter((m) => m !== fieldName);
      if (binding.columnOrder) updates.columnOrder = binding.columnOrder.filter((f) => f !== fieldName);
    }
    return updates;
  };

  const insertAt = (arr, item, idx) => {
    if (idx == null || idx >= arr.length) return [...arr, item];
    const copy = [...arr];
    copy.splice(idx, 0, item);
    return copy;
  };

  const handleDrop = (zone) => (fieldName, fieldType, sourceZone, dropIndex) => {
    // Remove from source zone if cross-zone move
    const removeUpdates = sourceZone && sourceZone !== zone ? removeFromZone(sourceZone, fieldName) : {};

    const addUpdates = {};
    if (zone === 'groupBy') {
      addUpdates.groupBy = insertAt(removeUpdates.groupBy || groupBy, fieldName, dropIndex);
    } else if (zone === 'pivotColumns') {
      addUpdates.columnDimensions = insertAt(removeUpdates.columnDimensions || columnDims, fieldName, dropIndex);
    } else if (zone === 'columns') {
      // Table: add to both dims/measures lists and columnOrder
      if (fieldType === 'dimension') addUpdates.selectedDimensions = [...(removeUpdates.selectedDimensions || selectedDims), fieldName];
      else addUpdates.selectedMeasures = [...(removeUpdates.selectedMeasures || selectedMeass), fieldName];
      const curOrder = (removeUpdates.columnOrder || binding.columnOrder || [...selectedDims, ...selectedMeass]).filter((f) => f !== fieldName);
      addUpdates.columnOrder = insertAt(curOrder, fieldName, dropIndex);
    } else if (fieldType === 'dimension') {
      addUpdates.selectedDimensions = insertAt(removeUpdates.selectedDimensions || selectedDims, fieldName, dropIndex);
    } else if (fieldType === 'measure') {
      addUpdates.selectedMeasures = insertAt(removeUpdates.selectedMeasures || selectedMeass, fieldName, dropIndex);
    }

    if (sourceZone && sourceZone !== zone) {
      updateBinding({ ...removeUpdates, ...addUpdates });
    } else {
      updateBinding(addUpdates);
    }
  };

  const handleRemove = (fieldName) => {
    const updates = {};
    if (selectedDims.includes(fieldName)) updates.selectedDimensions = selectedDims.filter((d) => d !== fieldName);
    else if (selectedMeass.includes(fieldName)) updates.selectedMeasures = selectedMeass.filter((m) => m !== fieldName);
    // Also clean columnOrder if present
    if (binding.columnOrder) updates.columnOrder = binding.columnOrder.filter((f) => f !== fieldName);
    updateBinding(updates);
  };

  const handleRemoveGroupBy = (fieldName) => {
    removeGroupBy(fieldName);
  };

  const handleReorder = (zone) => (newFields) => {
    if (zone === 'dims') {
      updateBinding({ selectedDimensions: newFields });
    } else if (zone === 'measures') {
      updateBinding({ selectedMeasures: newFields });
    } else if (zone === 'groupBy') {
      updateBinding({ groupBy: newFields });
    } else if (zone === 'columnDims') {
      updateBinding({ columnDimensions: newFields });
    } else if (zone === 'columns') {
      // Table columns: store explicit order to allow mixing dims and measures freely
      const allDimNames = new Set((model?.dimensions || []).map((d) => d.name));
      const dims = newFields.filter((f) => allDimNames.has(f));
      const meass = newFields.filter((f) => !allDimNames.has(f));
      updateBinding({ selectedDimensions: dims, selectedMeasures: meass, columnOrder: newFields });
    }
  };

  // Build field wells per widget type
  const renderFieldWells = () => {
    const type = widget.type;

    if (type === 'bar') {
      return (
        <Section title="" bare>
          <DropZone label="Axis" accepts={['dimension']} fields={selectedDims} zoneName="axis"
            onDrop={handleDrop('axis')} onRemove={handleRemove} onReorder={handleReorder('dims')} fieldInfos={fieldInfos} />
          <DropZone label="Legend" accepts={['dimension']} fields={groupBy} zoneName="groupBy"
            onDrop={handleDrop('groupBy')} onRemove={handleRemoveGroupBy} onReorder={handleReorder('groupBy')} fieldInfos={fieldInfos} />
          <DropZone label="Values" accepts={['measure']} fields={selectedMeass} zoneName="values"
            onDrop={handleDrop('values')} onRemove={handleRemove} onReorder={handleReorder('measures')} multiple fieldInfos={fieldInfos} />
        </Section>
      );
    }

    if (type === 'line') {
      return (
        <Section title="" bare>
          <DropZone label="Axis" accepts={['dimension']} fields={selectedDims} zoneName="axis"
            onDrop={handleDrop('axis')} onRemove={handleRemove} onReorder={handleReorder('dims')} fieldInfos={fieldInfos} />
          <DropZone label="Legend" accepts={['dimension']} fields={groupBy} zoneName="groupBy"
            onDrop={handleDrop('groupBy')} onRemove={handleRemoveGroupBy} onReorder={handleReorder('groupBy')} fieldInfos={fieldInfos} />
          <DropZone label="Values" accepts={['measure']} fields={selectedMeass} zoneName="values"
            onDrop={handleDrop('values')} onRemove={handleRemove} onReorder={handleReorder('measures')} multiple fieldInfos={fieldInfos} />
        </Section>
      );
    }

    if (type === 'scatter') {
      const scatter = binding.scatterMeasures || {};
      const setScatterMeas = (role) => (fieldName) => {
        onUpdate(widgetId, { ...widget, dataBinding: { ...binding, scatterMeasures: { ...scatter, [role]: fieldName } }, data: {} });
      };
      const removeScatterMeas = (role) => () => {
        const next = { ...scatter };
        delete next[role];
        onUpdate(widgetId, { ...widget, dataBinding: { ...binding, scatterMeasures: next }, data: {} });
      };
      return (
        <Section title="" bare>
          <DropZone label="Details" accepts={['dimension']} fields={selectedDims} zoneName="axis"
            onDrop={handleDrop('axis')} onRemove={handleRemove} onReorder={handleReorder('dims')} fieldInfos={fieldInfos} />
          <DropZone label="Legend" accepts={['dimension']} fields={groupBy} zoneName="groupBy"
            onDrop={handleDrop('groupBy')} onRemove={handleRemoveGroupBy} onReorder={handleReorder('groupBy')} fieldInfos={fieldInfos} />
          <DropZone label="X Axis (measure)" accepts={['measure']} fields={scatter.x ? [scatter.x] : []} zoneName="scatterX"
            onDrop={setScatterMeas('x')} onRemove={removeScatterMeas('x')} fieldInfos={fieldInfos} />
          <DropZone label="Y Axis (measure)" accepts={['measure']} fields={scatter.y ? [scatter.y] : []} zoneName="scatterY"
            onDrop={setScatterMeas('y')} onRemove={removeScatterMeas('y')} fieldInfos={fieldInfos} />
          <DropZone label="Size (measure)" accepts={['measure']} fields={scatter.size ? [scatter.size] : []} zoneName="scatterSize"
            onDrop={setScatterMeas('size')} onRemove={removeScatterMeas('size')} fieldInfos={fieldInfos} />
        </Section>
      );
    }

    if (type === 'combo') {
      const comboBarMeas = binding.comboBarMeasures || [];
      const comboLineMeas = binding.comboLineMeasures || [];
      const addComboBar = (fieldName) => updateBinding({ comboBarMeasures: [...comboBarMeas, fieldName] });
      const removeComboBar = (fieldName) => updateBinding({ comboBarMeasures: comboBarMeas.filter((m) => m !== fieldName) });
      const addComboLine = (fieldName) => updateBinding({ comboLineMeasures: [...comboLineMeas, fieldName] });
      const removeComboLine = (fieldName) => updateBinding({ comboLineMeasures: comboLineMeas.filter((m) => m !== fieldName) });
      return (
        <Section title="" bare>
          <DropZone label="Axis" accepts={['dimension']} fields={selectedDims} zoneName="axis"
            onDrop={handleDrop('axis')} onRemove={handleRemove} onReorder={handleReorder('dims')} fieldInfos={fieldInfos} />
          <DropZone label="Legend" accepts={['dimension']} fields={groupBy} zoneName="groupBy"
            onDrop={handleDrop('groupBy')} onRemove={handleRemoveGroupBy} onReorder={handleReorder('groupBy')} fieldInfos={fieldInfos} />
          <DropZone label="Bar values" accepts={['measure']} fields={comboBarMeas} zoneName="comboBar"
            onDrop={(fn) => addComboBar(fn)} onRemove={removeComboBar} onReorder={(arr) => updateBinding({ comboBarMeasures: arr })} multiple fieldInfos={fieldInfos} />
          <DropZone label="Line values" accepts={['measure']} fields={comboLineMeas} zoneName="comboLine"
            onDrop={(fn) => addComboLine(fn)} onRemove={removeComboLine} onReorder={(arr) => updateBinding({ comboLineMeasures: arr })} multiple fieldInfos={fieldInfos} />
        </Section>
      );
    }

    if (type === 'pie') {
      return (
        <Section title="" bare>
          <DropZone label="Category" accepts={['dimension']} fields={selectedDims} zoneName="category"
            onDrop={handleDrop('category')} onRemove={handleRemove} onReorder={handleReorder('dims')} fieldInfos={fieldInfos} />
          <DropZone label="Value" accepts={['measure']} fields={selectedMeass} zoneName="value"
            onDrop={handleDrop('value')} onRemove={handleRemove} onReorder={handleReorder('measures')} fieldInfos={fieldInfos} />
        </Section>
      );
    }

    if (type === 'table') {
      // Use columnOrder if available, otherwise default to dims then measures
      const allCols = [...selectedDims, ...selectedMeass];
      const orderedCols = binding.columnOrder
        ? binding.columnOrder.filter((f) => allCols.includes(f))
        : allCols;
      // Add any new fields not yet in columnOrder
      const missingCols = allCols.filter((f) => !orderedCols.includes(f));
      const tableFields = [...orderedCols, ...missingCols];
      return (
        <Section title="" bare>
          <DropZone label="Columns" accepts={['dimension', 'measure']} fields={tableFields} zoneName="columns"
            onDrop={handleDrop('columns')} onRemove={handleRemove} onReorder={handleReorder('columns')} multiple fieldInfos={fieldInfos} dimensionNames={dimensionNames} />
        </Section>
      );
    }

    if (type === 'scorecard') {
      return (
        <Section title="" bare>
          <DropZone label="Value" accepts={['measure']} fields={selectedMeass} zoneName="value"
            onDrop={handleDrop('value')} onRemove={handleRemove} fieldInfos={fieldInfos} />
        </Section>
      );
    }

    if (type === 'pivotTable') {
      return (
        <Section title="" bare>
          <DropZone label="Rows" accepts={['dimension']} fields={selectedDims} zoneName="rows"
            onDrop={handleDrop('rows')} onRemove={handleRemove} onReorder={handleReorder('dims')} multiple fieldInfos={fieldInfos} />
          <DropZone label="Columns" accepts={['dimension']} fields={columnDims} zoneName="pivotColumns"
            onDrop={handleDrop('pivotColumns')} onRemove={removeColumnDim} onReorder={handleReorder('columnDims')} multiple fieldInfos={fieldInfos} />
          <DropZone label="Values" accepts={['measure']} fields={selectedMeass} zoneName="values"
            onDrop={handleDrop('values')} onRemove={handleRemove} onReorder={handleReorder('measures')} multiple fieldInfos={fieldInfos} />
        </Section>
      );
    }

    if (type === 'filter') {
      return (
        <Section title="" bare>
          <DropZone label="Filter field" accepts={['dimension']} fields={selectedDims} zoneName="filter"
            onDrop={handleDrop('filter')} onRemove={handleRemove} onReorder={handleReorder('dims')} fieldInfos={fieldInfos} />
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

      {(() => {
        const info = getWidgetDisplayInfo(widget);
        const Icon = info.icon;
        return (
          <>
            <div style={headerStyle}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 600, color: '#0f172a' }}>
                {Icon && <Icon size={18} />} {info.label}
              </span>
              <button onClick={() => onDelete(widgetId)} style={deleteStyle} title="Delete widget">
                <TbTrash size={14} />
              </button>
            </div>
            <div style={{ display: 'flex', gap: 3, marginBottom: 12, justifyContent: 'center' }}>
              <button onClick={() => onSendToBack(widgetId)} title="Send to back" style={layerBtn}><TbLayersSubtract size={14} /></button>
              <button onClick={() => onSendBackward(widgetId)} title="Back one" style={layerBtn}><TbArrowBigDown size={14} /></button>
              <button onClick={() => onBringForward(widgetId)} title="Forward one" style={layerBtn}><TbArrowBigUp size={14} /></button>
              <button onClick={() => onBringToFront(widgetId)} title="Bring to front" style={layerBtn}><TbLayersLinked size={14} /></button>
            </div>
          </>
        );
      })()}

      {/* Field wells - drag & drop zones */}
      {renderFieldWells()}

      {(widget.type === 'bar' || widget.type === 'combo') && (() => {
        const dir = widget.config?.barDirection || 'vertical';
        const dirs = [
          { value: 'vertical', rotate: 0, title: 'Bottom to top' },
          { value: 'verticalInverse', rotate: 180, title: 'Top to bottom' },
          { value: 'horizontal', rotate: 90, title: 'Left to right' },
          { value: 'horizontalInverse', rotate: -90, title: 'Right to left' },
        ];
        return (
          <div style={{ display: 'flex', gap: 2, marginBottom: 6, justifyContent: 'center' }}>
            {dirs.map((d) => (
              <button key={d.value} title={d.title}
                onClick={() => updateConfig('barDirection', d.value)}
                style={{
                  padding: '5px 7px', border: '1px solid',
                  borderColor: dir === d.value ? '#3b82f6' : '#e2e8f0',
                  borderRadius: 4, cursor: 'pointer',
                  background: dir === d.value ? '#eff6ff' : '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <TbChartBar size={16} style={{ transform: `rotate(${d.rotate}deg)`, color: dir === d.value ? '#3b82f6' : '#94a3b8' }} />
              </button>
            ))}
          </div>
        );
      })()}

      {(widget.type === 'bar' || widget.type === 'line' || widget.type === 'pie' || widget.type === 'combo') && (
        <Field label="Hide zero values">
          <input type="checkbox" checked={widget.config?.hideZeros ?? false}
            onChange={(e) => updateConfig('hideZeros', e.target.checked)} />
        </Field>
      )}

      {widget.type === 'pie' && (
        <Field label="Donut">
          <input type="checkbox" checked={widget.config?.donut || false} onChange={(e) => updateConfig('donut', e.target.checked)} />
        </Field>
      )}

      {(widget.type === 'bar' || widget.type === 'line' || widget.type === 'pie' || widget.type === 'combo') && (
        <Section title="Sort">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {[
              { value: 'none', label: 'No sort' },
              { value: 'desc', label: 'Descending' },
              { value: 'asc', label: 'Ascending' },
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

      {widget.type === 'filter' && (() => {
        const effStyle = widget.config?.slicerStyle || (widget.data?._isDate ? 'dateRange' : 'list');
        const isDateRange = effStyle === 'dateRange' || effStyle === 'dateBetween';
        const isDateAny = isDateRange || effStyle === 'dateRelative';
        const isListLike = !isDateAny && effStyle !== 'range';
        return (
        <Section title="Slicer Options">
          <Field label="Style">
            <select value={effStyle}
              onChange={(e) => updateConfig('slicerStyle', e.target.value)}
              style={{ ...inputStyle, marginBottom: 0 }}>
              <option value="list">List</option>
              <option value="dropdown">Dropdown</option>
              <option value="buttons">Buttons</option>
              <option value="range">Range</option>
              {widget.data?._isDate && (
                <>
                  <option value="dateRange">📅 Date Range</option>
                  <option value="dateRelative">📅 Relative Date</option>
                </>
              )}
            </select>
          </Field>
          {isDateRange && (
            <Field label="Layout">
              <select value={widget.config?.dateLayout || 'vertical'}
                onChange={(e) => updateConfig('dateLayout', e.target.value)}
                style={{ ...inputStyle, marginBottom: 0 }}>
                <option value="vertical">Vertical</option>
                <option value="horizontal">Horizontal</option>
              </select>
            </Field>
          )}
          {isListLike && (
            <>
              <Field label="Multi-select">
                <input type="checkbox" checked={widget.config?.multiSelect ?? true}
                  onChange={(e) => updateConfig('multiSelect', e.target.checked)} />
              </Field>
              {(effStyle === 'list' || effStyle === 'dropdown') && (
                <Field label="Search bar">
                  <input type="checkbox" checked={widget.config?.showSearch ?? true}
                    onChange={(e) => updateConfig('showSearch', e.target.checked)} />
                </Field>
              )}
              {(effStyle === 'list') && (
                <Field label="Select all">
                  <input type="checkbox" checked={widget.config?.showSelectAll ?? true}
                    onChange={(e) => updateConfig('showSelectAll', e.target.checked)} />
                </Field>
              )}
              {(effStyle === 'list' || effStyle === 'buttons') && (
                <Field label="Orientation">
                  <select value={widget.config?.orientation || 'vertical'}
                    onChange={(e) => updateConfig('orientation', e.target.value)}
                    style={{ ...inputStyle, marginBottom: 0 }}>
                    <option value="vertical">Vertical</option>
                    <option value="horizontal">Horizontal</option>
                  </select>
                </Field>
              )}
            </>
          )}
          <Field label="Font size">
            <input type="number" min={8} max={24} value={widget.config?.slicerFontSize || 12}
              onChange={(e) => updateConfig('slicerFontSize', parseInt(e.target.value) || 12)}
              style={{ ...inputStyle, marginBottom: 0 }} />
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
        );
      })()}

      <Section title="Title">
        <input type="text" value={widget.config?.title || ''} onChange={(e) => updateConfig('title', e.target.value)}
          placeholder="Widget title" style={inputStyle} />
      </Section>

      {widget.type !== 'text' && widget.type !== 'shape' && (
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
                style={{ ...inputStyle, marginBottom: 0 }} />
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
          <RangeInput min={0} max={24} value={widget.config?.borderRadius ?? 8}
            onChange={(e) => updateConfig('borderRadius', parseInt(e.target.value) || 0)} />
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
                style={{ ...inputStyle, marginBottom: 0 }}>
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
        <Field label="Rotation" vertical>
          <RangeInput min={0} max={360} value={widget.config?.rotation ?? 0} suffix="°"
            onChange={(e) => updateConfig('rotation', parseInt(e.target.value))} />
        </Field>
      </Section>

      {/* ── Chart options ── */}
      {(widget.type === 'bar' || widget.type === 'line' || widget.type === 'pie' || widget.type === 'scatter' || widget.type === 'combo') && (
        <Section title="Chart" sectionState={sections}>
          {(widget.type === 'bar' || widget.type === 'line' || widget.type === 'scatter' || widget.type === 'combo') && (
            <Field label="Color">
              <ColorInput value={widget.config?.color || '#5470c6'}
                onChange={(v) => updateConfig('color', v)} />
            </Field>
          )}
          <Field label="Value format">
            <select value={widget.config?.valueAbbreviation || 'none'}
              onChange={(e) => updateConfig('valueAbbreviation', e.target.value)}
              style={{ ...inputStyle, marginBottom: 0 }}>
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
                  style={{ ...inputStyle, marginBottom: 0 }}>
                  <option value="value">Value</option>
                  <option value="name">Name</option>
                  <option value="percent">Percent</option>
                  <option value="nameValue">Name + Value</option>
                </select>
              </Field>
              <Field label="Label format">
                <select value={widget.config?.dataLabelAbbr || 'none'}
                  onChange={(e) => updateConfig('dataLabelAbbr', e.target.value)}
                  style={{ ...inputStyle, marginBottom: 0 }}>
                  <option value="none">Full</option>
                  <option value="auto">Auto (K/M)</option>
                  <option value="K">K (milliers)</option>
                  <option value="M">M (millions)</option>
                  <option value="B">B (milliards)</option>
                </select>
              </Field>
              <Field label="Position">
                {widget.type === 'pie' ? (
                  <select value={widget.config?.dataLabelPosition || 'outside'}
                    onChange={(e) => updateConfig('dataLabelPosition', e.target.value)}
                    style={{ ...inputStyle, marginBottom: 0 }}>
                    <option value="outside">Outside</option>
                    <option value="inside">Inside</option>
                  </select>
                ) : (
                  <select value={widget.config?.dataLabelPosition || 'top'}
                    onChange={(e) => updateConfig('dataLabelPosition', e.target.value)}
                    style={{ ...inputStyle, marginBottom: 0 }}>
                    <option value="top">Au-dessus</option>
                    <option value="inside">Int. milieu</option>
                    <option value="insideTop">Int. haut</option>
                    <option value="insideBottom">Int. bas</option>
                  </select>
                )}
              </Field>
              <Field label="Angle" vertical>
                <RangeInput min={-90} max={90} value={widget.config?.dataLabelRotate ?? 0} suffix="°"
                  onChange={(e) => updateConfig('dataLabelRotate', parseInt(e.target.value))} />
              </Field>
              <Field label="Font size">
                <input type="number" min={6} max={36} value={widget.config?.dataLabelFontSize ?? 10}
                  onChange={(e) => updateConfig('dataLabelFontSize', parseInt(e.target.value) || 10)}
                  style={{ ...inputStyle, width: 50, marginBottom: 0 }} />
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
          <Field label="Show legend">
            <input type="checkbox" checked={widget.config?.showLegend ?? false}
              onChange={(e) => updateConfig('showLegend', e.target.checked)} />
          </Field>
          {widget.config?.showLegend && (
            <SubSection label="Legend">
              <Field label="Position">
                <select value={widget.config?.legendPosition || 'top'}
                  onChange={(e) => updateConfig('legendPosition', e.target.value)}
                  style={{ ...inputStyle, marginBottom: 0 }}>
                  <option value="top">Top</option>
                  <option value="bottom">Bottom</option>
                  <option value="left">Left</option>
                  <option value="right">Right</option>
                </select>
              </Field>
            </SubSection>
          )}
          {widget.type === 'scatter' && (
            <Field label="Point size" vertical>
              <RangeInput min={2} max={30} value={widget.config?.symbolSize ?? 10}
                onChange={(e) => updateConfig('symbolSize', parseInt(e.target.value))} suffix="px" />
            </Field>
          )}
          {widget.type === 'combo' && (
            <>
              <Field label="Smooth lines">
                <input type="checkbox" checked={widget.config?.smooth ?? true}
                  onChange={(e) => updateConfig('smooth', e.target.checked)} />
              </Field>
              <Field label="Secondary Y axis">
                <input type="checkbox" checked={widget.config?.showSecondaryAxis ?? false}
                  onChange={(e) => updateConfig('showSecondaryAxis', e.target.checked)} />
              </Field>
            </>
          )}
          {(widget.type === 'bar' || widget.type === 'line' || widget.type === 'scatter' || widget.type === 'combo') && (
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
                  style={{ ...inputStyle, marginBottom: 0 }}>
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
                  style={{ ...inputStyle, marginBottom: 0 }} />
              </Field>
            </>
          )}
        </Section>
      )}

      {/* Scatter Headers */}
      {widget.type === 'scatter' && (
        <Section title="Headers" sectionState={sections}>
          <Field label="Show X header">
            <input type="checkbox" checked={widget.config?.showXHeader ?? true}
              onChange={(e) => updateConfig('showXHeader', e.target.checked)} />
          </Field>
          {(widget.config?.showXHeader ?? true) && (
            <Field label="X axis title">
              <input type="text" value={widget.config?.xAxisTitle ?? ''}
                placeholder={widget.data?._xLabel || 'X'}
                onChange={(e) => updateConfig('xAxisTitle', e.target.value)}
                style={{ ...inputStyle, marginBottom: 0 }} />
            </Field>
          )}
          <Field label="Show Y header">
            <input type="checkbox" checked={widget.config?.showYHeader ?? true}
              onChange={(e) => updateConfig('showYHeader', e.target.checked)} />
          </Field>
          {(widget.config?.showYHeader ?? true) && (
            <Field label="Y axis title">
              <input type="text" value={widget.config?.yAxisTitle ?? ''}
                placeholder={widget.data?._yLabel || 'Y'}
                onChange={(e) => updateConfig('yAxisTitle', e.target.value)}
                style={{ ...inputStyle, marginBottom: 0 }} />
            </Field>
          )}
          <Field label="Font size">
            <input type="number" min={8} max={24} value={widget.config?.headerFontSize ?? 12}
              onChange={(e) => updateConfig('headerFontSize', parseInt(e.target.value) || 12)}
              style={{ ...inputStyle, width: 50, marginBottom: 0 }} />
          </Field>
          <Field label="Color">
            <ColorInput value={widget.config?.headerColor || '#475569'}
              onChange={(v) => updateConfig('headerColor', v)} />
          </Field>
          <Field label="Bold">
            <input type="checkbox" checked={widget.config?.headerBold ?? false}
              onChange={(e) => updateConfig('headerBold', e.target.checked)} />
          </Field>
        </Section>
      )}

      {/* Legend Colors */}
      {(widget.type === 'bar' || widget.type === 'line' || widget.type === 'pie' || widget.type === 'scatter' || widget.type === 'combo') && (() => {
        // Extract legend values from data
        let legendValues = [];
        if (widget.data?.barSeries || widget.data?.lineSeries) legendValues = [...(widget.data.barSeries || []), ...(widget.data.lineSeries || [])].map((s) => s.name);
        else if (widget.data?.series) legendValues = widget.data.series.map((s) => s.name);
        else if (widget.data?.items) legendValues = widget.data.items.map((it) => it.name);
        else if (widget.data?.seriesGroups) legendValues = widget.data.seriesGroups.map((g) => g.name);
        if (legendValues.length === 0) return null;

        const COLORS = ['#5470c6','#91cc75','#fac858','#ee6666','#73c0de','#3ba272','#fc8452','#9a60b4','#ea7ccc','#5ab1ef'];
        const customColors = widget.config?.legendColors || {};
        const SCATTER_SYMBOLS = [
          { value: 'circle', label: 'Circle' },
          { value: 'rect', label: 'Square' },
          { value: 'roundRect', label: 'Rounded Square' },
          { value: 'triangle', label: 'Triangle' },
          { value: 'diamond', label: 'Diamond' },
          { value: 'pin', label: 'Pin' },
          { value: 'arrow', label: 'Arrow' },
          { value: 'star', label: 'Star' },
        ];
        const customSymbols = widget.config?.legendSymbols || {};
        const customImages = widget.config?.legendImages || {};

        return (
          <Section title="Legend Colors" sectionState={sections}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {legendValues.map((name, i) => (
                <div key={name} style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: 6 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#334155', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <ColorInput
                      value={customColors[name] || COLORS[i % COLORS.length]}
                      onChange={(v) => updateConfig('legendColors', { ...customColors, [name]: v })}
                    />
                    {widget.type === 'scatter' && (
                      <select value={customSymbols[name] || 'circle'}
                        onChange={(e) => updateConfig('legendSymbols', { ...customSymbols, [name]: e.target.value })}
                        style={{ ...inputStyle, marginBottom: 0, fontSize: 10, padding: '2px 4px', flex: 1 }}>
                        {SCATTER_SYMBOLS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                    )}
                  </div>
                  {widget.type === 'scatter' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                      <input type="text" placeholder="Image URL"
                        value={customImages[name] || ''}
                        onChange={(e) => updateConfig('legendImages', { ...customImages, [name]: e.target.value })}
                        style={{ ...inputStyle, flex: 1, fontSize: 10, marginBottom: 0, padding: '2px 4px' }} />
                      {customImages[name] && (
                        <button onClick={() => { const next = { ...customImages }; delete next[name]; updateConfig('legendImages', next); }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 12, padding: 0 }}>×</button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Section>
        );
      })()}

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

      {widget.type === 'shape' && (widget.config?.shape === 'arrow' || widget.config?.shape === 'line') && (
        <Section title="Shape">
          {widget.config?.shape === 'line' && (
            <>
              <Field label="Color">
                <ColorInput value={widget.config?.lineColor || '#1e40af'}
                  onChange={(v) => updateConfig('lineColor', v)} />
              </Field>
              <Field label="Thickness" vertical>
                <RangeInput min={1} max={20} value={widget.config?.lineThickness ?? 2}
                  onChange={(e) => updateConfig('lineThickness', parseInt(e.target.value))} suffix="px" />
              </Field>
            </>
          )}
          {widget.config?.shape === 'arrow' && (
            <>
              <Field label="Fill">
                <ColorInput value={widget.config?.shapeFill || '#3b82f6'}
                  onChange={(v) => updateConfig('shapeFill', v)} />
              </Field>
              <Field label="Stroke">
                <ColorInput value={widget.config?.shapeStroke || '#1e40af'}
                  onChange={(v) => updateConfig('shapeStroke', v)} />
              </Field>
              <Field label="Stroke width">
                <input type="number" min={0} max={20} value={widget.config?.shapeStrokeWidth ?? 2}
                  onChange={(e) => updateConfig('shapeStrokeWidth', parseInt(e.target.value) || 0)}
                  style={{ ...inputStyle, marginBottom: 0 }} />
              </Field>
              <Field label="Opacity (%)">
                <input type="number" min={0} max={100} value={widget.config?.shapeOpacity ?? 100}
                  onChange={(e) => updateConfig('shapeOpacity', parseInt(e.target.value) || 0)}
                  style={{ ...inputStyle, marginBottom: 0 }} />
              </Field>
            </>
          )}
          {widget.config?.shape === 'arrow' && (
            <Field label="Direction">
              <select value={widget.config?.arrowDirection || 'right'}
                onChange={(e) => updateConfig('arrowDirection', e.target.value)}
                style={{ ...inputStyle, marginBottom: 0 }}>
                <option value="right">Right →</option>
                <option value="down">Down ↓</option>
                <option value="left">Left ←</option>
                <option value="up">Up ↑</option>
              </select>
            </Field>
          )}
        </Section>
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
        <span style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>Data</span>
        <button onClick={() => setCollapsed(true)} style={chevronBtn} title="Collapse panel">»</button>
      </div>
      <DataPanel widgetId={widgetId} widget={widget} onUpdate={onUpdate} model={model} onModelUpdate={onModelUpdate} reportFilters={reportFilters} />
    </div>
  );
}

function Section({ title, children, defaultOpen, sectionState, bare }) {
  if (bare) {
    return <div style={{ marginBottom: 8 }}>{children}</div>;
  }

  // Default: closed for collapsible sections, open for non-collapsible
  const defOpen = defaultOpen ?? (sectionState ? false : true);
  const isCollapsed = sectionState ? sectionState.collapsed[title] ?? !defOpen : false;
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
      <span style={{ fontSize: 12, color: '#475569', whiteSpace: 'nowrap', flexShrink: 0 }}>{label}</span>
      <div style={{ flexShrink: 1, minWidth: 0, overflow: 'hidden' }}>{children}</div>
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
          style={{ ...inputStyle, marginBottom: 0 }}>
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
          style={{ ...inputStyle, marginBottom: 0 }}>
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
  width: 210, maxWidth: 210, backgroundColor: '#fff', borderLeft: '1px solid #e2e8f0',
  padding: 12, overflowY: 'auto', flexShrink: 0,
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
  width: 220, maxWidth: 220, backgroundColor: '#fff', borderLeft: '1px solid #e2e8f0',
  padding: 12, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden',
  transition: 'width 0.2s ease, max-width 0.2s ease, padding 0.2s ease',
};

const headerStyle = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid #e2e8f0', fontWeight: 600, fontSize: 14,
};

const radioRow = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' };

const layerBtn = {
  color: '#475569', background: 'none', border: '1px solid #e2e8f0',
  borderRadius: 4, padding: '4px 6px', cursor: 'pointer', display: 'flex', alignItems: 'center',
};

const deleteStyle = {
  color: '#dc2626', background: 'none', border: '1px solid #fca5a5',
  borderRadius: 4, padding: '4px 6px', cursor: 'pointer', display: 'flex', alignItems: 'center',
};

const inputStyle = {
  width: '100%', padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 4,
  fontSize: 13, marginBottom: 8, outline: 'none', boxSizing: 'border-box',
};
