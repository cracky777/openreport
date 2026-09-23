// Section 1 — Fields. The drop zones, named by the role a field plays in the
// visual: the dimension well is "Axis" on axis charts, "Category" on parts
// charts, "Rows" / "Columns" on grids; measures are "Values" (or "Value" when
// one is accepted). The chip colour already says dimension or measure, so no
// zone carries a "(measure)" suffix.
import { Section } from '../controls';
import DropZone from '../../DropZone/DropZone';
import { tagFor } from '../../../utils/textMeasures';

const TAG_HINT_STYLE = { fontSize: 11, color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.5 };
const TAG_STYLE = { fontFamily: 'monospace', color: 'var(--text-primary)', background: 'var(--bg-hover)', borderRadius: 3, padding: '0 4px' };

export default function FieldsSection({ ctx }) {
  const {
    widget, widgetId, onUpdate, binding, updateBinding, model,
    fieldInfos, measureInfos, dimensionNames, handleAggChange, onTimeVariant, asMeasure,
    selectedDims, selectedMeass, groupBy, columnDims,
    getZoneSort, setZoneSort, handleDrop, handleRemove, handleRemoveGroupBy, removeColumnDim, handleReorder,
  } = ctx;
  const type = widget.type;

  const axisZone = (label = 'Axis', extra = {}) => (
    <DropZone label={label} accepts={['dimension']} fields={selectedDims} zoneName="axis"
      onDrop={handleDrop('axis')} onRemove={handleRemove} onReorder={handleReorder('dims')} multiple fieldInfos={fieldInfos}
      sort={getZoneSort('axis')} onSortChange={setZoneSort('axis')} {...extra} />
  );
  const legendZone = (
    <DropZone label="Legend" accepts={['dimension']} fields={groupBy} zoneName="groupBy"
      onDrop={handleDrop('groupBy')} onRemove={handleRemoveGroupBy} onReorder={handleReorder('groupBy')} fieldInfos={fieldInfos}
      sort={getZoneSort('groupBy')} onSortChange={setZoneSort('groupBy')} />
  );
  // Measure wells take a dimension too: it lands as a reading of its column
  // (Max by default), the way Power BI aggregates a column put in Values.
  const valuesZone = (label = 'Values', multiple = true) => (
    <DropZone label={label} accepts={['measure', 'dimension']} dimensionNames={dimensionNames} measureInfos={measureInfos} onAggChange={handleAggChange} onTimeVariant={onTimeVariant} fields={selectedMeass} zoneName={multiple ? 'values' : 'value'}
      onDrop={handleDrop(multiple ? 'values' : 'value')} onRemove={handleRemove} onReorder={handleReorder('measures')} multiple={multiple} fieldInfos={fieldInfos}
      sort={getZoneSort('values')} onSortChange={setZoneSort('values')} />
  );
  // A single-measure role bound outside selectedMeasures (scatter axes,
  // gauge max / threshold).
  const roleZone = (label, zoneName, value, onDrop, onRemove) => (
    <DropZone label={label} accepts={['measure']} measureInfos={measureInfos} onAggChange={handleAggChange} fields={value ? [value] : []} zoneName={zoneName}
      onDrop={onDrop} onRemove={onRemove} fieldInfos={fieldInfos} />
  );

  let zones = null;

  if (type === 'bar' || type === 'line') {
    zones = <>{axisZone()}{legendZone}{valuesZone()}</>;
  } else if (type === 'combo') {
    const comboBarMeas = binding.comboBarMeasures || [];
    const comboLineMeas = binding.comboLineMeasures || [];
    zones = (
      <>
        {axisZone()}
        {legendZone}
        <DropZone label="Bar values" accepts={['measure', 'dimension']} dimensionNames={dimensionNames} measureInfos={measureInfos} onAggChange={handleAggChange} fields={comboBarMeas} zoneName="comboBar"
          onDrop={(fn, ft) => updateBinding({ comboBarMeasures: [...comboBarMeas, asMeasure(fn, ft, comboBarMeas)] })}
          onRemove={(fn) => updateBinding({ comboBarMeasures: comboBarMeas.filter((m) => m !== fn) })}
          onReorder={(arr) => updateBinding({ comboBarMeasures: arr })} multiple fieldInfos={fieldInfos}
          sort={getZoneSort('values')} onSortChange={setZoneSort('values')} />
        <DropZone label="Line values" accepts={['measure', 'dimension']} dimensionNames={dimensionNames} measureInfos={measureInfos} onAggChange={handleAggChange} fields={comboLineMeas} zoneName="comboLine"
          onDrop={(fn, ft) => updateBinding({ comboLineMeasures: [...comboLineMeas, asMeasure(fn, ft, comboLineMeas)] })}
          onRemove={(fn) => updateBinding({ comboLineMeasures: comboLineMeas.filter((m) => m !== fn) })}
          onReorder={(arr) => updateBinding({ comboLineMeasures: arr })} multiple fieldInfos={fieldInfos}
          sort={getZoneSort('comboLine')} onSortChange={setZoneSort('comboLine')} />
      </>
    );
  } else if (type === 'scatter') {
    const scatter = binding.scatterMeasures || {};
    const setScatterMeas = (role) => (fieldName) => {
      onUpdate(widgetId, { ...widget, dataBinding: { ...binding, scatterMeasures: { ...scatter, [role]: fieldName } }, data: {} });
    };
    const removeScatterMeas = (role) => () => {
      const next = { ...scatter };
      delete next[role];
      onUpdate(widgetId, { ...widget, dataBinding: { ...binding, scatterMeasures: next }, data: {} });
    };
    zones = (
      <>
        <DropZone label="Points" accepts={['dimension']} fields={selectedDims} zoneName="axis"
          onDrop={handleDrop('axis')} onRemove={handleRemove} onReorder={handleReorder('dims')} fieldInfos={fieldInfos} />
        {legendZone}
        {roleZone('X value', 'scatterX', scatter.x, setScatterMeas('x'), removeScatterMeas('x'))}
        {roleZone('Y value', 'scatterY', scatter.y, setScatterMeas('y'), removeScatterMeas('y'))}
        {roleZone('Size', 'scatterSize', scatter.size, setScatterMeas('size'), removeScatterMeas('size'))}
      </>
    );
  } else if (type === 'pie' || type === 'treemap') {
    zones = (
      <>
        <DropZone label="Category" accepts={['dimension']} fields={selectedDims} zoneName="category"
          onDrop={handleDrop('category')} onRemove={handleRemove} onReorder={handleReorder('dims')} multiple fieldInfos={fieldInfos}
          sort={getZoneSort('axis')} onSortChange={setZoneSort('axis')} />
        {valuesZone('Value', false)}
      </>
    );
  } else if (type === 'table') {
    // columnOrder rules when present; fields it does not know yet go last.
    const allCols = [...selectedDims, ...selectedMeass];
    const orderedCols = binding.columnOrder ? binding.columnOrder.filter((f) => allCols.includes(f)) : allCols;
    const tableFields = [...orderedCols, ...allCols.filter((f) => !orderedCols.includes(f))];
    zones = (
      <DropZone label="Columns" accepts={['dimension', 'measure']} fields={tableFields} zoneName="columns"
        onDrop={handleDrop('columns')} onRemove={handleRemove} onReorder={handleReorder('columns')} multiple fieldInfos={fieldInfos} dimensionNames={dimensionNames}
        measureInfos={measureInfos} onAggChange={handleAggChange} onTimeVariant={onTimeVariant} />
    );
  } else if (type === 'pivotTable') {
    zones = (
      <>
        <DropZone label="Rows" accepts={['dimension']} fields={selectedDims} zoneName="rows"
          onDrop={handleDrop('rows')} onRemove={handleRemove} onReorder={handleReorder('dims')} multiple fieldInfos={fieldInfos} />
        <DropZone label="Columns" accepts={['dimension']} fields={columnDims} zoneName="pivotColumns"
          onDrop={handleDrop('pivotColumns')} onRemove={removeColumnDim} onReorder={handleReorder('columnDims')} multiple fieldInfos={fieldInfos} />
        {valuesZone()}
      </>
    );
  } else if (type === 'scorecard') {
    // Compare-with-N-1: a date / date-part dim, used to run the same query
    // one year back. The first drop turns the % evolution line on so the
    // comparison shows up without hunting for its toggle (see Labels).
    const compareDateDim = binding.compareDateDim || null;
    const setCompareDim = (fieldName) => {
      const cfg = !binding.compareDateDim
        ? { ...(widget.config || {}), showN1Percent: widget.config?.showN1Percent ?? true }
        : (widget.config || {});
      // `data` is kept: only the binding key changes, which refetches with
      // the N-1 value alongside the current one.
      onUpdate(widgetId, { ...widget, dataBinding: { ...binding, compareDateDim: fieldName }, config: cfg });
    };
    const removeCompareDim = () => {
      const next = { ...binding };
      delete next.compareDateDim;
      onUpdate(widgetId, { ...widget, dataBinding: next });
    };
    zones = (
      <>
        {valuesZone('Value', false)}
        <DropZone label="Compare with (date)" accepts={['dimension']} fields={compareDateDim ? [compareDateDim] : []} zoneName="compareDate"
          onDrop={setCompareDim} onRemove={removeCompareDim} fieldInfos={fieldInfos} />
      </>
    );
  } else if (type === 'gauge') {
    const setBindingField = (fieldKey) => (fieldName) => {
      onUpdate(widgetId, { ...widget, dataBinding: { ...binding, [fieldKey]: fieldName }, data: {} });
    };
    const removeBindingField = (fieldKey) => () => {
      const next = { ...binding };
      delete next[fieldKey];
      onUpdate(widgetId, { ...widget, dataBinding: next, data: {} });
    };
    zones = (
      <>
        {valuesZone('Value', false)}
        {roleZone('Max', 'gaugeMax', binding.gaugeMaxMeasure, setBindingField('gaugeMaxMeasure'), removeBindingField('gaugeMaxMeasure'))}
        {roleZone('Threshold', 'gaugeThreshold', binding.gaugeThresholdMeasure, setBindingField('gaugeThresholdMeasure'), removeBindingField('gaugeThresholdMeasure'))}
      </>
    );
  } else if (type === 'customVisual') {
    const ds = widget.config?.manifest?.dataSchema || {};
    const dimSlots = Array.isArray(ds.dimensions) ? ds.dimensions : [];
    const measSlots = Array.isArray(ds.measures) ? ds.measures : [];
    const dimLabel = dimSlots.map((d) => d.label || d.role || 'Dimensions').join(' / ') || 'Dimensions';
    const measLabel = measSlots.map((m) => m.label || m.role || 'Measures').join(' / ') || 'Measures';
    zones = (
      <>
        <DropZone label={dimLabel} accepts={['dimension']} fields={selectedDims} zoneName="axis"
          onDrop={handleDrop('axis')} onRemove={handleRemove} onReorder={handleReorder('dims')} multiple fieldInfos={fieldInfos} />
        <DropZone label={measLabel} accepts={['measure']} measureInfos={measureInfos} onAggChange={handleAggChange} onTimeVariant={onTimeVariant} fields={selectedMeass} zoneName="values"
          onDrop={handleDrop('values')} onRemove={handleRemove} onReorder={handleReorder('measures')} multiple fieldInfos={fieldInfos} />
      </>
    );
  } else if (type === 'filter') {
    zones = (
      <DropZone label="Field" accepts={['dimension']} fields={selectedDims} zoneName="filter"
        onDrop={handleDrop('filter')} onRemove={handleRemove} onReorder={handleReorder('dims')} fieldInfos={fieldInfos} />
    );
  } else if (type === 'text') {
    // Each bound measure is reachable in the text by its tag; the hint spells
    // the tags so the author can type them without guessing the folding.
    zones = (
      <>
        {valuesZone('Measures')}
        <div style={TAG_HINT_STYLE} data-testid="text-measure-tags">
          {selectedMeass.length === 0
            ? 'Drop a measure here, then write its #tag in the text to print its value.'
            : <>Write in the text: {selectedMeass.map((m, i) => <span key={m}>{i > 0 ? ', ' : ''}<code style={TAG_STYLE}>#{tagFor(m, model)}</code></span>)}</>}
        </div>
      </>
    );
  }

  if (!zones) return null;
  return <Section bare>{zones}</Section>;
}
