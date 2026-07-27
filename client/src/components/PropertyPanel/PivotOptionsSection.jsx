import { useState } from 'react';
import { Section, Field } from './controls';

// Pivot-table config section: grand-total / subtotal toggles plus per-measure
// (or global) value-abbreviation and aggregation. Extracted verbatim from
// PropertyPanel.jsx (LOT 6.3). Self-contained — its only local state is the
// currently-edited measure; everything else comes in via props.
const _hs62 = { marginTop: 8, paddingTop: 6, borderTop: '1px solid #f1f5f9' };

export default function PivotOptionsSection({ widget, updateConfig, inputStyle, sections }) {
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
        <div style={_hs62}>
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
