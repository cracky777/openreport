// Read / write helpers over `config.tableConfig` for the current column
// scope (all columns, or one). Built once by the panel and handed to the
// Visual, Colors and Labels sections, so the three agree on the scope.
import { setNestedValue } from '../../../utils/tableConfigHelpers';

const colSelectStyle = { marginBottom: 8, padding: '4px 0', borderBottom: '1px solid var(--border-subtle)' };

export function makeTableCtx({ widget, updateConfig, selectedCol, setSelectedCol, inputStyle }) {
  const tc = widget.config?.tableConfig || {};
  const isPivot = widget.type === 'pivotTable';
  const pivotRowDims = widget.data?._rowDims || [];
  const pivotColDims = widget.data?._colDims || [];
  const pivotMeasures = widget.data?._measures || [];
  // Pivot: one "Rows" entry for the hierarchy, then column dims and measures.
  const columns = isPivot
    ? [...(pivotRowDims.length > 0 ? ['Rows'] : []), ...pivotColDims, ...pivotMeasures]
    : (widget.data?.columns || []);
  const update = (path, value) => {
    const prefix = selectedCol ? `columns.${selectedCol}.` : '';
    updateConfig('tableConfig', setNestedValue(tc, prefix + path, value));
  };
  const updateGlobal = (path, value) => updateConfig('tableConfig', setNestedValue(tc, path, value));
  const get = (section, key, defaultVal) => {
    if (selectedCol) {
      const colVal = tc.columns?.[selectedCol]?.[section]?.[key];
      if (colVal !== undefined) return colVal;
    }
    return tc[section]?.[key] ?? defaultVal;
  };
  const getGlobal = (path, defaultVal) => {
    let v = tc;
    for (const k of path.split('.')) { v = v?.[k]; if (v === undefined) return defaultVal; }
    return v;
  };
  const colSelect = columns.length > 0 ? (
    <div style={colSelectStyle}>
      <select value={selectedCol || ''} onChange={(e) => setSelectedCol(e.target.value || null)}
        style={{ ...inputStyle, marginBottom: 0, fontSize: 11 }}>
        <option value="">All columns</option>
        {columns.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
    </div>
  ) : null;
  return { tc, isPivot, columns, selectedCol, update, updateGlobal, get, getGlobal, colSelect, inputStyle };
}
