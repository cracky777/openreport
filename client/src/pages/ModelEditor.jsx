import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import SchemaCanvas from '../components/SchemaCanvas/SchemaCanvas';
import RLSDialog from '../components/SchemaCanvas/RLSDialog';
import SqlExpressionInput from '../components/SqlExpressionInput/SqlExpressionInput';
import api from '../utils/api';
import { headerShellStyle, BackButton, PrimaryButton, SecondaryButton, headerBadgeStyle } from '../components/PageHeader/PageHeader';
import { useTheme } from '../hooks/useTheme';

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
  const { resolved: themeResolved, themes: availableThemes } = useTheme();

  const [step, setStep] = useState(0);
  const [allTables, setAllTables] = useState([]);
  const [selectedTables, setSelectedTables] = useState([]);
  const [tableColumns, setTableColumns] = useState({});
  const [tablePositions, setTablePositions] = useState({});
  const [dimensions, setDimensions] = useState([]);
  const [measures, setMeasures] = useState([]);
  const [joins, setJoins] = useState([]);
  const [rls, setRls] = useState({}); // { enabled, table, primaryKey, rules: { rowKey: [patterns] } }
  // Per-column type override map: { "table.column": "date" | "string" | "number" | "boolean" }.
  // Reinterpret a varchar that holds dates as a real date dimension, etc. Empty
  // entries fall back to the column's native db type returned by getColumns().
  const [columnTypes, setColumnTypes] = useState({});
  // Per-column validation state used by the "test format" button next to the
  // type dropdown. `validatingColumn` holds the currently-running key (or null);
  // `validationResults` caches the most recent result per `table.column`
  // so the badge persists between renders.
  const [validatingColumn, setValidatingColumn] = useState(null);
  const [validationResults, setValidationResults] = useState({});
  const [rlsDialogTable, setRlsDialogTable] = useState(null); // tableName when dialog is open
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
  const [brokenRefs, setBrokenRefs] = useState([]);
  const [validating, setValidating] = useState(false);
  const [creatingReport, setCreatingReport] = useState(false);
  const [showDsChange, setShowDsChange] = useState(false);
  const [allDatasources, setAllDatasources] = useState([]);
  const [switchingDs, setSwitchingDs] = useState(false);

  const runValidation = useCallback(async () => {
    if (!id) return;
    setValidating(true);
    try {
      const res = await api.get(`/models/${id}/validate`);
      setBrokenRefs(res.data?.brokenReferences || []);
    } catch (err) {
      console.error('Validation failed:', err);
      setBrokenRefs([]);
    } finally {
      setValidating(false);
    }
  }, [id]);

  const openDsChange = async () => {
    try {
      const res = await api.get('/datasources');
      setAllDatasources(res.data?.datasources || []);
      setShowDsChange(true);
    } catch (err) {
      alert(err?.response?.data?.error || 'Failed to load datasources');
    }
  };

  const applyDsChange = async (newDsId) => {
    if (!newDsId || newDsId === model?.datasource_id) { setShowDsChange(false); return; }
    const ok = confirm('Change the datasource for this model?\n\nReferences to tables/columns that no longer exist will be flagged so you can fix them. Existing dimensions, measures and joins are preserved.');
    if (!ok) return;
    setSwitchingDs(true);
    try {
      await api.put(`/models/${id}`, { datasourceId: newDsId });
      // Reload model (server preserves selected_tables/dimensions/measures/joins via COALESCE)
      const modelRes = await api.get(`/models/${id}`);
      const m = modelRes.data.model;
      // Fully resync local state — the model content itself is unchanged, only the datasource moves
      setModel(m);
      setSelectedTables(m.selected_tables || []);
      setTablePositions(m.table_positions || {});
      setDimensions(m.dimensions || []);
      setMeasures(m.measures || []);
      setJoins(m.joins || []);
      setRls(m.rls || {});
      setColumnTypes(m.column_types || {});
      // Reload datasource meta
      const dsRes = await api.get(`/datasources/${m.datasource_id}`);
      setDatasource(dsRes.data.datasource);
      // Reload available tables from new datasource (for the UI pickers)
      try {
        const tablesRes = await api.get(`/datasources/${dsRes.data.datasource.id}/tables`);
        setAllTables(tablesRes.data.tables || []);
        setTablesError(null);
      } catch (err) {
        setTablesError(err?.response?.data?.error || 'Failed to load tables from database');
      }
      // Refresh columns for each selected table. Keep previous columns as a visual fallback
      // when the table still exists — only drop them if the table is outright gone.
      for (const t of (m.selected_tables || [])) {
        try {
          const colRes = await api.get(`/datasources/${dsRes.data.datasource.id}/tables/${t}/columns`);
          setTableColumns((prev) => ({ ...prev, [t]: colRes.data.columns }));
        } catch (err) {
          // Table missing in new datasource — drop its columns (validation will flag it)
          setTableColumns((prev) => { const n = { ...prev }; delete n[t]; return n; });
        }
      }
      runValidation();
      setShowDsChange(false);
    } catch (err) {
      alert(err?.response?.data?.error || 'Failed to change datasource');
    } finally {
      setSwitchingDs(false);
    }
  };

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
        setRls(m.rls || {});
        setColumnTypes(m.column_types || {});

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
        // Validate model references against the current datasource schema
        runValidation();
      } catch (err) {
        console.error('Failed to load model:', err);
        navigate('/models');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id, navigate, runValidation]);

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

  // Whole-number db types (no fractional part). Used to pre-select 'integer'
  // when the user creates a Dimension from such a column.
  const isIntegerType = (dataType) => {
    const t = String(dataType || '').toLowerCase();
    return ['integer', 'int', 'int2', 'int4', 'int8', 'bigint', 'smallint',
      'tinyint', 'mediumint', 'serial', 'bigserial', 'smallserial'].includes(t);
  };

  // Floating / fixed-precision numeric types.
  const isDecimalType = (dataType) => {
    const t = String(dataType || '').toLowerCase();
    return ['numeric', 'decimal', 'real', 'double precision', 'float', 'double',
      'money', 'smallmoney',
      // Postgres interval — durations are aggregable in SQL (SUM/AVG return interval).
      'interval'].includes(t);
  };

  // Combined check used by the schema canvas to decide whether to expose the
  // "M" (Measure) flag on a column.
  const isNumeric = (dataType) => isIntegerType(dataType) || isDecimalType(dataType);

  const isDateType = (dataType) => {
    const t = String(dataType || '').toLowerCase();
    return ['date', 'timestamp', 'timestamptz', 'timestamp with time zone',
      'timestamp without time zone', 'datetime', 'time',
      'smalldatetime', 'datetime2', 'datetimeoffset'].includes(t);
  };

  const getColumnType = (dataType) => {
    if (isIntegerType(dataType)) return 'integer';
    if (isDecimalType(dataType)) return 'decimal';
    if (isDateType(dataType)) return 'date';
    return 'string';
  };

  // Older models stored 'number' as the catch-all numeric type. Normalise it
  // to 'decimal' on read so the new dropdown widgets and validators don't
  // need to special-case the legacy value. Saving emits the new vocabulary.
  const normalizeStoredType = (t) => (t === 'number' ? 'decimal' : t);

  // columnTypes entries can be either a plain string ('date', 'integer', ...)
  // or an object { type, format } once the user picks an explicit format
  // (relevant for dates: 'dd/mm/yyyy', 'iso', etc.). These two helpers
  // normalise reads/writes so the rest of the code can stay simple.
  const readOverride = (entry) => {
    if (!entry) return null;
    if (typeof entry === 'string') return { type: entry, format: 'auto' };
    return { type: entry.type, format: entry.format || 'auto' };
  };
  // Build the value to store back. Returns null when the override is auto
  // (= no override, drop the entry entirely).
  const writeOverride = (type, format) => {
    if (!type || type === 'auto') return null;
    if (!format || format === 'auto') return type;       // simple form
    return { type, format };                              // object form
  };

  // Effective type + optional format for a column. Reads the override map
  // (which can be either a plain type string or an object { type, format })
  // and falls back to the inferred native type. Returns { type, format }.
  const effectiveColumnType = useCallback((table, column, dataType) => {
    const key = `${table}.${column}`;
    const override = readOverride(columnTypes && columnTypes[key]);
    if (override) return override;
    return { type: getColumnType(dataType), format: 'auto' };
  }, [columnTypes]);

  // Set or clear an override for one column. Optional `format` is used when
  // the type is 'date' (and ignored otherwise). After updating the map, we
  // retrofit any existing dimension referencing this column so reports pick
  // up the new type without a manual rebind.
  const setColumnType = useCallback((table, column, nextType, nextFormat) => {
    const key = `${table}.${column}`;
    setColumnTypes((prev) => {
      const copy = { ...(prev || {}) };
      const stored = writeOverride(nextType, nextFormat);
      if (stored == null) delete copy[key];
      else copy[key] = stored;
      return copy;
    });
    // Resolve effective type for the dimension propagation. Format isn't
    // stored on the dimension itself — only `type` is, which is what the
    // SQL builder consults for CAST AS DATE etc.
    const cols = tableColumns[table] || [];
    const dataType = cols.find((c) => c.column_name === column)?.data_type;
    const effective = (!nextType || nextType === 'auto') ? getColumnType(dataType) : nextType;
    setDimensions((prev) => prev.map((d) =>
      d.table === table && d.column === column ? { ...d, type: effective } : d
    ));
  }, [tableColumns]);

  // Run a backend sample query (up to 100k non-null rows) to check how many
  // values can be coerced into the target type. Result is cached per column
  // so the badge stays visible until the user re-tests.
  const validateColumnType = useCallback(async (table, column, type, dateFormat) => {
    const key = `${table}.${column}`;
    setValidatingColumn(key);
    try {
      const res = await api.post(`/models/${id}/validate-column-type`, {
        table, column, type, dateFormat: dateFormat || 'auto',
      });
      setValidationResults((prev) => ({ ...prev, [key]: { ...res.data, type, dateFormat } }));
    } catch (err) {
      setValidationResults((prev) => ({ ...prev, [key]: { error: err?.response?.data?.error || err.message, type, dateFormat } }));
    } finally {
      setValidatingColumn(null);
    }
  }, [id]);

  const addDimension = (table, column) => {
    const col = typeof column === 'string' ? { column_name: column, data_type: 'string' } : column;
    const dimName = `${table}.${col.column_name}`;
    if (dimensions.find((d) => d.name === dimName)) {
      setDimensions((prev) => prev.filter((d) => d.name !== dimName));
      return;
    }
    // dimension.type is a flat string ('date', 'integer', 'decimal', ...) —
    // pull only the type from the {type, format} object effectiveColumnType
    // returns. The format (when present) lives on columnTypes alone.
    const eff = effectiveColumnType(table, col.column_name, col.data_type);
    setDimensions((prev) => [...prev, {
      name: dimName, table, column: col.column_name,
      type: eff.type,
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
      // Stamp the source data type so the SQL builder can wrap PostgreSQL
      // `interval` columns with EXTRACT(EPOCH FROM …) — otherwise SUM/AVG
      // returns a JS object that renders as "[object Object]" in widgets.
      dataType: String(col.data_type || '').toLowerCase(),
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
    // Sanity check: warn before saving an empty model. Reports built on a
    // model with no flagged columns can't bind anything and will look broken.
    if (selectedTables.length > 0 && dimensions.length === 0 && measures.length === 0) {
      const ok = window.confirm(
        'No dimensions, measures or date columns have been flagged on this model. '
        + 'Reports built on it will have nothing to display. Save anyway?'
      );
      if (!ok) return;
    }
    setSaving(true);
    try {
      await api.put(`/models/${id}`, {
        name, description, selected_tables: selectedTables,
        table_positions: tablePositions, dimensions, measures, joins, rls,
        column_types: columnTypes,
      });
      setSaveMsg('Saved');
      setTimeout(() => setSaveMsg(null), 2000);
      runValidation();
      // If the user came here from the dashboard new-report wizard
      // (?then=newReport), bounce back so they can finish creating the report
      // with the freshly-configured model preselected. Forward any title
      // they had typed so the wizard restores it.
      const params = new URLSearchParams(window.location.search);
      if (params.get('then') === 'newReport') {
        const back = new URLSearchParams();
        back.set('newReport', '1');
        back.set('modelId', id);
        const t = params.get('title');
        if (t) back.set('title', t);
        navigate(`/?${back.toString()}`);
      }
    } catch (err) {
      console.error('Save failed:', err);
      setSaveMsg('Save failed');
      setTimeout(() => setSaveMsg(null), 3000);
    } finally {
      setSaving(false);
    }
  };

  // Create a new report bound to this model and jump straight into its
  // editor. Notes:
  //   - The report references the LAST SAVED state of the model (the API
  //     reads from the DB), so unsaved local edits won't be reflected.
  //     We auto-save first to keep the flow seamless.
  //   - Default title is "{model name} — Report" so it's recognisable on the
  //     dashboard without a forced prompt; the user can rename in the editor.
  const handleCreateReport = async () => {
    if (!model || creatingReport) return;
    setCreatingReport(true);
    try {
      // Persist whatever the user has on screen first (so the new report
      // sees the freshly-flagged dimensions / measures, not stale data).
      await api.put(`/models/${id}`, {
        name, description, selected_tables: selectedTables,
        table_positions: tablePositions, dimensions, measures, joins, rls,
        column_types: columnTypes,
      });
      const res = await api.post('/reports', {
        title: `${name || 'New'} — Report`,
        modelId: id,
        // Inherit the user's current theme so the new report doesn't open
        // in the default light scheme when they're working in dark mode.
        settings: {
          theme: availableThemes && availableThemes[themeResolved]
            ? { key: themeResolved, ...availableThemes[themeResolved] }
            : null,
        },
      });
      navigate(`/edit/${res.data.report.id}`);
    } catch (err) {
      alert(err?.response?.data?.error || 'Failed to create report');
      setCreatingReport(false);
    }
  };

  if (loading) return <div style={{ padding: 40, color: 'var(--text-disabled)' }}>Loading model...</div>;

  // Build table data for SchemaCanvas (only selected tables with loaded columns)
  const schemaTablesData = {};
  selectedTables.forEach((t) => {
    if (tableColumns[t]) schemaTablesData[t] = tableColumns[t];
  });

  // Index broken refs by "kind name" so per-row lookups in the dimension/measure
  // tables are O(1) instead of scanning brokenRefs for every rendered row.
  const brokenRefByKey = new Map();
  brokenRefs.forEach((r) => { if (r.name) brokenRefByKey.set(`${r.kind}\u0000${r.name}`, r); });

  const filteredTables = tableSearch
    ? allTables.filter((t) => t.toLowerCase().includes(tableSearch.toLowerCase()))
    : allTables;

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-app)' }}>
      {/* Header */}
      <header style={headerShellStyle}>
        <BackButton to="/models" />
        <input
          type="text" value={name} onChange={(e) => setName(e.target.value)}
          style={{
            fontSize: 16, fontWeight: 600, border: '1px solid transparent', outline: 'none',
            background: 'transparent', color: 'var(--text-primary)', minWidth: 180, maxWidth: 320,
            padding: '4px 8px', borderRadius: 6,
            transition: 'background 0.12s, border-color 0.12s',
          }}
          onFocus={(e) => { e.currentTarget.style.background = 'var(--bg-subtle)'; e.currentTarget.style.borderColor = 'var(--border-default)'; }}
          onBlur={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'transparent'; }}
        />
        {datasource?.name && (
          <button
            onClick={openDsChange}
            title="Change datasource"
            style={{ ...headerBadgeStyle, cursor: 'pointer' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-active)'; e.currentTarget.style.borderColor = 'var(--accent-primary)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--accent-primary-soft)'; e.currentTarget.style.borderColor = 'var(--accent-primary-border)'; }}
          >
            {datasource.name}
            <span style={{ fontSize: 9, color: 'var(--accent-primary)', marginLeft: 2 }}>▼</span>
          </button>
        )}
        <div style={{ flex: 1 }} />
        {/* Steps */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 2,
          padding: '3px 4px', background: 'var(--bg-subtle)',
          border: '1px solid var(--border-default)', borderRadius: 10, marginRight: 8,
        }}>
          {STEPS.map((s, i) => {
            const active = step === i;
            return (
              <button
                key={i}
                className="btn-hover"
                onClick={() => {
                  if (i === 1 && step === 0) enterStep1();
                  else setStep(i);
                }}
                style={{
                  padding: '6px 12px', fontSize: 12, fontWeight: active ? 600 : 500,
                  border: 'none', borderRadius: 6,
                  background: active ? 'var(--bg-panel)' : 'transparent',
                  color: active ? 'var(--accent-primary)' : 'var(--text-secondary)', cursor: 'pointer',
                  boxShadow: active ? '0 1px 3px rgba(15,23,42,0.08), inset 0 0 0 1px rgba(124,58,237,0.2)' : 'none',
                  transition: 'background 0.12s, color 0.12s, box-shadow 0.12s',
                }}
              >
                {i + 1}. {s}
              </button>
            );
          })}
        </div>
        <SecondaryButton
          onClick={handleCreateReport}
          disabled={creatingReport || saving || selectedTables.length === 0}
          title={selectedTables.length === 0
            ? 'Pick at least one table before creating a report'
            : 'Save the model and open a new report bound to it'}
          style={{ marginRight: 8 }}
        >
          {creatingReport ? 'Creating…' : '+ New Report'}
        </SecondaryButton>
        <PrimaryButton onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save'}
        </PrimaryButton>
      </header>

      {/* Change datasource modal */}
      {showDsChange && (
        <>
          <div onClick={() => setShowDsChange(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.35)', zIndex: 100 }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            background: 'var(--bg-panel)', borderRadius: 10, padding: 20, minWidth: 400, maxWidth: 480,
            boxShadow: '0 10px 30px rgba(15,23,42,0.25)', zIndex: 101,
          }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>Change datasource</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14, lineHeight: 1.5 }}>
              The model's tables, dimensions, measures and joins will be preserved. Any references to tables/columns that don't exist in the new datasource will be flagged on the model editor and on the widgets that use them.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 280, overflowY: 'auto', border: '1px solid var(--border-default)', borderRadius: 6, padding: 4 }}>
              {allDatasources.map((ds) => {
                const isCurrent = ds.id === model?.datasource_id;
                return (
                  <button key={ds.id}
                    disabled={isCurrent || switchingDs}
                    onClick={() => applyDsChange(ds.id)}
                    style={{
                      textAlign: 'left', padding: '8px 12px', border: 'none',
                      borderRadius: 5, cursor: isCurrent ? 'default' : 'pointer',
                      background: isCurrent ? 'var(--bg-active)' : 'transparent',
                      color: isCurrent ? 'var(--accent-primary)' : 'var(--text-primary)',
                      display: 'flex', flexDirection: 'column', gap: 2,
                    }}
                    onMouseEnter={(e) => { if (!isCurrent) e.currentTarget.style.background = 'var(--bg-subtle)'; }}
                    onMouseLeave={(e) => { if (!isCurrent) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <span style={{ fontSize: 13, fontWeight: 500 }}>
                      {ds.name} {isCurrent && <span style={{ fontSize: 10, color: 'var(--accent-primary)', marginLeft: 6 }}>current</span>}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {ds.db_type?.toUpperCase()} — {ds.host ? `${ds.host}:${ds.port}/${ds.db_name}` : ds.db_name}
                    </span>
                  </button>
                );
              })}
              {allDatasources.length === 0 && (
                <div style={{ padding: 16, fontSize: 12, color: 'var(--text-disabled)', textAlign: 'center' }}>No datasources available</div>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
              <button className="btn-hover" onClick={() => setShowDsChange(false)}
                style={{ padding: '6px 14px', fontSize: 13, background: 'var(--bg-subtle)', border: '1px solid var(--border-default)', borderRadius: 8, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        </>
      )}

      {/* Step 0: Table selection */}
      {step === 0 && (
        <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
          <div style={{ maxWidth: 700, margin: '0 auto' }}>
            <div style={cardStyle}>
              <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Select Tables</h2>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
                Choose the tables you want to include in this model.
              </p>
              <input
                type="text" placeholder="Search tables..."
                value={tableSearch} onChange={(e) => setTableSearch(e.target.value)}
                style={searchInput}
              />
              <div style={{ maxHeight: 400, overflow: 'auto' }}>
                {tablesLoading && (
                  <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-disabled)' }}>Loading tables from database...</div>
                )}
                {tablesError && (
                  <div style={{ padding: 12, background: 'var(--state-danger-soft)', color: 'var(--state-danger)', borderRadius: 6, fontSize: 13, marginBottom: 8 }}>
                    {tablesError}
                  </div>
                )}
                {!tablesLoading && !tablesError && filteredTables.length === 0 && (
                  <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-disabled)' }}>
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
                    <span style={{ fontSize: 14, color: 'var(--text-primary)' }}>{table}</span>
                  </label>
                ))}
              </div>
              <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{selectedTables.length} table(s) selected</span>
                <button
                  className="btn-hover btn-hover-primary"
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
      {/* Broken references banner (visible on all steps when there are issues) */}
      {brokenRefs.length > 0 && (
        <div style={{
          margin: '12px 24px 0', padding: '10px 14px', borderRadius: 8,
          background: 'var(--state-warning-soft)', border: '1px solid #fde68a', color: 'var(--state-warning)',
          fontSize: 13, display: 'flex', alignItems: 'flex-start', gap: 10,
        }}>
          <span style={{ fontSize: 18, lineHeight: 1 }}>⚠️</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              {brokenRefs.length} broken reference{brokenRefs.length > 1 ? 's' : ''} detected
            </div>
            <div style={{ fontSize: 12, color: 'var(--state-warning)', lineHeight: 1.5 }}>
              Some tables or columns used by this model are no longer present in the datasource. Queries using them will fail. Review and fix them below.
            </div>
            <ul style={{ margin: '6px 0 0 18px', padding: 0, fontSize: 12, color: 'var(--state-warning)' }}>
              {brokenRefs.slice(0, 6).map((r, i) => (
                <li key={i}>
                  <strong>{r.kind}</strong>{' '}
                  {r.label ? `"${r.label}" ` : r.name ? `"${r.name}" ` : ''}
                  — {r.issue === 'missing_table' ? `table "${r.table}" not found` :
                     r.issue === 'missing_column' ? `column "${r.column}" missing in "${r.table}"` :
                     r.issue === 'no_table' ? 'has no table reference' : r.issue}
                </li>
              ))}
              {brokenRefs.length > 6 && <li>…and {brokenRefs.length - 6} more</li>}
            </ul>
          </div>
          <button className="btn-hover" onClick={runValidation} disabled={validating}
            style={{
              padding: '4px 10px', fontSize: 12, fontWeight: 500,
              background: 'var(--bg-panel)', color: 'var(--state-warning)', border: '1px solid #fcd34d',
              borderRadius: 6, cursor: validating ? 'wait' : 'pointer', whiteSpace: 'nowrap',
            }}>
            {validating ? 'Checking…' : 'Re-check'}
          </button>
        </div>
      )}

      {/* No fields flagged yet — visible warning so the user doesn't save an
          empty model and end up with widgets that have nothing to bind to. */}
      {selectedTables.length > 0 && dimensions.length === 0 && measures.length === 0 && (
        <div style={{
          margin: '12px 24px 0', padding: '10px 14px', borderRadius: 8,
          background: 'var(--state-warning-soft)', border: '1px solid #fde68a', color: 'var(--state-warning)',
          fontSize: 13, display: 'flex', alignItems: 'flex-start', gap: 10,
        }}>
          <span style={{ fontSize: 18, lineHeight: 1 }}>⚠️</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              No columns flagged for this model
            </div>
            <div style={{ fontSize: 12, lineHeight: 1.5 }}>
              You haven't added any dimension, measure or date column yet. Click the <strong>D</strong> (dimension) or <strong>M</strong> (measure) tag next to a column in the schema to flag it. Without flagged columns, reports built on this model won't have anything to display.
            </div>
          </div>
        </div>
      )}

      {step === 1 && (
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          <div style={{
            position: 'absolute', top: 12, left: 12, zIndex: 10,
            background: 'var(--bg-panel)', borderRadius: 6, padding: '6px 12px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)', fontSize: 12, color: 'var(--text-muted)',
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
            modelId={id}
            datasourceId={model?.datasource_id}
            isNumeric={isNumeric}
            isDateType={isDateType}
            columnTypes={columnTypes}
            onColumnTypeChange={setColumnType}
            onValidateColumnType={validateColumnType}
            validatingColumn={validatingColumn}
            validationResults={validationResults}
            rlsTable={rls?.enabled ? rls?.table : null}
            onOpenRLS={(tableName) => setRlsDialogTable(tableName)}
            onRemoveTable={(tableName) => {
              setSelectedTables((prev) => prev.filter((t) => t !== tableName));
              setTablePositions((prev) => {
                const next = { ...prev };
                delete next[tableName];
                return next;
              });
              setJoins((prev) => prev.filter((j) => j.from_table !== tableName && j.to_table !== tableName));
              setDimensions((prev) => prev.filter((d) => d.table !== tableName));
              setMeasures((prev) => prev.filter((m) => m.table !== tableName));
              if (rls?.table === tableName) setRls({});
            }}
          />
          {rlsDialogTable && (
            <RLSDialog
              modelId={id}
              tableName={rlsDialogTable}
              tableColumns={tableColumns[rlsDialogTable] || []}
              rls={rls}
              onChange={setRls}
              onClose={() => setRlsDialogTable(null)}
            />
          )}
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
                style={{ width: '100%', border: 'none', outline: 'none', fontSize: 14, color: 'var(--text-secondary)' }}
              />
            </div>

            {/* Dimensions */}
            <div style={cardStyle}>
              <h3 style={cardTitle}>Dimensions ({dimensions.length})</h3>
              {dimensions.length === 0 ? (
                <p style={{ color: 'var(--text-disabled)', fontSize: 13 }}>
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
                        <td style={tdStyle}>{broken && <span style={{ marginRight: 4 }}>⚠️</span>}{d.table}</td>
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
                            return (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h3 style={{ ...cardTitle, marginBottom: 0 }}>Measures ({measures.length})</h3>
                <button className="btn-hover btn-hover-accent" onClick={() => setShowCalcMeasure(true)} style={addCalcBtn}>+ Measure</button>
              </div>

              {showCalcMeasure && (
                <div style={{ padding: 12, background: 'var(--bg-subtle)', borderRadius: 6, marginBottom: 12, border: '1px solid var(--border-default)' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>New calculated measure</div>
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
                    <button className="btn-hover" onClick={() => { setShowCalcMeasure(false); setCalcMeasure({ label: '', expression: '' }); }} style={calcCancelBtn}>Cancel</button>
                    <button className="btn-hover btn-hover-primary" onClick={addCalculatedMeasure} disabled={!calcMeasure.label || !calcMeasure.expression} style={calcSaveBtn}>Add</button>
                  </div>
                </div>
              )}

              {measures.length === 0 && !showCalcMeasure ? (
                <p style={{ color: 'var(--text-disabled)', fontSize: 13 }}>
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
                        <td style={tdStyle}>{broken && <span style={{ marginRight: 4 }}>⚠️</span>}{m.aggregation === 'custom' ? <span style={{ color: 'var(--accent-primary)', fontSize: 11 }}>SQL</span> : m.table}</td>
                        <td style={tdStyle} title={m.expression || ''}>
                          {m.aggregation === 'custom' ? (
                            <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)' }}>
                              {m.expression?.length > 30 ? m.expression.substring(0, 30) + '...' : m.expression}
                            </span>
                          ) : m.column}
                        </td>
                        <td style={tdStyle}>
                          {m.aggregation === 'custom' ? (
                            <span style={{ fontSize: 11, color: 'var(--accent-primary)', fontWeight: 600 }}>custom</span>
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
                <p style={{ color: 'var(--text-disabled)', fontSize: 13 }}>No joins. Go to "Schema & Joins" to drag between column dots.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {joins.map((j, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--bg-subtle)', borderRadius: 6, fontSize: 13 }}>
                      <span style={{ fontWeight: 600 }}>{j.from_table}</span>
                      <span style={{ color: 'var(--text-muted)' }}>.{j.from_column}</span>
                      <span style={{ ...badge, background: 'var(--bg-active)', color: 'var(--accent-primary)' }}>{j.type}</span>
                      <span style={{ fontWeight: 600 }}>{j.to_table}</span>
                      <span style={{ color: 'var(--text-muted)' }}>.{j.to_column}</span>
                      <button className="btn-hover btn-hover-danger" onClick={() => setJoins((prev) => prev.filter((_, idx) => idx !== i))} style={{ ...removeBtn, marginLeft: 'auto' }}>x</button>
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
          backgroundColor: saveMsg === 'Saved' ? 'var(--state-success)' : 'var(--state-danger)', color: '#fff',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        }}>{saveMsg === 'Saved' ? '✓ Model saved' : '✗ Save failed'}</div>
      )}
    </div>
  );
}

// Compact green/red pill that summarises the result of a column-type
// validation run. Tooltip shows sample size + a few invalid examples so
// the user knows where the type mismatches are.
function ValidationBadge({ result }) {
  if (result.error) {
    return (
      <span title={result.error} style={{ ...badge, background: 'var(--state-danger-soft)', color: 'var(--state-danger)' }}>
        error
      </span>
    );
  }
  const ratio = result.validRatio ?? 0;
  const pct = Math.round(ratio * 100);
  const ok = ratio >= 0.95;
  const tooltip = [
    `${result.validCount}/${result.sampleSize} rows match "${result.type}"`,
    result.invalidExamples?.length
      ? `Invalid examples: ${result.invalidExamples.map((v) => v == null ? 'NULL' : `"${v}"`).join(', ')}`
      : null,
    result.note || null,
  ].filter(Boolean).join('\n');
  return (
    <span
      title={tooltip}
      style={{
        ...badge,
        background: ok ? 'var(--state-success-soft, #dcfce7)' : 'var(--state-warning-soft, #fef3c7)',
        color: ok ? 'var(--state-success, #16a34a)' : 'var(--state-warning, #92400e)',
        cursor: 'help',
      }}
    >
      {ok ? '✓' : '!'} {pct}%
    </span>
  );
}

const primaryBtn = {
  padding: '8px 16px', fontSize: 14, fontWeight: 600, border: 'none',
  borderRadius: 6, background: 'var(--accent-primary)', color: '#fff', cursor: 'pointer',
};
const cardStyle = { backgroundColor: 'var(--bg-panel)', padding: 20, borderRadius: 8, border: '1px solid var(--border-default)' };
const cardTitle = { fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 };
const searchInput = {
  width: '100%', padding: '8px 10px', border: '1px solid var(--border-default)',
  borderRadius: 6, fontSize: 14, outline: 'none', marginBottom: 12, boxSizing: 'border-box',
};
const tableCheckRow = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 8px',
  borderBottom: '1px solid #f1f5f9', cursor: 'pointer',
};
const tableStyleCSS = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
const thStyle = { textAlign: 'left', padding: '8px 10px', borderBottom: '2px solid #e2e8f0', color: 'var(--text-muted)', fontWeight: 600, fontSize: 12 };
const tdStyle = { padding: '6px 10px', borderBottom: '1px solid #f1f5f9', color: 'var(--text-secondary)' };
const inlineInput = {
  padding: '4px 6px', border: '1px solid var(--border-default)', borderRadius: 4,
  fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box',
};
// Encoded chevron used as a CSS background-image so the select looks like a
// real interactive dropdown instead of a flat read-only field.
const chevronSvg = (color) => `no-repeat right 6px center / 10px url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><path fill='none' stroke='${encodeURIComponent(color)}' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' d='M4 6l4 4 4-4'/></svg>")`;
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
