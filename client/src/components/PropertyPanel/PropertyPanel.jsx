import { useState, useCallback } from 'react';
import { useIsCompact } from '../../hooks/useMediaQuery';
import DataPanel from '../DataPanel/DataPanel';
import { TbChevronsLeft, TbChevronsRight, TbDatabase } from 'react-icons/tb';
import { EditIcon, ICON_SIZE } from '../actionIcons';
import { inputBase } from '../formTokens';
import ConfirmDeleteButton from '../ConfirmDeleteButton/ConfirmDeleteButton';
import { useResizableWidth } from '../../hooks/useResizableWidth';
import { getWidgetDisplayInfo } from '../../utils/widgetDisplay';
import { parseTimeVariant, makeTimeVariant, variantDateDim } from '../../utils/timeIntelligence';
import { AGG_OPTIONS } from '../../utils/aggregations';
import { baseMeasureName, makeAggVariant, nextAggVariant, parseAggVariant } from '../../utils/aggVariant';
import { makeTableCtx } from './sections/tableCtx';
import FieldsSection from './sections/FieldsSection';
import FiltersSection from './sections/FiltersSection';
import DataSection from './sections/DataSection';
import VisualSection from './sections/VisualSection';
import ColorsSection from './sections/ColorsSection';
import LabelsSection from './sections/LabelsSection';
import AxesSection from './sections/AxesSection';
import LegendSection from './sections/LegendSection';
import FrameSection from './sections/FrameSection';
import { hasData } from './sections/visualTypes';

const _hs2 = { display: 'flex', flexDirection: 'column', gap: 2 };
const _hs3 = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' };
const _hs4 = { fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 };
const _hs35 = { flexShrink: 0 };
const _hs36 = { flexShrink: 0 };
const _hs37 = {
                display: 'inline-flex', alignItems: 'center', gap: 3, minWidth: 0,
                marginLeft: 2, textTransform: 'none', letterSpacing: 0, fontWeight: 500,
                fontSize: 11, color: 'var(--text-disabled)', textDecoration: 'none',
                transition: 'color 0.12s',
              };
const _hs38 = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 };
const _hs39 = { flexShrink: 0, opacity: 0.6 };
const _hs40 = {
              textTransform: 'none', letterSpacing: 0, fontWeight: 500, fontSize: 11,
              color: 'var(--text-disabled)', overflow: 'hidden', textOverflow: 'ellipsis',
              whiteSpace: 'nowrap', minWidth: 0,
            };
const pivotMeasureRow = { marginBottom: 6 };

// Which sections are folded, kept across widget selections. Keyed by
// "<widget type>:<section id>" (see Section in controls.jsx), so a choice
// made on one visual type does not leak onto another.
let _sectionState = {};
const useSectionState = (prefix) => {
  const [collapsed, setCollapsed] = useState(_sectionState);
  const toggle = useCallback((key, isCollapsed) => {
    setCollapsed((p) => {
      const next = { ...p, [key]: !isCollapsed };
      _sectionState = next;
      return next;
    });
  }, []);
  return { collapsed, toggle, prefix };
};

