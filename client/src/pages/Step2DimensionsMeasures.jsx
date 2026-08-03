import SqlExpressionInput from '../components/SqlExpressionInput/SqlExpressionInput';
import ValidationBadge from '../components/ValidationBadge';
import { readOverride, normalizeStoredType, chevronSvg } from '../utils/modelEditorHelpers';

// Step 2 of the model wizard: review/edit the flagged dimensions & measures
// (types, formats, labels, calculated measures) and the joins summary.
// Extracted verbatim from pages/ModelEditor.jsx (LOT 6.3). Presentational:
// all state + mutators come in via props. Every style/const below is used
// only by this step (moved with it); `badge` is duplicated (ModelEditor keeps
// the shared copy). It is prop-heavy by nature — the step touches a large slab
// of the wizard's shared state.
const AGG_OPTIONS = [
  { value: 'sum', label: 'Sum' },
  { value: 'avg', label: 'Average' },
  { value: 'count', label: 'Count' },
  { value: 'min', label: 'Min' },
  { value: 'max', label: 'Max' },
];
const _hs43 = { flex: 1, overflow: 'auto', padding: 24 };
const _hs44 = { maxWidth: 1000, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 };
const _hs45 = { width: '100%', border: 'none', outline: 'none', fontSize: 14, color: 'var(--text-secondary)' };
const _hs46 = { color: 'var(--text-disabled)', fontSize: 13 };
const _hs47 = { marginRight: 4 };
const _hs48 = { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' };
const _hs49 = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 };
const _hs50 = { padding: 12, background: 'var(--bg-subtle)', borderRadius: 6, marginBottom: 12, border: '1px solid var(--border-default)' };
const _hs51 = { fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 };
const _hs52 = { display: 'flex', gap: 6, justifyContent: 'flex-end' };
const _hs53 = { color: 'var(--text-disabled)', fontSize: 13 };
const _hs54 = { marginRight: 4 };
const _hs55 = { color: 'var(--accent-primary)', fontSize: 11 };
const _hs56 = { fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)' };
const _hs57 = { fontSize: 11, color: 'var(--accent-primary)', fontWeight: 600 };
const _hs58 = { color: 'var(--text-disabled)', fontSize: 13 };
const _hs59 = { display: 'flex', flexDirection: 'column', gap: 6 };
const _hs60 = { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--bg-subtle)', borderRadius: 6, fontSize: 13 };
const _hs61 = { fontWeight: 600 };
const _hs62 = { color: 'var(--text-muted)' };
const _hs63 = { fontWeight: 600 };
const _hs64 = { color: 'var(--text-muted)' };
const cardStyle = { backgroundColor: 'var(--bg-panel)', padding: 20, borderRadius: 8, border: '1px solid var(--border-default)' };
const cardTitle = { fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 };
const tableStyleCSS = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
const thStyle = { textAlign: 'left', padding: '8px 10px', borderBottom: '2px solid #e2e8f0', color: 'var(--text-muted)', fontWeight: 600, fontSize: 12 };
const tdStyle = { padding: '6px 10px', borderBottom: '1px solid #f1f5f9', color: 'var(--text-secondary)' };
const inlineInput = {
  padding: '4px 6px', border: '1px solid var(--border-default)', borderRadius: 4,
  fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box',
};
const editableSelectStyle = {
  appearance: 'none', WebkitAppearance: 'none', MozAppearance: 'none',
  padding: '3px 22px 3px 8px', borderRadius: 4, fontSize: 12,
  border: '1px solid var(--border-default)', outline: 'none',
  cursor: 'pointer', boxSizing: 'border-box',
  transition: 'border-color 0.12s, background-color 0.12s',
};
const editableInputStyle = {
  padding: '4px 8px', border: '1px solid var(--border-default)', borderRadius: 4,
  fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box',
  background: 'var(--bg-panel)', cursor: 'text',
  transition: 'border-color 0.12s',
};
const badge = { padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 };
const warnIcon = { fontSize: 13, cursor: 'help', lineHeight: 1 };
const removeBtn = {
  fontSize: 12, color: 'var(--state-danger)', background: 'transparent', border: '1px solid #fca5a5',
  borderRadius: 4, padding: '2px 8px', cursor: 'pointer',
};
const addCalcBtn = {
  fontSize: 12, fontWeight: 600, padding: '4px 10px', border: '1px solid #8b5cf6',
  borderRadius: 4, background: 'var(--bg-active)', color: 'var(--accent-primary)', cursor: 'pointer',
};
const calcInput = {
  width: '100%', padding: '6px 8px', border: '1px solid var(--border-default)', borderRadius: 4,
  fontSize: 13, outline: 'none', marginBottom: 8, boxSizing: 'border-box',
};
const calcCancelBtn = {
  fontSize: 12, padding: '4px 10px', border: '1px solid var(--border-default)',
  borderRadius: 4, background: 'var(--bg-panel)', color: 'var(--text-muted)', cursor: 'pointer',
};
const calcSaveBtn = {
  fontSize: 12, fontWeight: 600, padding: '4px 10px', border: 'none',
  borderRadius: 4, background: 'var(--accent-primary)', color: '#fff', cursor: 'pointer',
};

