import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import SchemaCanvas from '../components/SchemaCanvas/SchemaCanvas';
import SqlExpressionInput from '../components/SqlExpressionInput/SqlExpressionInput';
import api from '../utils/api';
import { TbArrowLeft } from 'react-icons/tb';

const AGG_OPTIONS = [
  { value: 'sum', label: 'Sum' },
  { value: 'avg', label: 'Average' },
  { value: 'count', label: 'Count' },
  { value: 'min', label: 'Min' },
  { value: 'max', label: 'Max' },
];

const STEPS = ['Tables', 'Schema & Joins', 'Dimensions & Measures'];

export default function ModelEditor() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [step, setStep] = useState(0);
  const [allTables, setAllTables] = useState([]);
  const [selectedTables, setSelectedTables] = useState([]);
  const [tableColumns, setTableColumns] = useState({});
  const [tablePositions, setTablePositions] = useState({});
  const [dimensions, setDimensions] = useState([]);
  const [measures, setMeasures] = useState([]);
  const [joins, setJoins] = useState([]);
  const [saving, setSaving] = useState(false);
  const [showCalcMeasure, setShowCalcMeasure] = useState(false);
  const [calcMeasure, setCalcMeasure] = useState({ label: '', expression: '' });
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [datasource, setDatasource] = useState(null);
  const [model, setModel] = useState(null);
  const [tableSearch, setTableSearch] = useState('');
  const [tablesError, setTablesError] = useState(null);
  const [tablesLoading, setTablesLoading] = useState(false);

  // Load model + datasource + tables
  useEffect(() => {
    const load = async () => {
      try {
        const modelRes = await api.get(`/models/${id}`);
        const m = modelRes.data.model;
        setModel(m);
        setName(m.name);
        setDescription(m.description || '');
        setSelectedTables(m.selected_tables || []);
        setTablePositions(m.table_positions || {});
        setDimensions(m.dimensions || []);
        setMeasures(m.measures || []);
        setJoins(m.joins || []);

        const dsRes = await api.get(`/datasources/${m.datasource_id}`);
        setDatasource(dsRes.data.datasource);

        // Load tables
        setTablesLoading(true);
        try {
          const tablesRes = await api.get(`/datasources/${dsRes.data.datasource.id}/tables`);
          setAllTables(tablesRes.data.tables || []);
        } catch (err) {
          console.error('Failed to load tables:', err);
          setTablesError(err.response?.data?.error || 'Failed to load tables from database');
        } finally {
          setTablesLoading(false);
        }

        // If model already has selected tables, jump to step 1
        if ((m.selected_tables || []).length > 0) {
          setStep(1);
          for (const t of m.selected_tables) {
            try {
              const colRes = await api.get(`/datasources/${dsRes.data.datasource.id}/tables/${t}/columns`);
              setTableColumns((prev) => ({ ...prev, [t]: colRes.data.columns }));
            } catch (err) {
              console.error(`Failed to load columns for ${t}:`, err);
            }
          }
        }
      } catch (err) {
        console.error('Failed to load model:', err);
        navigate('/models');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id, navigate]);

  // When entering step 1, load columns for newly selected tables
  const enterStep1 = useCallback(async () => {
    const toLoad = selectedTables.filter((t) => !tableColumns[t]);
    for (const t of toLoad) {
      const res = await api.get(`/datasources/${model.datasource_id}/tables/${t}/columns`);
      setTableColumns((prev) => ({ ...prev, [t]: res.data.columns }));
    }
    // Assign default positions for tables without one
    setTablePositions((prev) => {
      const next = { ...prev };
      let x = 40;
      let y = 40;
      selectedTables.forEach((t) => {
        if (!next[t]) {
          next[t] = { x, y };
          x += 260;
          if (x > 800) { x = 40; y += 300; }
        }
      });
      return next;
    });
    setStep(1);
  }, [selectedTables, tableColumns, model]);

  const toggleTable = (tableName) => {
    setSelectedTables((prev) =>
      prev.includes(tableName) ? prev.filter((t) => t !== tableName) : [...prev, tableName]
    );
  };

  const isNumeric = (dataType) => {
    const t = dataType.toLowerCase();
    return ['integer', 'bigint', 'numeric', 'decimal', 'real', 'double precision',
      'float', 'int', 'smallint', 'tinyint', 'mediumint', 'double', 'serial', 'bigserial'].includes(t);
  };

  const isDateType = (dataType) => {
    const t = dataType.toLowerCase();
    return ['date', 'timestamp', 'timestamptz', 'timestamp with time zone',
      'timestamp without time zone', 'datetime', 'time', 'interval',
      'smalldatetime', 'datetime2', 'datetimeoffset'].includes(t);
  };

  const getColumnType = (dataType) => {
    if (isNumeric(dataType)) return 'number';
    if (isDateType(dataType)) return 'date';
    return 'string';
  };

  const addDimension = (table, column) => {
    const col = typeof column === 'string' ? { column_name: column, data_type: 'string' } : column;
    const dimName = `${table}.${col.column_name}`;
    if (dimensions.find((d) => d.name === dimName)) {
      setDimensions((prev) => prev.filter((d) => d.name !== dimName));
      return;
    }
    setDimensions((prev) => [...prev, {
      name: dimName, table, column: col.column_name,
      type: getColumnType(col.data_type),
      label: col.column_name,
    }]);
  };

  const addMeasure = (table, column) => {
    const col = typeof column === 'string' ? { column_name: column, data_type: 'number' } : column;
    const existing = measures.find((m) => m.table === table && m.column === col.column_name && m.column !== '*');
    if (existing) {
      setMeasures((prev) => prev.filter((m) => m.name !== existing.name));
      return;
    }
    const measName = `${table}.${col.column_name}_sum`;
    setMeasures((prev) => [...prev, {
      name: measName, table, column: col.column_name,
      aggregation: 'sum', label: col.column_name,
    }]);
  };

  const addCalculatedMeasure = () => {
    if (!calcMeasure.label || !calcMeasure.expression) return;
    const measName = `_calc.${calcMeasure.label.replace(/\s+/g, '_').toLowerCase()}`;
    if (measures.find((m) => m.name === measName)) return;
    setMeasures((prev) => [...prev, {
      name: measName, table: '', column: '', aggregation: 'custom',
      expression: calcMeasure.expression, label: calcMeasure.label,
    }]);
    setCalcMeasure({ label: '', expression: '' });
    setShowCalcMeasure(false);
  };


  const removeDimension = (dimName) => setDimensions((prev) => prev.filter((d) => d.name !== dimName));
  const removeMeasure = (measName) => setMeasures((prev) => prev.filter((m) => m.name !== measName));

  const [saveMsg, setSaveMsg] = useState(null);
  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put(`/models/${id}`, {
        name, description, selected_tables: selectedTables,
        table_positions: tablePositions, dimensions, measures, joins,
      });
      setSaveMsg('Saved');
      setTimeout(() => setSaveMsg(null), 2000);
    } catch (err) {
      console.error('Save failed:', err);
      setSaveMsg('Save failed');
      setTimeout(() => setSaveMsg(null), 3000);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div style={{ padding: 40, color: '#94a3b8' }}>Loading model...</div>;

  // Build table data for SchemaCanvas (only selected tables with loaded columns)
  const schemaTablesData = {};
  selectedTables.forEach((t) => {
    if (tableColumns[t]) schemaTablesData[t] = tableColumns[t];
  });

  const filteredTables = tableSearch
    ? allTables.filter((t) => t.toLowerCase().includes(tableSearch.toLowerCase()))
    : allTables;

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#f1f5f9' }}>
      {/* Header */}
      <header style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => navigate('/models')} style={backStyle}><TbArrowLeft size={16} /> Back</button>
          <input
            type="text" value={name} onChange={(e) => setName(e.target.value)}
            style={{ fontSize: 18, fontWeight: 600, border: 'none', outline: 'none', background: 'transparent', color: '#0f172a' }}
          />
          <span style={{ fontSize: 12, color: '#94a3b8' }}>{datasource?.name}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Steps */}
          <div style={{ display: 'flex', gap: 2, marginRight: 16 }}>
            {STEPS.map((s, i) => (
              <button
                key={i}
                onClick={() => {
                  if (i === 1 && step === 0) enterStep1();
                  else setStep(i);
                }}
                style={{
                  padding: '6px 14px', fontSize: 12, fontWeight: step === i ? 700 : 400,
                  border: '1px solid #e2e8f0', borderRadius: i === 0 ? '6px 0 0 6px' : i === 2 ? '0 6px 6px 0' : 0,
                  background: step === i ? '#3b82f6' : '#fff',
                  color: step === i ? '#fff' : '#475569', cursor: 'pointer',
                }}
              >
                {i + 1}. {s}
              </button>
            ))}
          </div>
          <button onClick={handleSave} disabled={saving} style={primaryBtn}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </header>

      {/* Step 0: Table selection */}
      {step === 0 && (
        <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
          <div style={{ maxWidth: 700, margin: '0 auto' }}>
            <div style={cardStyle}>
              <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Select Tables</h2>
              <p style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
                Choose the tables you want to include in this model.
              </p>
              <input
                type="text" placeholder="Search tables..."
                value={tableSearch} onChange={(e) => setTableSearch(e.target.value)}
                style={searchInput}
              />
              <div style={{ maxHeight: 400, overflow: 'auto' }}>
                {tablesLoading && (
                  <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8' }}>Loading tables from database...</div>
                )}
                {tablesError && (
                  <div style={{ padding: 12, background: '#fef2f2', color: '#dc2626', borderRadius: 6, fontSize: 13, marginBottom: 8 }}>
                    {tablesError}
                  </div>
                )}
                {!tablesLoading && !tablesError && filteredTables.length === 0 && (
                  <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8' }}>
                    {tableSearch ? 'No tables match your search' : 'No tables found in this database'}
                  </div>
                )}
                {filteredTables.map((table) => (
                  <label key={table} style={tableCheckRow}>
                    <input
                      type="checkbox"
                      checked={selectedTables.includes(table)}
                      onChange={() => toggleTable(table)}
                      style={{ width: 18, height: 18, cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: 14, color: '#0f172a' }}>{table}</span>
                  </label>
                ))}
              </div>
              <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: '#64748b' }}>{selectedTables.length} table(s) selected</span>
                <button
                  onClick={enterStep1}
                  disabled={selectedTables.length === 0}
                  style={{ ...primaryBtn, opacity: selectedTables.length === 0 ? 0.5 : 1 }}
                >
                  Next: Schema & Joins →
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Step 1: Visual schema */}
      {step === 1 && (
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          <div style={{
            position: 'absolute', top: 12, left: 12, zIndex: 10,
            background: '#fff', borderRadius: 6, padding: '6px 12px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)', fontSize: 12, color: '#64748b',
          }}>
            Drag column dots to create joins. Click D/M to mark dimensions/measures.
          </div>
          <SchemaCanvas
            tables={schemaTablesData}
            positions={tablePositions}
            joins={joins}
            dimensions={dimensions}
            measures={measures}
            onPositionsChange={setTablePositions}
            onJoinsChange={setJoins}
            onAddDimension={addDimension}
            onAddMeasure={addMeasure}
            datasourceId={model?.datasource_id}
            isNumeric={isNumeric}
            isDateType={isDateType}
          />
        </div>
      )}

      {/* Step 2: Dimensions & Measures */}
      {step === 2 && (
        <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
          <div style={{ maxWidth: 1000, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Description */}
            <div style={cardStyle}>
              <input
                type="text" value={description} onChange={(e) => setDescription(e.target.value)}
                placeholder="Model description (optional)"
                style={{ width: '100%', border: 'none', outline: 'none', fontSize: 14, color: '#475569' }}
              />
            </div>

            {/* Dimensions */}
            <div style={cardStyle}>
              <h3 style={cardTitle}>Dimensions ({dimensions.length})</h3>
              {dimensions.length === 0 ? (
                <p style={{ color: '#94a3b8', fontSize: 13 }}>
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
                    {dimensions.map((d) => (
                      <tr key={d.name}>
                        <td style={tdStyle}>{d.table}</td>
                        <td style={tdStyle}>{d.column}</td>
                        <td style={tdStyle}>
                          <span style={{ ...badge, background: '#eff6ff', color: '#3b82f6' }}>{d.type}</span>
                        </td>
                        <td style={tdStyle}>
                          <input
                            style={inlineInput}
                            value={d.label}
                            onChange={(e) => setDimensions((prev) => prev.map((x) => x.name === d.name ? { ...x, label: e.target.value } : x))}
                          />
                        </td>
                        <td style={tdStyle}>
                          <button onClick={() => removeDimension(d.name)} style={removeBtn}>Remove</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Measures */}
            <div style={cardStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h3 style={{ ...cardTitle, marginBottom: 0 }}>Measures ({measures.length})</h3>
                <button onClick={() => setShowCalcMeasure(true)} style={addCalcBtn}>+ Measure</button>
              </div>

              {showCalcMeasure && (
                <div style={{ padding: 12, background: '#f8fafc', borderRadius: 6, marginBottom: 12, border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 8 }}>New calculated measure</div>
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
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <button onClick={() => { setShowCalcMeasure(false); setCalcMeasure({ label: '', expression: '' }); }} style={calcCancelBtn}>Cancel</button>
                    <button onClick={addCalculatedMeasure} disabled={!calcMeasure.label || !calcMeasure.expression} style={calcSaveBtn}>Add</button>
                  </div>
                </div>
              )}

              {measures.length === 0 && !showCalcMeasure ? (
                <p style={{ color: '#94a3b8', fontSize: 13 }}>
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
                    {measures.map((m) => (
                      <tr key={m.name}>
                        <td style={tdStyle}>{m.aggregation === 'custom' ? <span style={{ color: '#8b5cf6', fontSize: 11 }}>SQL</span> : m.table}</td>
                        <td style={tdStyle} title={m.expression || ''}>
                          {m.aggregation === 'custom' ? (
                            <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#64748b' }}>
                              {m.expression?.length > 30 ? m.expression.substring(0, 30) + '...' : m.expression}
                            </span>
                          ) : m.column}
                        </td>
                        <td style={tdStyle}>
                          {m.aggregation === 'custom' ? (
                            <span style={{ fontSize: 11, color: '#8b5cf6', fontWeight: 600 }}>custom</span>
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
                          <button onClick={() => removeMeasure(m.name)} style={removeBtn}>Remove</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Joins summary */}
            <div style={cardStyle}>
              <h3 style={cardTitle}>Joins ({joins.length})</h3>
              {joins.length === 0 ? (
                <p style={{ color: '#94a3b8', fontSize: 13 }}>No joins. Go to "Schema & Joins" to drag between column dots.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {joins.map((j, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: '#f8fafc', borderRadius: 6, fontSize: 13 }}>
                      <span style={{ fontWeight: 600 }}>{j.from_table}</span>
                      <span style={{ color: '#64748b' }}>.{j.from_column}</span>
                      <span style={{ ...badge, background: '#eff6ff', color: '#3b82f6' }}>{j.type}</span>
                      <span style={{ fontWeight: 600 }}>{j.to_table}</span>
                      <span style={{ color: '#64748b' }}>.{j.to_column}</span>
                      <button onClick={() => setJoins((prev) => prev.filter((_, idx) => idx !== i))} style={{ ...removeBtn, marginLeft: 'auto' }}>x</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {saveMsg && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          padding: '8px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600, zIndex: 9999,
          backgroundColor: saveMsg === 'Saved' ? '#22c55e' : '#ef4444', color: '#fff',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        }}>{saveMsg === 'Saved' ? '✓ Model saved' : '✗ Save failed'}</div>
      )}
    </div>
  );
}

const headerStyle = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '10px 20px', backgroundColor: '#fff', borderBottom: '1px solid #e2e8f0', flexShrink: 0,
};
const backStyle = { display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', background: 'none', border: '1px solid #e2e8f0', borderRadius: 6, color: '#64748b', cursor: 'pointer', fontSize: 13, fontWeight: 500 };
const primaryBtn = {
  padding: '8px 16px', fontSize: 14, fontWeight: 600, border: 'none',
  borderRadius: 6, background: '#3b82f6', color: '#fff', cursor: 'pointer',
};
const cardStyle = { backgroundColor: '#fff', padding: 20, borderRadius: 8, border: '1px solid #e2e8f0' };
const cardTitle = { fontSize: 15, fontWeight: 600, color: '#0f172a', marginBottom: 12 };
const searchInput = {
  width: '100%', padding: '8px 10px', border: '1px solid #e2e8f0',
  borderRadius: 6, fontSize: 14, outline: 'none', marginBottom: 12, boxSizing: 'border-box',
};
const tableCheckRow = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 8px',
  borderBottom: '1px solid #f1f5f9', cursor: 'pointer',
};
const tableStyleCSS = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
const thStyle = { textAlign: 'left', padding: '8px 10px', borderBottom: '2px solid #e2e8f0', color: '#64748b', fontWeight: 600, fontSize: 12 };
const tdStyle = { padding: '6px 10px', borderBottom: '1px solid #f1f5f9', color: '#334155' };
const inlineInput = {
  padding: '4px 6px', border: '1px solid #e2e8f0', borderRadius: 4,
  fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box',
};
const badge = { padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 };
const removeBtn = {
  fontSize: 12, color: '#dc2626', background: 'none', border: '1px solid #fca5a5',
  borderRadius: 4, padding: '2px 8px', cursor: 'pointer',
};
const addCalcBtn = {
  fontSize: 12, fontWeight: 600, padding: '4px 10px', border: '1px solid #8b5cf6',
  borderRadius: 4, background: '#f5f3ff', color: '#8b5cf6', cursor: 'pointer',
};
const calcInput = {
  width: '100%', padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 4,
  fontSize: 13, outline: 'none', marginBottom: 8, boxSizing: 'border-box',
};
const calcCancelBtn = {
  fontSize: 12, padding: '4px 10px', border: '1px solid #e2e8f0',
  borderRadius: 4, background: '#fff', color: '#64748b', cursor: 'pointer',
};
const calcSaveBtn = {
  fontSize: 12, fontWeight: 600, padding: '4px 10px', border: 'none',
  borderRadius: 4, background: '#8b5cf6', color: '#fff', cursor: 'pointer',
};