// Left column: widget configuration (always present, collapsible)
export function WidgetConfigPanel({ widgetId, widget, onUpdate, onDelete, model, onResizeStart, onResizeEnd, onRefreshWidget }) {
  const sections = useSectionState(widget?.type);
  const { width, handleProps } = useResizableWidth({ storageKey: 'openreport.configPanelWidth', defaultWidth: 210, min: 180, max: 480, onDragStart: onResizeStart, onDragEnd: onResizeEnd });
  const compact = useIsCompact();
  // Column scope of the table settings and measure scope of the pivot's —
  // shared by the sections that show them, so they agree on it.
  const [selectedCol, setSelectedCol] = useState(null);
  const [selectedMeasure, setSelectedMeasure] = useState(null);
  const dynamicConfigStyle = compact
    ? { ...configPanelStyle, width: '100%', maxWidth: 'none', borderLeft: 'none', position: 'relative' }
    : { ...configPanelStyle, width, maxWidth: width, position: 'relative' };

  // Nothing selected, nothing to configure — so no panel, not a panel saying
  // there is nothing to configure (and no collapse machinery either: the
  // panel appearing only with a selection IS the collapse).
  if (!widgetId || !widget) return null;

  const updateConfig = (key, value) => {
    onUpdate(widgetId, { ...widget, config: { ...widget.config, [key]: value } });
  };

  const binding = widget.dataBinding || {};

  // Build field info lookup for tooltips and type detection
  const fieldInfos = {};
  const dimensionNames = new Set();
  const measureInfos = {};
  if (model) {
    for (const d of (model.dimensions || [])) { fieldInfos[d.name] = { table: d.table, column: d.column, label: d.label, expression: d.expression }; dimensionNames.add(d.name); }
    for (const m of (model.measures || [])) {
      fieldInfos[m.name] = { table: m.table, column: m.column, label: m.label };
      // Get aggregation (from widget override or model default)
      const aggOverrides = binding.measureAggOverrides || {};
      measureInfos[m.name] = { aggregation: aggOverrides[m.name] || m.aggregation || 'sum' };
      // Each variant of this measure knows its own aggregation, and carries
      // the base's table/column so a chip can still say where it comes from.
      for (const opt of AGG_OPTIONS) {
        const vName = makeAggVariant(m.name, opt.value);
        fieldInfos[vName] = { table: m.table, column: m.column, label: `${m.label || m.name} (${opt.label})` };
        measureInfos[vName] = { aggregation: opt.value };
      }
    }
  }

  const handleAggChange = (fieldName, newAgg) => {
    // A variant IS its aggregation — changing it renames the entry rather than
    // recording an override, otherwise two variants of one measure would fight
    // over the single slot a name-keyed map has for them.
    const variant = parseAggVariant(fieldName);
    if (variant) {
      const renamed = makeAggVariant(variant.base, newAgg);
      const swap = (arr) => (Array.isArray(arr) ? arr.map((n) => (n === fieldName ? renamed : n)) : arr);
      const updates = {};
      if (Array.isArray(binding.selectedMeasures)) updates.selectedMeasures = swap(binding.selectedMeasures);
      if (Array.isArray(binding.comboBarMeasures)) updates.comboBarMeasures = swap(binding.comboBarMeasures);
      if (Array.isArray(binding.comboLineMeasures)) updates.comboLineMeasures = swap(binding.comboLineMeasures);
      if (Array.isArray(binding.columnOrder)) updates.columnOrder = swap(binding.columnOrder);
      updateBinding(updates);
      return;
    }
    const current = binding.measureAggOverrides || {};
    updateBinding({ measureAggOverrides: { ...current, [fieldName]: newAgg } });
  };

  // Per-measure time variants. `field` is a base measure (adds its
  // "<base>@@tp:<preset>" copy right after it) or an existing variant
  // (preset change retargets in place; preset=null removes it). Applied to
  // whichever measure arrays contain the field — including the table's
  // columnOrder so the new column lands next to its base.
  const timeVariantsEnabled = !!variantDateDim(model);
  const handleTimeVariant = (field, preset) => {
    const v = parseTimeVariant(field);
    const base = v ? v.base : field;
    const target = preset ? makeTimeVariant(base, preset) : null;
    const swap = (arr) => {
      if (!Array.isArray(arr) || !arr.includes(field)) return null;
      if (v) return target ? arr.map((f) => (f === field ? target : f)) : arr.filter((f) => f !== field);
      if (!target || arr.includes(target)) return null; // no-op / duplicate
      const idx = arr.indexOf(field);
      return [...arr.slice(0, idx + 1), target, ...arr.slice(idx + 1)];
    };
    const updates = {};
    const sm2 = swap(binding.selectedMeasures); if (sm2) updates.selectedMeasures = sm2;
    const cb2 = swap(binding.comboBarMeasures); if (cb2) updates.comboBarMeasures = cb2;
    const cl2 = swap(binding.comboLineMeasures); if (cl2) updates.comboLineMeasures = cl2;
    const co2 = swap(binding.columnOrder); if (co2) updates.columnOrder = co2;
    if (Object.keys(updates).length > 0) updateBinding(updates);
  };
  const onTimeVariant = timeVariantsEnabled ? handleTimeVariant : undefined;
  const selectedDims = binding.selectedDimensions || [];
  const selectedMeass = binding.selectedMeasures || [];

  // Per-zone sort. Stored as widget.config.zoneSorts = { axis, values, ... }.
  // Backwards compat: the old global widget.config.sortOrder used to apply
  // to the values aggregate, so seed the values zone from it when zoneSorts
  // hasn't been written yet.
  const zoneSorts = (() => {
    const z = widget.config?.zoneSorts;
    if (z && typeof z === 'object') return z;
    if (widget.config?.sortOrder) return { values: widget.config.sortOrder };
    return {};
  })();
  const getZoneSort = (zone) => zoneSorts[zone] || 'none';
  const setZoneSort = (zone) => (next) => {
    const cur = (widget.config?.zoneSorts && typeof widget.config.zoneSorts === 'object') ? widget.config.zoneSorts : {};
    const merged = { ...cur, [zone]: next };
    if (next === 'none') delete merged[zone];
    updateConfig('zoneSorts', merged);
  };

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

  const groupBy = binding.groupBy || [];
  const columnDims = binding.columnDimensions || [];

  const removeGroupBy = (name) => {
    updateBinding({ groupBy: groupBy.filter((g) => g !== name) });
  };

  const removeColumnDim = (name) => {
    updateBinding({ columnDimensions: columnDims.filter((d) => d !== name) });
  };

  const removeFromZone = (sourceZone, fieldName) => {
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

  const handleDrop = (zone) => (fieldName, fieldType, sourceZone, dropIndex, replace, duplicate) => {
    // Second drop of a measure already in this zone: it becomes a variant
    // carrying its own aggregation, so the visual can show the sum AND the
    // average of one column. The name is what tells the two apart, all the
    // way to the SQL — see utils/aggVariant.
    if (duplicate && fieldType === 'measure') {
      const base = baseMeasureName(fieldName);
      const modelAgg = (model?.measures || []).find((m) => m.name === base)?.aggregation;
      fieldName = nextAggVariant(base, selectedMeass, binding.measureAggOverrides?.[base] || modelAgg);
    }
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

  // Pivot per-measure settings: a measure picked here scopes the value
  // format (Labels) and the aggregation (the visual's section) to itself.
  const pivot = (() => {
    const pc = widget.config?.pivotConfig || {};
    const measures = widget.data?._measures || [];
    const getVal = (key, defaultVal) => {
      if (selectedMeasure) {
        const mv = pc.perMeasure?.[selectedMeasure]?.[key];
        if (mv !== undefined) return mv;
      }
      const globalKey = key === 'aggregation' ? 'defaultAggregation' : key;
      return pc[globalKey] ?? defaultVal;
    };
    const setVal = (key, value) => {
      const newPc = { ...pc };
      if (selectedMeasure) {
        const perMeasure = { ...(newPc.perMeasure || {}) };
        perMeasure[selectedMeasure] = { ...(perMeasure[selectedMeasure] || {}), [key]: value };
        newPc.perMeasure = perMeasure;
      } else {
        newPc[key === 'aggregation' ? 'defaultAggregation' : key] = value;
      }
      updateConfig('pivotConfig', newPc);
    };
    const measureSelect = measures.length > 0 ? (
      <div style={pivotMeasureRow}>
        <select value={selectedMeasure || ''} onChange={(e) => setSelectedMeasure(e.target.value || null)}
          style={{ ...inputStyle, marginBottom: 0, fontSize: 11 }}>
          <option value="">All measures</option>
          {measures.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
    ) : null;
    return { getVal, setVal, measureSelect };
  })();

  const info = getWidgetDisplayInfo(widget);
  const Icon = info.icon;
  const rowCount = widget.data?._rowCount;
  const maxReached = widget.data?._maxReached;

  // Everything a section needs, in one bag: the widget and its binding,
  // the write paths, the field lookups, the drop-zone handlers.
  const ctx = {
    widget, widgetId, model, binding, onUpdate, updateConfig, updateBinding, onRefreshWidget,
    fieldInfos, measureInfos, dimensionNames, handleAggChange, onTimeVariant,
    selectedDims, selectedMeass, groupBy, columnDims,
    getZoneSort, setZoneSort, handleDrop, handleRemove, handleRemoveGroupBy, removeColumnDim, handleReorder,
    inputStyle, sections, styles: { ruleCardStyle, ruleLabelStyle },
    title: widget.type === 'customVisual' ? (widget.config?.visualName || info.label) : info.label,
    table: makeTableCtx({ widget, updateConfig, selectedCol, setSelectedCol, inputStyle }),
    pivot,
  };
  const dataWidget = hasData(widget.type);

  return (
    <div style={dynamicConfigStyle}>
      <div {...handleProps} />
      {/* Widget title — first element of the panel on purpose: it names the
          visual, so it reads as the panel's own heading rather than one form
          field among the sections. Its type is set under Frame. */}
      <div style={titleBlock}>
        <input
          type="text"
          value={widget.config?.title || ''}
          onChange={(e) => updateConfig('title', e.target.value)}
          placeholder="Add a title…"
          style={titleInput}
          onFocus={(e) => { e.currentTarget.style.borderBottomColor = 'var(--accent-primary)'; e.currentTarget.style.borderBottomStyle = 'solid'; }}
          onBlur={(e) => { e.currentTarget.style.borderBottomColor = 'var(--border-default)'; e.currentTarget.style.borderBottomStyle = 'dashed'; }}
        />
      </div>
      <div style={headerStyle}>
        <div style={_hs2}>
          <span style={_hs3}>
            {Icon && <Icon size={18} />} {info.label}
          </span>
          {typeof rowCount === 'number' && (
            <span style={_hs4}>
              {maxReached ? '1,000,000 rows (limit reached)' : `${rowCount.toLocaleString()} rows`}
            </span>
          )}
        </div>
        <ConfirmDeleteButton
          variant="icon"
          size={ICON_SIZE.modal}
          label="Delete widget"
          style={deleteStyle}
          onConfirm={() => onDelete(widgetId)}
        />
      </div>

      {/* The same nine sections in the same order for every visual: what
          data, how it is drawn, in what frame. A section that does not
          apply to the visual is simply absent, never renamed or moved.
          One exception: a slicer's own section (its style) comes right
          after its field — that is what one sets first on a slicer. */}
      <FieldsSection ctx={ctx} />
      {widget.type === 'filter' && <VisualSection ctx={ctx} />}
      {dataWidget && <FiltersSection ctx={ctx} />}
      {dataWidget && <DataSection ctx={ctx} />}
      {widget.type !== 'filter' && <VisualSection ctx={ctx} />}
      <ColorsSection ctx={ctx} />
      <LabelsSection ctx={ctx} />
      <AxesSection ctx={ctx} />
      <LegendSection ctx={ctx} />
      <FrameSection ctx={ctx} />
    </div>
  );
}

// Right column: model dimensions & measures (always visible, collapsible)
// `collapsed` / `onCollapsedChange` are optional: given, the editor decides
// when the panel folds (it makes room for the assistant), and the chevrons
// here still work — they just report to it. Left out, the panel keeps its own.
export function DataModelPanel({ widgetId, widget, onUpdate, onUpdateSilent, onSetWidgetLoading, model, onModelUpdate, settings, onSettingsChange, reportFilters, refreshNonce, onResizeStart, onResizeEnd, reportId, cacheBuiltAt, collapsed: controlled, onCollapsedChange }) {
  const [own, setOwn] = useState(false);
  const collapsed = controlled ?? own;
  const setCollapsed = onCollapsedChange || setOwn;
  const { width, handleProps } = useResizableWidth({ storageKey: 'openreport.dataPanelWidth', defaultWidth: 220, min: 200, max: 480, onDragStart: onResizeStart, onDragEnd: onResizeEnd });
  const compact = useIsCompact();
  const dynamicDataStyle = compact
    ? { ...dataPanelStyle, width: '100%', maxWidth: 'none', borderLeft: 'none', position: 'relative',
        // One scroll for the whole panel: the lists inside no longer keep their
        // own, so this is what carries them.
        overflowY: 'auto', overflowX: 'hidden' }
    : { ...dataPanelStyle, width, maxWidth: width, position: 'relative' };

  // Toggle: pin the canvas during the column animation, then unpin once it has settled.
  const toggleCollapsed = (val) => {
    onResizeStart?.();
    setCollapsed(val);
    setTimeout(() => onResizeEnd?.(), PANEL_COLLAPSE_TRANSITION_MS + 30);
  };

  // Mounted once, used by both branches. The panel owns the ONLY fetch loop
  // that reacts to a widget's own binding: the editor's main loop watches the
  // report filters and the refresh counter, never a binding. Unmounting the
  // panel with the collapse therefore froze every edit made from the property
  // panel next door — a Top N, a row limit, a measure filter changed the SQL
  // and nothing refetched, so the visual kept showing the previous answer
  // until an explicit refresh. Collapsed, it is hidden rather than removed.
  const dataPanel = (
    <DataPanel widgetId={widgetId} widget={widget} onUpdate={onUpdate} onUpdateSilent={onUpdateSilent} onSetWidgetLoading={onSetWidgetLoading} model={model} onModelUpdate={onModelUpdate} settings={settings} onSettingsChange={onSettingsChange} reportFilters={reportFilters} refreshNonce={refreshNonce} reportId={reportId} cacheBuiltAt={cacheBuiltAt} />
  );

  if (collapsed) {
    return (
      <>
        <div style={collapsedPanelStyle} onClick={() => toggleCollapsed(false)} title="Open data panel">
          <span style={collapsedChevronStyle}><TbChevronsLeft size={14} /></span>
          <TbDatabase size={14} color="var(--accent-cyan)" />
          <span style={collapsedLabelStyle}>Data</span>
        </div>
        <div style={hiddenPanelStyle}>{dataPanel}</div>
      </>
    );
  }

  return (
    <div style={dynamicDataStyle}>
      <div {...handleProps} />
      <div style={panelHeader}>
        <span style={{ ...panelHeaderTitle, minWidth: 0, flex: 1 }}>
          <TbDatabase size={14} color="var(--accent-cyan)" style={_hs35} />
          <span style={_hs36}>Data</span>
          {model?.id ? (
            <a
              // Opens in its own tab, so the editor has no history to walk
              // back through. `from` tells its Back button where this report
              // is, instead of dropping the user on the model list.
              href={`/models/${model.id}${reportId ? `?from=/edit/${reportId}` : ''}`}
              target="_blank"
              rel="noopener noreferrer"
              title={`${model.name} — open data model`}
              style={_hs37}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-primary)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-disabled)'; }}
            >
              <span style={_hs38}>{model.name}</span>
              <EditIcon size={ICON_SIZE.chip} style={_hs39} />
            </a>
          ) : (model?.name ? (
            <span style={_hs40}>{model.name}</span>
          ) : null)}
        </span>
        <button onClick={() => toggleCollapsed(true)} style={chevronBtn} title="Collapse panel"
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.borderColor = 'var(--border-strong)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-panel)'; e.currentTarget.style.borderColor = 'var(--border-default)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
        ><TbChevronsRight size={14} /></button>
      </div>
      {dataPanel}
    </div>
  );
}

// Takes no room and shows nothing — the collapsed panel still runs.
const hiddenPanelStyle = { display: 'none' };

const ruleCardStyle = {
  padding: '8px',
  marginBottom: 6,
  border: '1px solid var(--border-default)',
  borderRadius: 6,
  background: 'var(--bg-panel)',
};

const ruleLabelStyle = {
  fontSize: 11,
  color: 'var(--text-secondary)',
  fontWeight: 500,
};

const PANEL_COLLAPSE_TRANSITION_MS = 200;

const configPanelStyle = {
  width: 210, maxWidth: 210, backgroundColor: 'var(--bg-panel-alt)', borderLeft: '1px solid var(--border-default)',
  padding: 12, overflowY: 'auto', flexShrink: 0,
  // Reserve the scrollbar lane permanently: without this, opening a section
  // (or selecting a widget with more sections) pops the scrollbar in and
  // shifts every control sideways.
  scrollbarGutter: 'stable',
  scrollbarWidth: 'thin',
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

// Widget-title block pinned at the very top of the panel. The dashed
// underline signals editability without the weight of a boxed input.
const titleBlock = { marginBottom: 10 };
const titleInput = {
  width: '100%', boxSizing: 'border-box', fontSize: 14, fontWeight: 600,
  color: 'var(--text-primary)', background: 'transparent',
  border: 'none', borderBottom: '1px dashed var(--border-default)',
  padding: '2px 0 4px', outline: 'none',
};

const deleteStyle = {
  color: 'var(--state-danger)', background: 'var(--bg-panel)', border: '1px solid var(--state-danger-border)',
  borderRadius: 6, padding: '5px 7px', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  transition: 'background 0.12s, border-color 0.12s',
};

const inputStyle = { ...inputBase, marginBottom: 8 };