export default function Step2DimensionsMeasures({
  description, setDescription,
  dimensions, setDimensions,
  measures, setMeasures,
  joins, setJoins,
  columnTypes, validatingColumn, validationResults,
  showCalcMeasure, setShowCalcMeasure,
  calcMeasure, setCalcMeasure,
  brokenRefByKey,
  setColumnType, validateColumnType, removeDimension, addCalculatedMeasure, removeMeasure,
}) {
  return (
    <div style={_hs43}>
      <div style={_hs44}>
        {/* Description */}
        <div style={cardStyle}>
          <input
            type="text" value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="Model description (optional)"
            style={_hs45}
          />
        </div>

        {/* Dimensions */}
        <div style={cardStyle}>
          <h3 style={cardTitle}>Dimensions ({dimensions.length})</h3>
          {dimensions.length === 0 ? (
            <p style={_hs46}>
              No dimensions yet. Go to "Schema & Joins" and click D next to columns.
            </p>
          ) : (
            <table style={tableStyleCSS}>
              <thead>
                <tr>
                  <th style={thStyle}>Table</th>
                  <th style={thStyle}>Column</th>
                  <th style={thStyle}>Type</th>
                  <th style={thStyle}>Label (display name)</th>
                  <th style={thStyle}></th>
                </tr>
              </thead>
              <tbody>
                {dimensions.map((d) => {
                  const broken = brokenRefByKey.get(`dimension\u0000${d.name}`);
                  return (
                  <tr key={d.name} style={broken ? { background: 'var(--state-warning-soft)' } : undefined} title={broken ? (broken.issue === 'missing_table' ? `Table "${broken.table}" not found` : broken.issue === 'missing_column' ? `Column "${broken.column}" missing in "${broken.table}"` : broken.issue) : undefined}>
                    <td style={tdStyle}>{broken && <span style={_hs47}>⚠️</span>}{d.table}</td>
                    <td style={tdStyle}>{d.column}</td>
                    <td style={tdStyle}>
                      {(() => {
                        const key = `${d.table}.${d.column}`;
                        const isOverridden = !!columnTypes[key];
                        const isValidating = validatingColumn === key;
                        const result = validationResults[key];
                        const override = readOverride(columnTypes[key]);
                        const currentFormat = override?.format || 'auto';
                        const isDateType_ = normalizeStoredType(d.type) === 'date';
                        // Column was tested and its CURRENT type fits the sample
                        // poorly (< 95%). r.type guards against a stale result for
                        // a type the user has since changed away from.
                        const typeMismatch = result && !result.error && result.type === d.type
                          && typeof result.validRatio === 'number' && result.validRatio < 0.95;
                        return (
                          <div style={_hs48}>
                            <select
                              value={normalizeStoredType(d.type)}
                              onChange={(e) => setColumnType(d.table, d.column, e.target.value, currentFormat)}
                              style={{
                                ...editableSelectStyle,
                                background: isOverridden
                                  ? `var(--accent-primary-soft) ${chevronSvg('var(--accent-primary)')}`
                                  : `var(--bg-panel) ${chevronSvg('var(--text-muted)')}`,
                                borderColor: isOverridden ? 'var(--accent-primary)' : 'var(--border-default)',
                                color: isOverridden ? 'var(--accent-primary-text)' : 'var(--text-secondary)',
                                fontWeight: isOverridden ? 600 : 500,
                              }}
                              title={isOverridden ? 'Type overridden by user — click to change' : 'Inferred from column native type — click to override'}
                            >
                              <option value="string">string</option>
                              <option value="integer">integer</option>
                              <option value="decimal">decimal</option>
                              <option value="date">date</option>
                              <option value="boolean">boolean</option>
                            </select>
                            {typeMismatch && (
                              <span
                                style={warnIcon}
                                title={`This column matches "${d.type}" for only ${Math.round(result.validRatio * 100)}% of the sampled rows`}
                              >⚠️</span>
                            )}
                            {isDateType_ && (
                              <select
                                value={currentFormat}
                                onChange={(e) => setColumnType(d.table, d.column, 'date', e.target.value)}
                                style={{
                                  ...editableSelectStyle,
                                  fontSize: 11,
                                  background: `var(--bg-panel) ${chevronSvg('var(--text-muted)')}`,
                                }}
                                title="Expected date format in this column — click to change"
                              >
                                <option value="auto">auto</option>
                                <option value="iso">ISO (YYYY-MM-DD)</option>
                                <option value="dd/mm/yyyy">DD/MM/YYYY</option>
                                <option value="mm/dd/yyyy">MM/DD/YYYY</option>
                                <option value="dd-mm-yyyy">DD-MM-YYYY</option>
                                <option value="dd.mm.yyyy">DD.MM.YYYY</option>
                                <option value="yyyymmdd">YYYYMMDD</option>
                              </select>
                            )}
                            <button
                              className="btn-hover btn-hover-accent"
                              type="button"
                              title="Test the format against up to 100k rows"
                              disabled={isValidating}
                              onClick={() => validateColumnType(d.table, d.column, d.type, currentFormat)}
                              style={{ padding: '2px 8px', fontSize: 11, background: 'transparent', border: '1px solid var(--border-default)', borderRadius: 4, cursor: isValidating ? 'wait' : 'pointer' }}
                            >
                              {isValidating ? '…' : 'Test'}
                            </button>
                            {result && (
                              <ValidationBadge result={result} />
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td style={tdStyle}>
                      <input
                        style={editableInputStyle}
                        value={d.label}
                        onChange={(e) => setDimensions((prev) => prev.map((x) => x.name === d.name ? { ...x, label: e.target.value } : x))}
                        title="Display name shown to report users — click to edit"
                      />
                    </td>
                    <td style={tdStyle}>
                      <button className="btn-hover btn-hover-danger" onClick={() => removeDimension(d.name)} style={removeBtn}>Remove</button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Measures */}
        <div style={cardStyle}>
          <div style={_hs49}>
            <h3 style={{ ...cardTitle, marginBottom: 0 }}>Measures ({measures.length})</h3>
            <button className="btn-hover btn-hover-accent" onClick={() => setShowCalcMeasure(true)} style={addCalcBtn}>+ Measure</button>
          </div>

          {showCalcMeasure && (
            <div style={_hs50}>
              <div style={_hs51}>New calculated measure</div>
              <input
                type="text" placeholder="Label (e.g. Amount per capita)"
                value={calcMeasure.label} onChange={(e) => setCalcMeasure({ ...calcMeasure, label: e.target.value })}
                style={calcInput}
              />
              <SqlExpressionInput
                value={calcMeasure.expression}
                onChange={(v) => setCalcMeasure({ ...calcMeasure, expression: v })}
                model={{ dimensions, measures }}
              />
              <div style={_hs52}>
                <button className="btn-hover" onClick={() => { setShowCalcMeasure(false); setCalcMeasure({ label: '', expression: '' }); }} style={calcCancelBtn}>Cancel</button>
                <button className="btn-hover btn-hover-primary" onClick={addCalculatedMeasure} disabled={!calcMeasure.label || !calcMeasure.expression} style={calcSaveBtn}>Add</button>
              </div>
            </div>
          )}

          {measures.length === 0 && !showCalcMeasure ? (
            <p style={_hs53}>
              No measures yet. Go to "Schema & Joins" and click M, or add a SQL measure above.
            </p>
          ) : (
            <table style={tableStyleCSS}>
              <thead>
                <tr>
                  <th style={thStyle}>Table</th>
                  <th style={thStyle}>Column</th>
                  <th style={thStyle}>Aggregation</th>
                  <th style={thStyle}>Label (display name)</th>
                  <th style={thStyle}></th>
                </tr>
              </thead>
              <tbody>
                {measures.map((m) => {
                  const broken = brokenRefByKey.get(`measure\u0000${m.name}`);
                  return (
                  <tr key={m.name} style={broken ? { background: 'var(--state-warning-soft)' } : undefined} title={broken ? (broken.issue === 'missing_table' ? `Table "${broken.table}" not found` : broken.issue === 'missing_column' ? `Column "${broken.column}" missing in "${broken.table}"` : broken.issue) : undefined}>
                    <td style={tdStyle}>{broken && <span style={_hs54}>⚠️</span>}{m.aggregation === 'custom' ? <span style={_hs55}>SQL</span> : m.table}</td>
                    <td style={tdStyle} title={m.expression || ''}>
                      {m.aggregation === 'custom' ? (
                        <span style={_hs56}>
                          {m.expression?.length > 30 ? m.expression.substring(0, 30) + '...' : m.expression}
                        </span>
                      ) : m.column}
                    </td>
                    <td style={tdStyle}>
                      {m.aggregation === 'custom' ? (
                        <span style={_hs57}>custom</span>
                      ) : (
                      <select
                        style={inlineInput}
                        value={m.aggregation}
                        onChange={(e) => setMeasures((prev) => prev.map((x) => x.name === m.name ? {
                          ...x, aggregation: e.target.value,
                          name: m.column === '*' ? `${m.table}.count` : `${m.table}.${m.column}_${e.target.value}`,
                          label: m.column === '*' ? `${m.table} count` : m.column,
                        } : x))}
                      >
                        {AGG_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      )}
                    </td>
                    <td style={tdStyle}>
                      <input
                        style={inlineInput}
                        value={m.label}
                        onChange={(e) => setMeasures((prev) => prev.map((x) => x.name === m.name ? { ...x, label: e.target.value } : x))}
                      />
                    </td>
                    <td style={tdStyle}>
                      <button className="btn-hover btn-hover-danger" onClick={() => removeMeasure(m.name)} style={removeBtn}>Remove</button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Joins summary */}
        <div style={cardStyle}>
          <h3 style={cardTitle}>Joins ({joins.length})</h3>
          {joins.length === 0 ? (
            <p style={_hs58}>No joins. Go to "Schema & Joins" to drag between column dots.</p>
          ) : (
            <div style={_hs59}>
              {joins.map((j, i) => (
                <div key={i} style={_hs60}>
                  <span style={_hs61}>{j.from_table}</span>
                  <span style={_hs62}>.{j.from_column}</span>
                  <span style={{ ...badge, background: 'var(--bg-active)', color: 'var(--accent-primary)' }}>{j.type}</span>
                  <span style={_hs63}>{j.to_table}</span>
                  <span style={_hs64}>.{j.to_column}</span>
                  <button className="btn-hover btn-hover-danger" onClick={() => setJoins((prev) => prev.filter((_, idx) => idx !== i))} style={{ ...removeBtn, marginLeft: 'auto' }}>x</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
