import { useState, useCallback, useEffect, useRef } from 'react';
import { WIDGET_TYPES, BAR_SUB_TYPES, LINE_SUB_TYPES, COMBO_SUB_TYPES, TABLE_SUB_TYPES } from '../Widgets';
import DataPanel from '../DataPanel/DataPanel';
import DropZone from '../DropZone/DropZone';
import TablePropertySections from './TablePropertySections';
import { TbLayersSubtract, TbLayersLinked, TbArrowBigDown, TbArrowBigUp, TbTrash, TbChartBar, TbChevronsLeft, TbChevronsRight, TbChevronDown, TbAdjustments, TbDatabase } from 'react-icons/tb';
import { useResizableWidth } from '../../hooks/useResizableWidth';

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
export function WidgetConfigPanel({ widgetId, widget, onUpdate, onDelete, onBringToFront, onSendToBack, onBringForward, onSendBackward, model, onResizeStart, onResizeEnd }) {
  const [collapsed, setCollapsed] = useState(false);
  const sections = useSectionState();
  const { width, handleProps } = useResizableWidth({ storageKey: 'openreport.configPanelWidth', defaultWidth: 210, min: 180, max: 480, onDragStart: onResizeStart, onDragEnd: onResizeEnd });
  const dynamicConfigStyle = { ...configPanelStyle, width, maxWidth: width, position: 'relative' };

  // Toggle: pin the canvas so it doesn't reflow during the column animation, then unpin once
  // the animation has settled. Same pattern used by the PagesColumn.
  const toggleCollapsed = (val) => {
    onResizeStart?.();
    setCollapsed(val);
    setTimeout(() => onResizeEnd?.(), PANEL_COLLAPSE_TRANSITION_MS + 30);
  };

  if (collapsed) {
    return (
      <div style={collapsedPanelStyle} onClick={() => toggleCollapsed(false)} title="Open config panel">
        <span style={collapsedChevronStyle}><TbChevronsLeft size={14} /></span>
        <TbAdjustments size={14} color="var(--accent-primary)" />
        <span style={collapsedLabelStyle}>Configuration</span>
      </div>
    );
  }

  if (!widgetId || !widget) {
    return (
      <div style={dynamicConfigStyle}>
        <div {...handleProps} />
        <div style={panelHeader}>
          <span style={panelHeaderTitle}>
            <TbAdjustments size={14} color="var(--accent-primary)" />
            Configuration
          </span>
          <button onClick={() => toggleCollapsed(true)} style={chevronBtn} title="Collapse panel"
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.borderColor = 'var(--border-strong)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-panel)'; e.currentTarget.style.borderColor = 'var(--border-default)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
          ><TbChevronsRight size={14} /></button>
        </div>
        <div style={{ color: 'var(--text-disabled)', fontSize: 13, textAlign: 'center', marginTop: 40 }}>
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

  const widgetMeta = WIDGET_TYPES[widget.type];
  const binding = widget.dataBinding || {};

  // Build field info lookup for tooltips and type detection
  const fieldInfos = {};
  const dimensionNames = new Set();
  const measureInfos = {};
  if (model) {
    for (const d of (model.dimensions || [])) { fieldInfos[d.name] = { table: d.table, column: d.column }; dimensionNames.add(d.name); }
    for (const m of (model.measures || [])) {
      fieldInfos[m.name] = { table: m.table, column: m.column };
      // Get aggregation (from widget override or model default)
      const aggOverrides = binding.measureAggOverrides || {};
      measureInfos[m.name] = { aggregation: aggOverrides[m.name] || m.aggregation || 'sum' };
    }
  }

  const handleAggChange = (fieldName, newAgg) => {
    const current = binding.measureAggOverrides || {};
    updateBinding({ measureAggOverrides: { ...current, [fieldName]: newAgg } });
  };
  const selectedDims = binding.selectedDimensions || [];
  const selectedMeass = binding.selectedMeasures || [];

  const updateBinding = (newBinding) => {
    const next = { ...widget, dataBinding: { ...binding, ...newBinding } };
    // Filter widgets: if the dimension changes, clear any saved selection tied to the previous dim
    if (widget?.type === 'filter' && 'selectedDimensions' in newBinding) {
      const oldDim = binding.selectedDimensions?.[0];
      const newDim = newBinding.selectedDimensions?.[0];
      if (oldDim !== newDim) {
        const cfg = { ...(widget.config || {}) };
        delete cfg.selectedValues;
        next.config = cfg;
      }
    }
    onUpdate(widgetId, next);
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

  const handleDrop = (zone) => (fieldName, fieldType, sourceZone, dropIndex, replace) => {
    // Remove from source zone if cross-zone move
    const removeUpdates = sourceZone && sourceZone !== zone ? removeFromZone(sourceZone, fieldName) : {};

    const addUpdates = {};
    if (zone === 'groupBy') {
      addUpdates.groupBy = replace ? [fieldName] : insertAt(removeUpdates.groupBy || groupBy, fieldName, dropIndex);
    } else if (zone === 'pivotColumns') {
      addUpdates.columnDimensions = replace ? [fieldName] : insertAt(removeUpdates.columnDimensions || columnDims, fieldName, dropIndex);
    } else if (zone === 'columns') {
      // Table: add to both dims/measures lists and columnOrder
      if (fieldType === 'dimension') addUpdates.selectedDimensions = replace ? [fieldName] : [...(removeUpdates.selectedDimensions || selectedDims), fieldName];
      else addUpdates.selectedMeasures = replace ? [fieldName] : [...(removeUpdates.selectedMeasures || selectedMeass), fieldName];
      const curOrder = (removeUpdates.columnOrder || binding.columnOrder || [...selectedDims, ...selectedMeass]).filter((f) => f !== fieldName);
      addUpdates.columnOrder = replace ? [fieldName] : insertAt(curOrder, fieldName, dropIndex);
    } else if (fieldType === 'dimension') {
      addUpdates.selectedDimensions = replace ? [fieldName] : insertAt(removeUpdates.selectedDimensions || selectedDims, fieldName, dropIndex);
    } else if (fieldType === 'measure') {
      addUpdates.selectedMeasures = replace ? [fieldName] : insertAt(removeUpdates.selectedMeasures || selectedMeass, fieldName, dropIndex);
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
            onDrop={handleDrop('axis')} onRemove={handleRemove} onReorder={handleReorder('dims')} multiple fieldInfos={fieldInfos} />
          <DropZone label="Legend" accepts={['dimension']} fields={groupBy} zoneName="groupBy"
            onDrop={handleDrop('groupBy')} onRemove={handleRemoveGroupBy} onReorder={handleReorder('groupBy')} fieldInfos={fieldInfos} />
          <DropZone label="Values" accepts={['measure']} measureInfos={measureInfos} onAggChange={handleAggChange} fields={selectedMeass} zoneName="values"
            onDrop={handleDrop('values')} onRemove={handleRemove} onReorder={handleReorder('measures')} multiple fieldInfos={fieldInfos} />
        </Section>
      );
    }

    if (type === 'line') {
      return (
        <Section title="" bare>
          <DropZone label="Axis" accepts={['dimension']} fields={selectedDims} zoneName="axis"
            onDrop={handleDrop('axis')} onRemove={handleRemove} onReorder={handleReorder('dims')} multiple fieldInfos={fieldInfos} />
          <DropZone label="Legend" accepts={['dimension']} fields={groupBy} zoneName="groupBy"
            onDrop={handleDrop('groupBy')} onRemove={handleRemoveGroupBy} onReorder={handleReorder('groupBy')} fieldInfos={fieldInfos} />
          <DropZone label="Values" accepts={['measure']} measureInfos={measureInfos} onAggChange={handleAggChange} fields={selectedMeass} zoneName="values"
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
          <DropZone label="X Axis (measure)" accepts={['measure']} measureInfos={measureInfos} onAggChange={handleAggChange} fields={scatter.x ? [scatter.x] : []} zoneName="scatterX"
            onDrop={setScatterMeas('x')} onRemove={removeScatterMeas('x')} fieldInfos={fieldInfos} />
          <DropZone label="Y Axis (measure)" accepts={['measure']} measureInfos={measureInfos} onAggChange={handleAggChange} fields={scatter.y ? [scatter.y] : []} zoneName="scatterY"
            onDrop={setScatterMeas('y')} onRemove={removeScatterMeas('y')} fieldInfos={fieldInfos} />
          <DropZone label="Size (measure)" accepts={['measure']} measureInfos={measureInfos} onAggChange={handleAggChange} fields={scatter.size ? [scatter.size] : []} zoneName="scatterSize"
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
            onDrop={handleDrop('axis')} onRemove={handleRemove} onReorder={handleReorder('dims')} multiple fieldInfos={fieldInfos} />
          <DropZone label="Legend" accepts={['dimension']} fields={groupBy} zoneName="groupBy"
            onDrop={handleDrop('groupBy')} onRemove={handleRemoveGroupBy} onReorder={handleReorder('groupBy')} fieldInfos={fieldInfos} />
          <DropZone label="Bar values" accepts={['measure']} measureInfos={measureInfos} onAggChange={handleAggChange} fields={comboBarMeas} zoneName="comboBar"
            onDrop={(fn) => addComboBar(fn)} onRemove={removeComboBar} onReorder={(arr) => updateBinding({ comboBarMeasures: arr })} multiple fieldInfos={fieldInfos} />
          <DropZone label="Line values" accepts={['measure']} measureInfos={measureInfos} onAggChange={handleAggChange} fields={comboLineMeas} zoneName="comboLine"
            onDrop={(fn) => addComboLine(fn)} onRemove={removeComboLine} onReorder={(arr) => updateBinding({ comboLineMeasures: arr })} multiple fieldInfos={fieldInfos} />
        </Section>
      );
    }

    if (type === 'pie' || type === 'treemap') {
      return (
        <Section title="" bare>
          <DropZone label="Category" accepts={['dimension']} fields={selectedDims} zoneName="category"
            onDrop={handleDrop('category')} onRemove={handleRemove} onReorder={handleReorder('dims')} multiple fieldInfos={fieldInfos} />
          <DropZone label="Value" accepts={['measure']} measureInfos={measureInfos} onAggChange={handleAggChange} fields={selectedMeass} zoneName="value"
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
          <DropZone label="Value" accepts={['measure']} measureInfos={measureInfos} onAggChange={handleAggChange} fields={selectedMeass} zoneName="value"
            onDrop={handleDrop('value')} onRemove={handleRemove} fieldInfos={fieldInfos} />
        </Section>
      );
    }

    if (type === 'gauge') {
      const thresholdMeas = binding.gaugeThresholdMeasure;
      const maxMeas = binding.gaugeMaxMeasure;
      const setBindingField = (fieldKey) => (fieldName) => {
        onUpdate(widgetId, { ...widget, dataBinding: { ...binding, [fieldKey]: fieldName }, data: {} });
      };
      const removeBindingField = (fieldKey) => () => {
        const next = { ...binding };
        delete next[fieldKey];
        onUpdate(widgetId, { ...widget, dataBinding: next, data: {} });
      };
      return (
        <Section title="" bare>
          <DropZone label="Value" accepts={['measure']} measureInfos={measureInfos} onAggChange={handleAggChange} fields={selectedMeass} zoneName="value"
            onDrop={handleDrop('value')} onRemove={handleRemove} fieldInfos={fieldInfos} />
          <DropZone label="Max (measure)" accepts={['measure']} measureInfos={measureInfos} onAggChange={handleAggChange} fields={maxMeas ? [maxMeas] : []} zoneName="gaugeMax"
            onDrop={setBindingField('gaugeMaxMeasure')} onRemove={removeBindingField('gaugeMaxMeasure')} fieldInfos={fieldInfos} />
          <DropZone label="Threshold (measure)" accepts={['measure']} measureInfos={measureInfos} onAggChange={handleAggChange} fields={thresholdMeas ? [thresholdMeas] : []} zoneName="gaugeThreshold"
            onDrop={setBindingField('gaugeThresholdMeasure')} onRemove={removeBindingField('gaugeThresholdMeasure')} fieldInfos={fieldInfos} />
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
          <DropZone label="Values" accepts={['measure']} measureInfos={measureInfos} onAggChange={handleAggChange} fields={selectedMeass} zoneName="values"
            onDrop={handleDrop('values')} onRemove={handleRemove} onReorder={handleReorder('measures')} multiple fieldInfos={fieldInfos} />
        </Section>
      );
    }

    if (type === 'customVisual') {
      const manifest = widget.config?.manifest || {};
      const ds = manifest.dataSchema || {};
      const dimSlots = Array.isArray(ds.dimensions) ? ds.dimensions : [];
      const measSlots = Array.isArray(ds.measures) ? ds.measures : [];
      const dimLabel = dimSlots.map((d) => d.label || d.role || 'Dimensions').join(' / ') || 'Dimensions';
      const measLabel = measSlots.map((m) => m.label || m.role || 'Measures').join(' / ') || 'Measures';
      return (
        <Section title="" bare>
          <DropZone label={dimLabel} accepts={['dimension']} fields={selectedDims} zoneName="axis"
            onDrop={handleDrop('axis')} onRemove={handleRemove} onReorder={handleReorder('dims')} multiple fieldInfos={fieldInfos} />
          <DropZone label={measLabel} accepts={['measure']} measureInfos={measureInfos} onAggChange={handleAggChange} fields={selectedMeass} zoneName="values"
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
    <div style={dynamicConfigStyle}>
      <div {...handleProps} />
      <div style={panelHeader}>
        <span style={panelHeaderTitle}>
          <TbAdjustments size={14} color="var(--accent-primary)" />
          Configuration
        </span>
        <button onClick={() => toggleCollapsed(true)} style={chevronBtn} title="Collapse panel"
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.borderColor = 'var(--border-strong)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-panel)'; e.currentTarget.style.borderColor = 'var(--border-default)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
        ><TbChevronsRight size={14} /></button>
      </div>

      {(() => {
        const info = getWidgetDisplayInfo(widget);
        const Icon = info.icon;
        const rowCount = widget.data?._rowCount;
        const maxReached = widget.data?._maxReached;
        return (
          <>
            <div style={headerStyle}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                  {Icon && <Icon size={18} />} {info.label}
                </span>
                {typeof rowCount === 'number' && (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>
                    {maxReached ? '1,000,000 rows (limit reached)' : `${rowCount.toLocaleString('fr-FR')} rows`}
                  </span>
                )}
              </div>
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
                  borderColor: dir === d.value ? 'var(--accent-primary)' : 'var(--border-default)',
                  borderRadius: 4, cursor: 'pointer',
                  background: dir === d.value ? 'var(--bg-active)' : 'var(--bg-panel)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <TbChartBar size={16} style={{ transform: `rotate(${d.rotate}deg)`, color: dir === d.value ? 'var(--accent-primary)' : 'var(--text-disabled)' }} />
              </button>
            ))}
          </div>
        );
      })()}

      {widget.type === 'gauge' && widget.config?.subType === 'column' && (() => {
        const dir = widget.config?.gaugeDirection || 'up';
        const dirs = [
          { value: 'up', rotate: 0, title: 'Bottom to top' },
          { value: 'down', rotate: 180, title: 'Top to bottom' },
          { value: 'right', rotate: 90, title: 'Left to right' },
          { value: 'left', rotate: -90, title: 'Right to left' },
        ];
        return (
          <div style={{ display: 'flex', gap: 2, marginBottom: 6, justifyContent: 'center' }}>
            {dirs.map((d) => (
              <button key={d.value} title={d.title}
                onClick={() => updateConfig('gaugeDirection', d.value)}
                style={{
                  padding: '5px 7px', border: '1px solid',
                  borderColor: dir === d.value ? 'var(--accent-primary)' : 'var(--border-default)',
                  borderRadius: 4, cursor: 'pointer',
                  background: dir === d.value ? 'var(--bg-active)' : 'var(--bg-panel)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <TbChartBar size={16} style={{ transform: `rotate(${d.rotate}deg)`, color: dir === d.value ? 'var(--accent-primary)' : 'var(--text-disabled)' }} />
              </button>
            ))}
          </div>
        );
      })()}

      {(widget.type === 'bar' || widget.type === 'line' || widget.type === 'combo') && (
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

      {(widget.type === 'bar' || widget.type === 'line' || widget.type === 'pie' || widget.type === 'combo' || widget.type === 'treemap') && (
        <Section title="Sort">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {[
              { value: 'none', label: 'No sort' },
              { value: 'desc', label: 'Descending' },
              { value: 'asc', label: 'Ascending' },
            ].map((opt) => (
              <label key={opt.value} style={radioRow}>
                <input type="radio" name="sortOrder"
                  checked={(widget.config?.sortOrder || (widget.type === 'treemap' ? 'desc' : 'none')) === opt.value}
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
            <ColorInput value={widget.config?.slicerSelectedColor || '#7c3aed'}
              onChange={(v) => updateConfig('slicerSelectedColor', v)} />
          </Field>
          <Field label="Selected bg">
            <ColorInput value={widget.config?.slicerSelectedBg || '#f5f3ff'}
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
              <Field label="Value color">
                <ColorInput value={widget.config?.valueColor || '#0f172a'}
                  onChange={(v) => updateConfig('valueColor', v)} />
              </Field>
              <Field label="Label size">
                <input type="number" min={8} max={32} value={widget.config?.labelSize || 14}
                  onChange={(e) => updateConfig('labelSize', parseInt(e.target.value))} style={{ ...inputStyle, width: 60 }} />
              </Field>
              <Field label="Label color">
                <ColorInput value={widget.config?.labelColor || '#64748b'}
                  onChange={(v) => updateConfig('labelColor', v)} />
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
          {widget.type !== 'filter' && (
            <>
              <Field label="Empty message">
                <input type="text" value={widget.config?.emptyMessage ?? ''}
                  onChange={(e) => updateConfig('emptyMessage', e.target.value)}
                  placeholder="No values"
                  style={{ ...inputStyle, marginBottom: 0 }} />
              </Field>
              <Field label={'Hide "No values"'}>
                <input type="checkbox" checked={widget.config?.hideEmptyMessage || false}
                  onChange={(e) => updateConfig('hideEmptyMessage', e.target.checked)} />
              </Field>
            </>
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
      {(widget.type === 'bar' || widget.type === 'line' || widget.type === 'pie' || widget.type === 'scatter' || widget.type === 'combo' || widget.type === 'treemap') && (
        <Section title="Chart" sectionState={sections}>
          {(widget.type === 'bar' || widget.type === 'line' || widget.type === 'scatter') && (
            <Field label="Color">
              <ColorInput value={widget.config?.color || '#5470c6'}
                onChange={(v) => updateConfig('color', v)} />
            </Field>
          )}
          {/* Color gradient (min→max) — overrides per-series colors when enabled. Skipped on stacked bar/combo at render time. */}
          {(widget.type === 'bar' || widget.type === 'treemap' || widget.type === 'scatter' || widget.type === 'pie' || widget.type === 'combo') && (() => {
            const grad = widget.config?.valueGradient || {};
            const setGrad = (patch) => updateConfig('valueGradient', { ...grad, ...patch });
            const isStackedBar = widget.type === 'bar' && (widget.config?.subType === 'stacked' || widget.config?.subType === 'stacked100');
            const isStackedCombo = widget.type === 'combo' && (widget.config?.subType ?? 'stackedCombo') === 'stackedCombo';
            return (
              <>
                <Field label="Color gradient">
                  <input type="checkbox" checked={grad.enabled === true}
                    onChange={(e) => setGrad({ enabled: e.target.checked })} />
                </Field>
                {grad.enabled && (
                  <>
                    <Field label="Min color">
                      <ColorInput value={grad.minColor || '#dcfce7'} onChange={(v) => setGrad({ minColor: v })} />
                    </Field>
                    <Field label="Max color">
                      <ColorInput value={grad.maxColor || '#7c3aed'} onChange={(v) => setGrad({ maxColor: v })} />
                    </Field>
                    {isStackedBar && (
                      <div style={{ fontSize: 10, color: 'var(--text-disabled)', marginTop: 4 }}>
                        Disabled on stacked bars — switch to Grouped/100% to use the gradient.
                      </div>
                    )}
                    {isStackedCombo && (
                      <div style={{ fontSize: 10, color: 'var(--text-disabled)', marginTop: 4 }}>
                        Disabled on Stacked Combo — switch to Clustered Combo to use the gradient.
                      </div>
                    )}
                    {widget.type === 'scatter' && (
                      <div style={{ fontSize: 10, color: 'var(--text-disabled)', marginTop: 4 }}>
                        Coloured by Size measure if bound, otherwise by Y.
                      </div>
                    )}
                    {widget.type === 'combo' && !isStackedCombo && (
                      <div style={{ fontSize: 10, color: 'var(--text-disabled)', marginTop: 4 }}>
                        Applied to bar segments only — line series keep their own colour.
                      </div>
                    )}
                  </>
                )}
              </>
            );
          })()}
          {(widget.type === 'bar' || widget.type === 'line' || widget.type === 'combo') && (
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
          )}
          <Field label="Data labels">
            <input type="checkbox" checked={widget.config?.showDataLabels ?? false}
              onChange={(e) => updateConfig('showDataLabels', e.target.checked)} />
          </Field>
          {widget.config?.showDataLabels && (() => {
            const t = widget.type;
            const canContent = t === 'bar' || t === 'line' || t === 'pie' || t === 'treemap';
            const canPosition = t === 'bar' || t === 'line' || t === 'pie';
            const canAngle = t === 'bar' || t === 'line' || t === 'pie';
            const canColor = t !== 'scatter'; // scatter has fixed label color
            const canBg = t === 'bar' || t === 'line' || t === 'pie';
            return (
              <SubSection label="Data labels">
                {canContent && (
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
                )}
                {canContent && (
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
                )}
                {canPosition && (
                  <Field label="Position">
                    {t === 'pie' ? (
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
                )}
                {canAngle && (
                  <Field label="Angle" vertical>
                    <RangeInput min={-90} max={90} value={widget.config?.dataLabelRotate ?? 0} suffix="°"
                      onChange={(e) => updateConfig('dataLabelRotate', parseInt(e.target.value))} />
                  </Field>
                )}
                <Field label="Font size">
                  <input type="number" min={6} max={36} value={widget.config?.dataLabelFontSize ?? 10}
                    onChange={(e) => updateConfig('dataLabelFontSize', parseInt(e.target.value) || 10)}
                    style={{ ...inputStyle, width: 50, marginBottom: 0 }} />
                </Field>
                {canColor && (
                  <Field label="Label color">
                    <ColorInput value={widget.config?.dataLabelColor || '#475569'}
                      onChange={(v) => updateConfig('dataLabelColor', v)} />
                  </Field>
                )}
                {canBg && (
                  <>
                    <Field label="Label bg color">
                      <ColorInput value={widget.config?.dataLabelBgColor || '#ffffff'}
                        onChange={(v) => updateConfig('dataLabelBgColor', v)} />
                    </Field>
                    <Field label="Label bg opacity" vertical>
                      <RangeInput min={0} max={100} value={widget.config?.dataLabelBgOpacity ?? 0} suffix="%"
                        onChange={(e) => updateConfig('dataLabelBgOpacity', parseInt(e.target.value))} />
                    </Field>
                  </>
                )}
              </SubSection>
            );
          })()}
          {(widget.type === 'bar' || widget.type === 'line') && (
            <Field label="Show column names">
              <input type="checkbox" checked={widget.config?.showColumnNames ?? true}
                onChange={(e) => updateConfig('showColumnNames', e.target.checked)} />
            </Field>
          )}
          {widget.type !== 'treemap' && (
            <>
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
            </>
          )}
          {widget.type === 'scatter' && (
            <Field label="Point size" vertical>
              <RangeInput min={2} max={30} value={widget.config?.symbolSize ?? 10}
                onChange={(e) => updateConfig('symbolSize', parseInt(e.target.value))} suffix="px" />
            </Field>
          )}
          {widget.type === 'combo' && (
            <Field label="Smooth lines">
              <input type="checkbox" checked={widget.config?.smooth ?? true}
                onChange={(e) => updateConfig('smooth', e.target.checked)} />
            </Field>
          )}
          {(widget.type === 'bar' || widget.type === 'line' || widget.type === 'scatter' || widget.type === 'combo') && (
            <>
              <Field label="Show X axis">
                <input type="checkbox" checked={widget.config?.showXAxis ?? true}
                  onChange={(e) => updateConfig('showXAxis', e.target.checked)} />
              </Field>
              {(widget.config?.showXAxis ?? true) && (
                <SubSection label="X axis">
                  <Field label="Show title">
                    <input type="checkbox" checked={widget.config?.showXAxisTitle ?? true}
                      onChange={(e) => updateConfig('showXAxisTitle', e.target.checked)} />
                  </Field>
                  {(widget.config?.showXAxisTitle ?? true) && (
                    <Field label="Title">
                      <input type="text" value={widget.config?.xAxisTitle ?? ''}
                        placeholder={widget.data?._xLabel || widget.data?._dimLabel || 'Auto'}
                        onChange={(e) => updateConfig('xAxisTitle', e.target.value)}
                        style={{ ...inputStyle, marginBottom: 0 }} />
                    </Field>
                  )}
                  <Field label="Font size">
                    <input type="number" min={6} max={24} value={widget.config?.xAxisLabelFontSize ?? 11}
                      onChange={(e) => updateConfig('xAxisLabelFontSize', parseInt(e.target.value) || 11)}
                      style={{ ...inputStyle, width: 60, marginBottom: 0 }} />
                  </Field>
                  <Field label="Color">
                    <ColorInput value={widget.config?.xAxisLabelColor || '#64748b'}
                      onChange={(v) => updateConfig('xAxisLabelColor', v)} />
                  </Field>
                </SubSection>
              )}
              <Field label="Show Y axis">
                <input type="checkbox" checked={widget.config?.showYAxis ?? true}
                  onChange={(e) => updateConfig('showYAxis', e.target.checked)} />
              </Field>
              <Field label="Y axis step">
                <input type="number" min={0} step={1}
                  value={widget.config?.yAxisInterval ?? ''}
                  placeholder="Auto"
                  onChange={(e) => updateConfig('yAxisInterval', e.target.value ? parseFloat(e.target.value) : null)}
                  style={{ ...inputStyle, marginBottom: 0 }} />
              </Field>
              {(widget.config?.showYAxis ?? true) && (
                <SubSection label="Y axis">
                  <Field label="Show title">
                    <input type="checkbox" checked={widget.config?.showYAxisTitle ?? true}
                      onChange={(e) => updateConfig('showYAxisTitle', e.target.checked)} />
                  </Field>
                  {(widget.config?.showYAxisTitle ?? true) && (
                    <Field label="Title">
                      <input type="text" value={widget.config?.yAxisTitle ?? ''}
                        placeholder={widget.data?._yLabel || widget.data?._measureLabel || 'Auto'}
                        onChange={(e) => updateConfig('yAxisTitle', e.target.value)}
                        style={{ ...inputStyle, marginBottom: 0 }} />
                    </Field>
                  )}
                  <Field label="Font size">
                    <input type="number" min={6} max={24} value={widget.config?.yAxisLabelFontSize ?? 11}
                      onChange={(e) => updateConfig('yAxisLabelFontSize', parseInt(e.target.value) || 11)}
                      style={{ ...inputStyle, width: 60, marginBottom: 0 }} />
                  </Field>
                  <Field label="Color">
                    <ColorInput value={widget.config?.yAxisLabelColor || '#64748b'}
                      onChange={(v) => updateConfig('yAxisLabelColor', v)} />
                  </Field>
                </SubSection>
              )}
              {widget.type === 'combo' && (
                <>
                  <Field label="Secondary Y axis">
                    <input type="checkbox" checked={widget.config?.showSecondaryAxis ?? true}
                      onChange={(e) => updateConfig('showSecondaryAxis', e.target.checked)} />
                  </Field>
                  {widget.config?.showSecondaryAxis !== false && (
                    <>
                      <SubSection label="Right Y axis">
                        <Field label="Step">
                          <input type="number" min={0} step={1}
                            value={widget.config?.secondaryYAxisInterval ?? ''}
                            placeholder="Auto"
                            onChange={(e) => updateConfig('secondaryYAxisInterval', e.target.value ? parseFloat(e.target.value) : null)}
                            style={{ ...inputStyle, marginBottom: 0 }} />
                        </Field>
                        <Field label="Show title">
                          <input type="checkbox" checked={widget.config?.showSecondaryYAxisTitle ?? true}
                            onChange={(e) => updateConfig('showSecondaryYAxisTitle', e.target.checked)} />
                        </Field>
                        {(widget.config?.showSecondaryYAxisTitle ?? true) && (
                          <Field label="Title">
                            <input type="text" value={widget.config?.secondaryYAxisTitle ?? ''}
                              placeholder="Auto"
                              onChange={(e) => updateConfig('secondaryYAxisTitle', e.target.value)}
                              style={{ ...inputStyle, marginBottom: 0 }} />
                          </Field>
                        )}
                        <Field label="Font size">
                          <input type="number" min={6} max={24} value={widget.config?.secondaryYAxisLabelFontSize ?? 11}
                            onChange={(e) => updateConfig('secondaryYAxisLabelFontSize', parseInt(e.target.value) || 11)}
                            style={{ ...inputStyle, width: 60, marginBottom: 0 }} />
                        </Field>
                        <Field label="Color">
                          <ColorInput value={widget.config?.secondaryYAxisLabelColor || '#64748b'}
                            onChange={(v) => updateConfig('secondaryYAxisLabelColor', v)} />
                        </Field>
                      </SubSection>
                    </>
                  )}
                </>
              )}
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
            </>
          )}
        </Section>
      )}

      {/* Scatter title style (applies to axis titles) */}
      {widget.type === 'scatter' && (
        <Section title="Title style" sectionState={sections}>
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
      {(widget.type === 'bar' || widget.type === 'line' || widget.type === 'pie' || widget.type === 'scatter' || widget.type === 'combo' || widget.type === 'treemap') && (() => {
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
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
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
                          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-disabled)', fontSize: 12, padding: 0 }}>×</button>
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
                <ColorInput value={widget.config?.lineColor || '#6d28d9'}
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
                <ColorInput value={widget.config?.shapeFill || '#7c3aed'}
                  onChange={(v) => updateConfig('shapeFill', v)} />
              </Field>
              <Field label="Stroke">
                <ColorInput value={widget.config?.shapeStroke || '#6d28d9'}
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
          <Field label="Point shape">
            <select value={widget.config?.lineSymbol ?? 'circle'}
              onChange={(e) => updateConfig('lineSymbol', e.target.value)}
              style={{ ...inputStyle, marginBottom: 0 }}>
              <option value="circle">● Circle</option>
              <option value="emptyCircle">○ Empty circle</option>
              <option value="rect">■ Square</option>
              <option value="roundRect">▢ Rounded square</option>
              <option value="triangle">▲ Triangle</option>
              <option value="diamond">◆ Diamond</option>
              <option value="pin">📍 Pin</option>
              <option value="arrow">➤ Arrow</option>
              <option value="none">— Hide</option>
            </select>
          </Field>
          {(widget.config?.lineSymbol ?? 'circle') !== 'none' && (
            <Field label="Point size" vertical>
              <RangeInput min={2} max={20} value={widget.config?.lineSymbolSize ?? 6}
                onChange={(e) => updateConfig('lineSymbolSize', parseInt(e.target.value))} suffix="px" />
            </Field>
          )}
        </Section>
      )}

      {widget.type === 'treemap' && (
        <Section title="TreeMap" sectionState={sections}>
          <Field label="Show item borders">
            <input type="checkbox" checked={widget.config?.showItemBorder ?? true}
              onChange={(e) => updateConfig('showItemBorder', e.target.checked)} />
          </Field>
          {(widget.config?.showItemBorder ?? true) && (
            <>
              <Field label="Border color">
                <input type="color" value={widget.config?.itemBorderColor || '#ffffff'}
                  onChange={(e) => updateConfig('itemBorderColor', e.target.value)}
                  style={{ width: 32, height: 20, padding: 0, border: '1px solid var(--border-default)', borderRadius: 3 }} />
              </Field>
              <Field label="Border width" vertical>
                <RangeInput min={0} max={8} value={widget.config?.itemBorderWidth ?? 1}
                  onChange={(e) => updateConfig('itemBorderWidth', parseInt(e.target.value))} suffix="px" />
              </Field>
            </>
          )}
        </Section>
      )}

      {widget.type === 'gauge' && (
        <Section title="Gauge" sectionState={sections}>
          <Field label="Min value">
            <DecimalInput value={widget.config?.gaugeMin ?? 0}
              onChange={(v) => updateConfig('gaugeMin', v === undefined ? 0 : v)}
              style={{ ...inputStyle, width: 80 }} />
          </Field>
          {!widget.dataBinding?.gaugeMaxMeasure && (
            <Field label="Max value">
              <DecimalInput value={widget.config?.gaugeMax ?? 100}
                onChange={(v) => updateConfig('gaugeMax', v === undefined ? 100 : v)}
                style={{ ...inputStyle, width: 80 }} />
            </Field>
          )}
          <Field label={widget.config?.subType === 'column' ? 'Bar thickness' : 'Arc thickness'} vertical>
            <RangeInput
              min={widget.config?.subType === 'column' ? 10 : 4}
              max={widget.config?.subType === 'column' ? 120 : 60}
              value={widget.config?.gaugeArcWidth ?? (widget.config?.subType === 'column' ? 40 : 18)}
              onChange={(e) => updateConfig('gaugeArcWidth', parseInt(e.target.value))}
              suffix="px" />
          </Field>
          {widget.config?.subType !== 'column' && (
            <Field label="Arc opening" vertical>
              <RangeInput min={90} max={360} step={10} value={widget.config?.gaugeArcSpan ?? 240}
                onChange={(e) => updateConfig('gaugeArcSpan', parseInt(e.target.value))} suffix="°" />
            </Field>
          )}
          {widget.config?.subType === 'column' && (
            <Field label="Rounded ends">
              <input type="checkbox" checked={widget.config?.gaugeArcRounded ?? false}
                onChange={(e) => updateConfig('gaugeArcRounded', e.target.checked)} />
            </Field>
          )}
          <Field label="Fill color">
            <input type="color" value={widget.config?.gaugeColor || '#7c3aed'}
              onChange={(e) => updateConfig('gaugeColor', e.target.value)}
              style={{ width: 32, height: 20, padding: 0, border: '1px solid var(--border-default)', borderRadius: 3 }} />
          </Field>
          <Field label="Track color">
            <input type="color" value={widget.config?.gaugeTrackColor || '#e2e8f0'}
              onChange={(e) => updateConfig('gaugeTrackColor', e.target.value)}
              style={{ width: 32, height: 20, padding: 0, border: '1px solid var(--border-default)', borderRadius: 3 }} />
          </Field>
          {/* Color gradient (min→max) — overrides Fill color and threshold colour when enabled. */}
          {(() => {
            const grad = widget.config?.valueGradient || {};
            const setGrad = (patch) => updateConfig('valueGradient', { ...grad, ...patch });
            return (
              <>
                <Field label="Color gradient">
                  <input type="checkbox" checked={grad.enabled === true}
                    onChange={(e) => setGrad({ enabled: e.target.checked })} />
                </Field>
                {grad.enabled && (
                  <>
                    <Field label="Min color">
                      <ColorInput value={grad.minColor || '#dcfce7'} onChange={(v) => setGrad({ minColor: v })} />
                    </Field>
                    <Field label="Max color">
                      <ColorInput value={grad.maxColor || '#7c3aed'} onChange={(v) => setGrad({ maxColor: v })} />
                    </Field>
                  </>
                )}
              </>
            );
          })()}
          <Field label="Color on threshold">
            <input type="checkbox" checked={widget.config?.gaugeConditionalColor || false}
              onChange={(e) => updateConfig('gaugeConditionalColor', e.target.checked)} />
          </Field>
          {widget.config?.gaugeConditionalColor && (
            <Field label="Over-threshold color">
              <input type="color" value={widget.config?.gaugeOverColor || '#dc2626'}
                onChange={(e) => updateConfig('gaugeOverColor', e.target.value)}
                style={{ width: 32, height: 20, padding: 0, border: '1px solid var(--border-default)', borderRadius: 3 }} />
            </Field>
          )}
          {!widget.dataBinding?.gaugeThresholdMeasure && (
            <Field label="Threshold value">
              <DecimalInput value={widget.config?.gaugeThresholdValue ?? undefined}
                onChange={(v) => updateConfig('gaugeThresholdValue', v)}
                placeholder="None"
                style={{ ...inputStyle, width: 80 }} />
            </Field>
          )}
          <Field label="Threshold color">
            <input type="color" value={widget.config?.gaugeThresholdColor || '#dc2626'}
              onChange={(e) => updateConfig('gaugeThresholdColor', e.target.value)}
              style={{ width: 32, height: 20, padding: 0, border: '1px solid var(--border-default)', borderRadius: 3 }} />
          </Field>
          <Field label="Show value">
            <input type="checkbox" checked={widget.config?.gaugeShowValue ?? true}
              onChange={(e) => updateConfig('gaugeShowValue', e.target.checked)} />
          </Field>
          <Field label="Show label">
            <input type="checkbox" checked={widget.config?.gaugeShowLabel ?? true}
              onChange={(e) => updateConfig('gaugeShowLabel', e.target.checked)} />
          </Field>
          <Field label="Show min/max">
            <input type="checkbox" checked={widget.config?.gaugeShowMinMax ?? false}
              onChange={(e) => updateConfig('gaugeShowMinMax', e.target.checked)} />
          </Field>
          <SubSection label="Value font">
            <Field label="Size" vertical>
              <RangeInput min={10} max={60} value={widget.config?.gaugeValueSize ?? (widget.config?.subType === 'column' ? 20 : 24)}
                onChange={(e) => updateConfig('gaugeValueSize', parseInt(e.target.value))} suffix="px" />
            </Field>
            <Field label="Color">
              <input type="color" value={widget.config?.gaugeValueColor || '#0f172a'}
                onChange={(e) => updateConfig('gaugeValueColor', e.target.value)}
                style={{ width: 32, height: 20, padding: 0, border: '1px solid var(--border-default)', borderRadius: 3 }} />
            </Field>
          </SubSection>
          <SubSection label="Label font">
            <Field label="Size" vertical>
              <RangeInput min={8} max={30} value={widget.config?.gaugeLabelSize ?? 12}
                onChange={(e) => updateConfig('gaugeLabelSize', parseInt(e.target.value))} suffix="px" />
            </Field>
            <Field label="Color">
              <input type="color" value={widget.config?.gaugeLabelColor || '#64748b'}
                onChange={(e) => updateConfig('gaugeLabelColor', e.target.value)}
                style={{ width: 32, height: 20, padding: 0, border: '1px solid var(--border-default)', borderRadius: 3 }} />
            </Field>
          </SubSection>
          {(widget.config?.gaugeShowMinMax ?? false) && (
            <SubSection label="Min/Max font">
              <Field label="Size" vertical>
                <RangeInput min={8} max={24} value={widget.config?.gaugeAxisSize ?? (widget.config?.subType === 'column' ? 10 : 11)}
                  onChange={(e) => updateConfig('gaugeAxisSize', parseInt(e.target.value))} suffix="px" />
              </Field>
              <Field label="Color">
                <input type="color" value={widget.config?.gaugeAxisColor || '#94a3b8'}
                  onChange={(e) => updateConfig('gaugeAxisColor', e.target.value)}
                  style={{ width: 32, height: 20, padding: 0, border: '1px solid var(--border-default)', borderRadius: 3 }} />
              </Field>
              {widget.config?.subType !== 'column' && (
                <>
                  <Field label="Distance from arc" vertical>
                    <RangeInput min={-20} max={80} value={widget.config?.gaugeAxisOutset ?? 25}
                      onChange={(e) => updateConfig('gaugeAxisOutset', parseInt(e.target.value))} suffix="px" />
                  </Field>
                  <Field label="Pull to center" vertical>
                    <RangeInput min={0} max={200} value={widget.config?.gaugeAxisCenterPull ?? 15}
                      onChange={(e) => updateConfig('gaugeAxisCenterPull', parseInt(e.target.value))} suffix="px" />
                  </Field>
                </>
              )}
            </SubSection>
          )}
        </Section>
      )}

      {/* Custom visual options — auto-generated from manifest.configSchema */}
      {widget.type === 'customVisual' && (() => {
        const cs = widget.config?.manifest?.configSchema;
        if (!Array.isArray(cs) || cs.length === 0) return null;
        return (
          <Section title={widget.config?.visualName || 'Custom Visual'} sectionState={sections}>
            {cs.map((opt) => {
              if (!opt || typeof opt !== 'object' || !opt.key) return null;
              const value = widget.config?.[opt.key] ?? opt.default;
              const label = opt.label || opt.key;
              if (opt.type === 'boolean') {
                return (
                  <Field key={opt.key} label={label}>
                    <input type="checkbox" checked={value === true}
                      onChange={(e) => updateConfig(opt.key, e.target.checked)} />
                  </Field>
                );
              }
              if (opt.type === 'number') {
                return (
                  <Field key={opt.key} label={label}>
                    <input type="number" value={value ?? ''}
                      min={opt.min} max={opt.max} step={opt.step}
                      onChange={(e) => updateConfig(opt.key, e.target.value === '' ? undefined : Number(e.target.value))}
                      style={{ ...inputStyle, width: 80, marginBottom: 0 }} />
                  </Field>
                );
              }
              if (opt.type === 'color') {
                return (
                  <Field key={opt.key} label={label}>
                    <ColorInput value={value || opt.default || '#7c3aed'}
                      onChange={(v) => updateConfig(opt.key, v)} />
                  </Field>
                );
              }
              if (opt.type === 'string') {
                return (
                  <Field key={opt.key} label={label}>
                    <input type="text" value={value || ''}
                      onChange={(e) => updateConfig(opt.key, e.target.value)}
                      style={{ ...inputStyle, marginBottom: 0 }} />
                  </Field>
                );
              }
              if (opt.type === 'select') {
                const opts = Array.isArray(opt.options) ? opt.options : [];
                return (
                  <Field key={opt.key} label={label}>
                    <select value={value ?? (opts[0]?.value ?? '')}
                      onChange={(e) => updateConfig(opt.key, e.target.value)}
                      style={{ ...inputStyle, marginBottom: 0 }}>
                      {opts.map((o) => <option key={o.value} value={o.value}>{o.label || o.value}</option>)}
                    </select>
                  </Field>
                );
              }
              return null;
            })}
          </Section>
        );
      })()}
    </div>
  );
}

// Right column: model dimensions & measures (always visible, collapsible)
export function DataModelPanel({ widgetId, widget, onUpdate, onUpdateSilent, model, onModelUpdate, reportFilters, onResizeStart, onResizeEnd }) {
  const [collapsed, setCollapsed] = useState(false);
  const { width, handleProps } = useResizableWidth({ storageKey: 'openreport.dataPanelWidth', defaultWidth: 220, min: 200, max: 480, onDragStart: onResizeStart, onDragEnd: onResizeEnd });
  const dynamicDataStyle = { ...dataPanelStyle, width, maxWidth: width, position: 'relative' };

  // Toggle: pin the canvas during the column animation, then unpin once it has settled.
  const toggleCollapsed = (val) => {
    onResizeStart?.();
    setCollapsed(val);
    setTimeout(() => onResizeEnd?.(), PANEL_COLLAPSE_TRANSITION_MS + 30);
  };

  if (collapsed) {
    return (
      <div style={collapsedPanelStyle} onClick={() => toggleCollapsed(false)} title="Open data panel">
        <span style={collapsedChevronStyle}><TbChevronsLeft size={14} /></span>
        <TbDatabase size={14} color="var(--accent-cyan)" />
        <span style={collapsedLabelStyle}>Data</span>
      </div>
    );
  }

  return (
    <div style={dynamicDataStyle}>
      <div {...handleProps} />
      <div style={panelHeader}>
        <span style={panelHeaderTitle}>
          <TbDatabase size={14} color="var(--accent-cyan)" />
          Data
        </span>
        <button onClick={() => toggleCollapsed(true)} style={chevronBtn} title="Collapse panel"
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.borderColor = 'var(--border-strong)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-panel)'; e.currentTarget.style.borderColor = 'var(--border-default)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
        ><TbChevronsRight size={14} /></button>
      </div>
      <DataPanel widgetId={widgetId} widget={widget} onUpdate={onUpdate} onUpdateSilent={onUpdateSilent} model={model} onModelUpdate={onModelUpdate} reportFilters={reportFilters} />
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
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{title}</span>
        {toggle && (
          <span style={{ display: 'inline-flex', color: 'var(--text-disabled)', transition: 'transform 0.15s', transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>
            <TbChevronDown size={14} />
          </span>
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
      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-disabled)', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
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
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 3 }}>{label}</div>
        <div>{children}</div>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, gap: 6 }}>
      <span style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap', flexShrink: 0 }}>{label}</span>
      <div style={{ flexShrink: 1, minWidth: 0, overflow: 'hidden' }}>{children}</div>
    </div>
  );
}

// Number input that accepts both "," and "." as decimal separator and preserves raw typing.
function DecimalInput({ value, onChange, placeholder, style }) {
  const [text, setText] = useState(value == null ? '' : String(value));
  const prevValueRef = useRef(value);
  // Re-sync local text when the external value changes (and isn't the same number we emitted)
  useEffect(() => {
    if (prevValueRef.current === value) return;
    prevValueRef.current = value;
    const parsed = parseFloat((text || '').replace(',', '.'));
    if (value == null) {
      if (text !== '') setText('');
    } else if (parsed !== value) {
      setText(String(value));
    }
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <input
      type="text"
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        if (raw === '' || raw === '-') { onChange(undefined); return; }
        // Allow only digits, one separator (, or .), optional leading minus
        if (!/^-?\d*[.,]?\d*$/.test(raw)) return;
        const parsed = parseFloat(raw.replace(',', '.'));
        if (!isNaN(parsed)) { prevValueRef.current = parsed; onChange(parsed); }
      }}
      onBlur={() => {
        // Normalize display on blur (e.g. "1," → "1")
        const parsed = parseFloat((text || '').replace(',', '.'));
        if (!isNaN(parsed)) setText(String(parsed));
      }}
      style={style}
    />
  );
}

function RangeInput({ min, max, step, value, onChange, suffix }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, minWidth: 0 }}>
      <input type="range" min={min} max={max} step={step || 1} value={value}
        onChange={onChange} style={{ flex: 1, minWidth: 0 }} />
      <input type="number" min={min} max={max} step={step || 1} value={value}
        onChange={onChange}
        style={{ width: 48, minWidth: 48, padding: '2px 3px', border: '1px solid var(--border-default)', borderRadius: 3, fontSize: 11, textAlign: 'center', outline: 'none', boxSizing: 'border-box', flexShrink: 0 }} />
      {suffix && <span style={{ fontSize: 10, color: 'var(--text-disabled)', flexShrink: 0 }}>{suffix}</span>}
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
          width: 22, height: 22, border: '1px solid var(--border-default)', borderRadius: 3,
          cursor: 'pointer', fontSize: 11, lineHeight: 1,
          background: isTransparent ? 'var(--bg-panel)' : 'repeating-conic-gradient(var(--border-default) 0% 25%, var(--bg-panel) 0% 50%) 50%/12px 12px',
          color: isTransparent ? 'var(--accent-primary)' : 'var(--text-disabled)',
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
  border: '1px solid var(--border-default)',
  borderRadius: 8,
  overflow: 'hidden',
  background: 'var(--bg-panel)',
  boxShadow: '0 1px 1px rgba(15,23,42,0.02)',
};

const sectionHeaderStyle = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '8px 12px',
  background: 'var(--bg-panel)',
  borderBottom: '1px solid transparent',
  cursor: 'pointer',
  userSelect: 'none',
  transition: 'background 0.12s, border-color 0.12s',
};

const subSectionStyle = {
  marginTop: 6, marginBottom: 6,
  padding: '8px 8px',
  border: '1px solid #eef2f7',
  borderRadius: 6,
  background: 'var(--bg-subtle)',
  overflow: 'hidden',
};

const PANEL_COLLAPSE_TRANSITION_MS = 200;

const configPanelStyle = {
  width: 210, maxWidth: 210, backgroundColor: 'var(--bg-panel-alt)', borderLeft: '1px solid var(--border-default)',
  padding: 12, overflowY: 'auto', flexShrink: 0,
  transition: `width ${PANEL_COLLAPSE_TRANSITION_MS}ms ease, max-width ${PANEL_COLLAPSE_TRANSITION_MS}ms ease`,
};

const collapsedPanelStyle = {
  backgroundColor: 'var(--bg-panel-alt)', borderLeft: '1px solid var(--border-default)',
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start',
  flexShrink: 0, overflow: 'hidden', cursor: 'pointer',
  padding: '10px 8px', gap: 10, width: 34, maxWidth: 34,
  transition: `width ${PANEL_COLLAPSE_TRANSITION_MS}ms ease, max-width ${PANEL_COLLAPSE_TRANSITION_MS}ms ease`,
};

const collapsedChevronStyle = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 22, height: 22, background: 'var(--bg-panel)', border: '1px solid var(--border-default)',
  borderRadius: 6, color: 'var(--text-muted)',
};

const collapsedLabelStyle = {
  fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.08em',
  textTransform: 'uppercase',
  writingMode: 'vertical-rl', textOrientation: 'mixed',
};

const panelHeader = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  gap: 8,
  marginBottom: 14, paddingBottom: 10, borderBottom: '1px solid var(--border-default)',
};

const panelHeaderTitle = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: '0.04em', textTransform: 'uppercase',
};

const chevronBtn = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 24, height: 24, color: 'var(--text-muted)',
  background: 'var(--bg-panel)', border: '1px solid var(--border-default)', borderRadius: 6,
  cursor: 'pointer', padding: 0,
  transition: 'background 0.12s, border-color 0.12s, color 0.12s',
};

const dataPanelStyle = {
  width: 220, maxWidth: 220, backgroundColor: 'var(--bg-panel-alt)', borderLeft: '1px solid var(--border-default)',
  padding: 12, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden',
  transition: `width ${PANEL_COLLAPSE_TRANSITION_MS}ms ease, max-width ${PANEL_COLLAPSE_TRANSITION_MS}ms ease`,
};

const headerStyle = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  gap: 8,
  marginBottom: 14, paddingBottom: 10, borderBottom: '1px solid var(--border-default)',
};

const radioRow = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' };

const layerBtn = {
  color: 'var(--text-secondary)', background: 'var(--bg-panel)', border: '1px solid var(--border-default)',
  borderRadius: 6, padding: '5px 7px', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  transition: 'background 0.12s, border-color 0.12s, color 0.12s',
};

const deleteStyle = {
  color: 'var(--state-danger)', background: 'var(--bg-panel)', border: '1px solid var(--state-danger-border)',
  borderRadius: 6, padding: '5px 7px', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  transition: 'background 0.12s, border-color 0.12s',
};

const inputStyle = {
  width: '100%', padding: '6px 8px', border: '1px solid var(--border-default)', borderRadius: 4,
  fontSize: 13, marginBottom: 8, outline: 'none', boxSizing: 'border-box',
};
