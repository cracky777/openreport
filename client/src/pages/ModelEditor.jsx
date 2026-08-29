import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useNavigationType } from 'react-router-dom';
import Step1Schema from './Step1Schema';
import api from '../utils/api';
import { toast } from '../components/Toast/toast';
import { headerShellStyle, BackButton, PrimaryButton, SecondaryButton, headerBadgeStyle } from '../components/PageHeader/PageHeader';
import { useTheme } from '../hooks/useTheme';
import ValidationBadge from '../components/ValidationBadge';
import ConfirmDialog from '../components/ConfirmDialog/ConfirmDialog';
import Step2DimensionsMeasures from './Step2DimensionsMeasures';
import Step0Tables from './Step0Tables';
import {
  isNumeric, isDateType, getColumnType, readOverride, writeOverride,
} from '../utils/modelEditorHelpers';

const _hs0 = { padding: 40, color: 'var(--text-disabled)' };
const _hs1 = { height: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-app)' };
const _hs2 = {
            fontSize: 16, fontWeight: 600, border: '1px solid transparent', outline: 'none',
            background: 'transparent', color: 'var(--text-primary)', minWidth: 180, maxWidth: 320,
            padding: '4px 8px', borderRadius: 6,
            transition: 'background 0.12s, border-color 0.12s',
          };
const _hs3 = { fontSize: 9, color: 'var(--accent-primary)', marginLeft: 2 };
const _hs4 = { flex: 1 };
const _hs5 = {
          display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 2,
          padding: '3px 4px', background: 'var(--bg-subtle)',
          border: '1px solid var(--border-default)', borderRadius: 10, marginRight: 8,
        };
const _hs6 = { marginRight: 8 };
const _hs7 = { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.35)', zIndex: 100 };
const _hs8 = {
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            background: 'var(--bg-panel)', borderRadius: 10, padding: 20, minWidth: 400, maxWidth: 480,
            boxShadow: '0 10px 30px rgba(15,23,42,0.25)', zIndex: 101,
          };
const _hs9 = { fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 };
const _hs10 = { fontSize: 12, color: 'var(--text-muted)', marginBottom: 14, lineHeight: 1.5 };
const _hs11 = { display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 280, overflowY: 'auto', border: '1px solid var(--border-default)', borderRadius: 6, padding: 4 };
const _hs12 = { fontSize: 13, fontWeight: 500 };
const _hs13 = { fontSize: 10, color: 'var(--accent-primary)', marginLeft: 6 };
const _hs14 = { fontSize: 11, color: 'var(--text-muted)' };
const _hs15 = { padding: 16, fontSize: 12, color: 'var(--text-disabled)', textAlign: 'center' };
const _hs16 = { display: 'flex', justifyContent: 'flex-end', marginTop: 14 };
const _hs17 = { padding: '6px 14px', fontSize: 13, background: 'var(--bg-subtle)', border: '1px solid var(--border-default)', borderRadius: 8, color: 'var(--text-secondary)', cursor: 'pointer' };
const _hs30 = {
          margin: '12px 24px 0', padding: '10px 14px', borderRadius: 8,
          background: 'var(--state-warning-soft)', border: '1px solid #fde68a', color: 'var(--state-warning)',
          fontSize: 13, display: 'flex', alignItems: 'flex-start', gap: 10,
        };
const _hs31 = { fontSize: 18, lineHeight: 1 };
const _hs32 = { flex: 1 };
const _hs33 = { fontWeight: 600, marginBottom: 4 };
const _hs34 = { fontSize: 12, color: 'var(--state-warning)', lineHeight: 1.5 };
const _hs35 = { margin: '6px 0 0 18px', padding: 0, fontSize: 12, color: 'var(--state-warning)' };
const _hs36 = {
          margin: '12px 24px 0', padding: '10px 14px', borderRadius: 8,
          background: 'var(--state-warning-soft)', border: '1px solid #fde68a', color: 'var(--state-warning)',
          fontSize: 13, display: 'flex', alignItems: 'flex-start', gap: 10,
        };
const _hs37 = { fontSize: 18, lineHeight: 1 };
const _hs38 = { flex: 1 };
const _hs39 = { fontWeight: 600, marginBottom: 4 };
const _hs40 = { fontSize: 12, lineHeight: 1.5 };


const STEPS = ['Tables', 'Schema & Joins', 'Dimensions & Measures'];

export default function ModelEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { resolved: themeResolved, themes: availableThemes } = useTheme();

  // Back means back. This editor is reached from a report card, from a model
  // card, and from the report editor, and it used to answer "the model list"
  // to all three — so leaving a report dropped you a stage away from it.
  //
  // Nothing behind us means a first entry: a pasted URL, or the new tab the
  // report editor opens. Then we honour the ?from= the opener left, and fall
  // back to the list. The `idx` check is what keeps a plain reload — which
  // turns any arrival into a POP — from forgetting where the user came from.
  const arrivedBy = useNavigationType();
  const goBack = () => {
    if (arrivedBy !== 'POP' || window.history.state?.idx > 0) { navigate(-1); return; }
    // In-app paths only — `from` comes off the URL, so anyone can write it.
    const from = new URLSearchParams(window.location.search).get('from') || '';
    navigate(from.startsWith('/') && !from.startsWith('//') ? from : '/models');
  };

  const [step, setStep] = useState(0);
  const [pendingDsChange, setPendingDsChange] = useState(null); // datasource id awaiting confirmation
  const [saveWarnings, setSaveWarnings] = useState(null);       // advisory lines shown before saving
  const [allTables, setAllTables] = useState([]);
  const [selectedTables, setSelectedTables] = useState([]);
  const [tableColumns, setTableColumns] = useState({});
  const [tablePositions, setTablePositions] = useState({});
  // Incremental rollup refresh: the model's date column ("table.column") and
  // the window in months (null = full rebuilds). Saved with the model.
  const [dateColumn, setDateColumn] = useState('');
  const [incrementalMonths, setIncrementalMonths] = useState(null);
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
      toast(err?.response?.data?.error || 'Failed to load datasources');
    }
  };

  // Asking is one step, doing is another: the dialog needs a render between
  // them, so the id waits in state instead of on the stack.
  const applyDsChange = (newDsId) => {
    if (!newDsId || newDsId === model?.datasource_id) { setShowDsChange(false); return; }
    setPendingDsChange(newDsId);
  };

  const doDsChange = async (newDsId) => {
    setPendingDsChange(null);
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
      setDateColumn(m.dateColumn || m.date_column || '');
      setIncrementalMonths(m.incremental_months ?? null);
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
        } catch {
          // Table missing in new datasource — drop its columns (validation will flag it)
          setTableColumns((prev) => { const n = { ...prev }; delete n[t]; return n; });
        }
      }
      runValidation();
      setShowDsChange(false);
    } catch (err) {
      toast(err?.response?.data?.error || 'Failed to change datasource');
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
        setDateColumn(m.dateColumn || m.date_column || '');
        setIncrementalMonths(m.incremental_months ?? null);

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
    // Assign default positions for tables without one, skipping any grid
    // cell already covered by an existing card — on a saved model the tables
    // keep their (possibly dragged) positions, and a naive cursor restarting
    // at (40,40) dropped every newly added table on top of the first one.
    setTablePositions((prev) => {
      const next = { ...prev };
      const taken = Object.values(next).filter((p) => p && typeof p.x === 'number');
      // A cell is free when no card sits within roughly one card footprint.
      const isFree = (x, y) => taken.every((p) => Math.abs(p.x - x) >= 240 || Math.abs(p.y - y) >= 280);
      let col = 0;
      let row = 0;
      const advance = () => { col += 1; if (col > 2) { col = 0; row += 1; } };
      selectedTables.forEach((t) => {
        if (next[t]) return;
        let cell = { x: 40 + col * 260, y: 40 + row * 300 };
        let guard = 0;
        while (!isFree(cell.x, cell.y) && guard < 200) {
          advance();
          cell = { x: 40 + col * 260, y: 40 + row * 300 };
          guard += 1;
        }
        next[t] = cell;
        taken.push(cell);
        advance();
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

  // Both guards are advisory — the user may legitimately know better than a
  // 100k-row sample. They used to be two blocking prompts in a row, so a model
  // that tripped both asked the same question twice. Gathered into one list,
  // asked once.
  const handleSave = () => {
    const warnings = [];
    // Reports built on a model with nothing flagged can't bind anything.
    if (selectedTables.length > 0 && dimensions.length === 0 && measures.length === 0) {
      warnings.push('• No dimensions, measures or date columns are flagged — reports built on this model will have nothing to display.');
    }
    // A column whose CURRENT type still fits the sampled data poorly. Skips
    // stale results (a type the user changed away from after testing) via r.type.
    const TYPE_MATCH_THRESHOLD = 0.95;
    for (const { d, r } of dimensions.map((d) => ({ d, r: validationResults[`${d.table}.${d.column}`] }))) {
      if (r && !r.error && r.type === d.type
        && typeof r.validRatio === 'number' && r.validRatio < TYPE_MATCH_THRESHOLD) {
        warnings.push(`• ${d.label || d.column}: "${d.type}" fits only ${Math.round(r.validRatio * 100)}% of sampled rows — reports may format or sort it unexpectedly.`);
      }
    }
    if (warnings.length > 0) { setSaveWarnings(warnings); return; }
    performSave();
  };

  const performSave = async () => {
    setSaveWarnings(null);
    setSaving(true);
    try {
      // Persist a lightweight type-mismatch flag on dimensions so the report
      // editor can flag poorly-typed fields without re-validating on every
      // open. Derived from the current validation cache (same 95% rule);
      // stamped when the CURRENT type validates poorly, cleared otherwise.
      const dimensionsToSave = dimensions.map((d) => {
        const r = validationResults[`${d.table}.${d.column}`];
        const mismatch = r && !r.error && r.type === d.type
          && typeof r.validRatio === 'number' && r.validRatio < 0.95;
        if (mismatch) return { ...d, typeWarning: { ratio: r.validRatio, type: d.type } };
        if (d.typeWarning) { const { typeWarning: _tw, ...rest } = d; return rest; }
        return d;
      });
      await api.put(`/models/${id}`, {
        name, description, selected_tables: selectedTables,
        table_positions: tablePositions, dimensions: dimensionsToSave, measures, joins, rls,
        column_types: columnTypes,
        dateColumn,
        incrementalMonths,
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
      // Surface the server's reason (e.g. a duplicate-name 409) rather than a
      // bare "Save failed" — the toast renders whatever text we set here.
      setSaveMsg(err?.response?.data?.error || 'Save failed');
      setTimeout(() => setSaveMsg(null), 4000);
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
        // The title comes from the model, not the user: a second report on the
        // same model becomes "… — Report (2)" instead of failing on a name
        // nobody typed.
        autoTitle: true,
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
      toast(err?.response?.data?.error || 'Failed to create report');
      setCreatingReport(false);
    }
  };

  if (loading) return <div style={_hs0}>Loading model...</div>;

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
    <div style={_hs1}>
      {pendingDsChange && (
        <ConfirmDialog
          title="Change the datasource for this model?"
          body="Existing dimensions, measures and joins are preserved. References to tables or columns that no longer exist will be flagged so you can fix them."
          confirmLabel="Change datasource"
          onConfirm={() => doDsChange(pendingDsChange)}
          onCancel={() => setPendingDsChange(null)}
        />
      )}
      {saveWarnings && (
        <ConfirmDialog
          title="Save this model anyway?"
          body={saveWarnings.join('\n')}
          confirmLabel="Save anyway"
          onConfirm={performSave}
          onCancel={() => setSaveWarnings(null)}
        />
      )}
      {/* Header */}
      <header style={headerShellStyle}>
        <BackButton onClick={goBack} />
        <input
          type="text" value={name} onChange={(e) => setName(e.target.value)}
          style={_hs2}
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
            <span style={_hs3}>▼</span>
          </button>
        )}
        <div style={_hs4} />
        {/* Steps */}
        <div style={_hs5}>
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
          style={_hs6}
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
            style={_hs7} />
          <div style={_hs8}>
            <div style={_hs9}>Change datasource</div>
            <div style={_hs10}>
              The model's tables, dimensions, measures and joins will be preserved. Any references to tables/columns that don't exist in the new datasource will be flagged on the model editor and on the widgets that use them.
            </div>
            <div style={_hs11}>
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
                    <span style={_hs12}>
                      {ds.name} {isCurrent && <span style={_hs13}>current</span>}
                    </span>
                    <span style={_hs14}>
                      {ds.db_type?.toUpperCase()} — {ds.host ? `${ds.host}:${ds.port}/${ds.db_name}` : ds.db_name}
                    </span>
                  </button>
                );
              })}
              {allDatasources.length === 0 && (
                <div style={_hs15}>No datasources available</div>
              )}
            </div>
            <div style={_hs16}>
              <button className="btn-hover" onClick={() => setShowDsChange(false)}
                style={_hs17}>
                Cancel
              </button>
            </div>
          </div>
        </>
      )}

      {/* Step 0: Table selection */}
      {step === 0 && (
        <Step0Tables
          tableSearch={tableSearch} setTableSearch={setTableSearch}
          tablesLoading={tablesLoading} tablesError={tablesError}
          filteredTables={filteredTables} selectedTables={selectedTables}
          toggleTable={toggleTable} enterStep1={enterStep1}
        />
      )}

      {/* Step 1: Visual schema */}
      {/* Broken references banner (visible on all steps when there are issues) */}
      {brokenRefs.length > 0 && (
        <div style={_hs30}>
          <span style={_hs31}>⚠️</span>
          <div style={_hs32}>
            <div style={_hs33}>
              {brokenRefs.length} broken reference{brokenRefs.length > 1 ? 's' : ''} detected
            </div>
            <div style={_hs34}>
              Some tables or columns used by this model are no longer present in the datasource. Queries using them will fail. Review and fix them below.
            </div>
            <ul style={_hs35}>
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
        <div style={_hs36}>
          <span style={_hs37}>⚠️</span>
          <div style={_hs38}>
            <div style={_hs39}>
              No columns flagged for this model
            </div>
            <div style={_hs40}>
              You haven't added any dimension, measure or date column yet. Click the <strong>D</strong> (dimension) or <strong>M</strong> (measure) tag next to a column in the schema to flag it. Without flagged columns, reports built on this model won't have anything to display.
            </div>
          </div>
        </div>
      )}

      {step === 1 && (
        <Step1Schema
          schemaTablesData={schemaTablesData}
          tablePositions={tablePositions} setTablePositions={setTablePositions}
          joins={joins} setJoins={setJoins}
          dimensions={dimensions} setDimensions={setDimensions}
          measures={measures} setMeasures={setMeasures}
          addDimension={addDimension} addMeasure={addMeasure}
          modelId={id} datasourceId={model?.datasource_id}
          isNumeric={isNumeric} isDateType={isDateType}
          columnTypes={columnTypes} setColumnType={setColumnType}
          validateColumnType={validateColumnType} validatingColumn={validatingColumn} validationResults={validationResults}
          rls={rls} setRls={setRls}
          rlsDialogTable={rlsDialogTable} setRlsDialogTable={setRlsDialogTable}
          setSelectedTables={setSelectedTables} tableColumns={tableColumns}
        />
      )}

      {/* Step 2: Dimensions & Measures */}
      {step === 2 && (
        <Step2DimensionsMeasures
          description={description} setDescription={setDescription}
          dimensions={dimensions} setDimensions={setDimensions}
          measures={measures} setMeasures={setMeasures}
          joins={joins} setJoins={setJoins}
          columnTypes={columnTypes} validatingColumn={validatingColumn} validationResults={validationResults}
          showCalcMeasure={showCalcMeasure} setShowCalcMeasure={setShowCalcMeasure}
          calcMeasure={calcMeasure} setCalcMeasure={setCalcMeasure}
          brokenRefByKey={brokenRefByKey}
          setColumnType={setColumnType} validateColumnType={validateColumnType}
          removeDimension={removeDimension} addCalculatedMeasure={addCalculatedMeasure} removeMeasure={removeMeasure}
        />
      )}
      {step === 2 && (
        <IncrementalRefreshCard
          dimensions={dimensions}
          columnTypes={columnTypes}
          dateColumn={dateColumn}
          setDateColumn={setDateColumn}
          incrementalMonths={incrementalMonths}
          setIncrementalMonths={setIncrementalMonths}
        />
      )}
      {saveMsg && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          padding: '8px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600, zIndex: 9999,
          maxWidth: 420, textAlign: 'center', lineHeight: 1.4,
          backgroundColor: saveMsg === 'Saved' ? 'var(--state-success)' : 'var(--state-danger)', color: '#fff',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        }}>{saveMsg === 'Saved' ? '✓ Model saved' : `✗ ${saveMsg}`}</div>
      )}
    </div>
  );
}


// Incremental rollup refresh — shown on the Dimensions & Measures step when
// the model carries at least one date-typed dimension. Picking a window makes
// every cache rebuild re-query only the last N months of the source (older
// partition rows are carried over from the previous build); rows older than
// the window then only change on a full rebuild (drop the cache or set Off).
function IncrementalRefreshCard({ dimensions, columnTypes, dateColumn, setDateColumn, incrementalMonths, setIncrementalMonths }) {
  const effectiveType = (d) => {
    const ov = columnTypes && columnTypes[`${d.table}.${d.column}`];
    const t = !ov ? d.type : (typeof ov === 'string' ? ov : ov.type);
    return t;
  };
  const dateDims = (dimensions || []).filter((d) => effectiveType(d) === 'date');
  if (dateDims.length === 0) return null;
  return (
    <div style={incrCardStyle}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Incremental cache refresh</div>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 12px', maxWidth: 640 }}>
        Rebuild only the last months of the cache instead of re-querying the whole source.
        Rows older than the window keep their cached values until a full rebuild
        (set to Off and refresh, or drop the cache).
      </p>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={incrLabelStyle}>Date column</label>
        <select
          value={dateColumn || ''}
          onChange={(e) => {
            setDateColumn(e.target.value);
            // No date column → no window (the engine needs both).
            if (!e.target.value) setIncrementalMonths(null);
          }}
          style={incrSelectStyle}
        >
          <option value="">— none —</option>
          {dateDims.map((d) => (
            <option key={`${d.table}.${d.column}`} value={`${d.table}.${d.column}`}>
              {d.table}.{d.column}
            </option>
          ))}
        </select>
        <label style={incrLabelStyle}>Window</label>
        <select
          value={incrementalMonths || 0}
          onChange={(e) => setIncrementalMonths(Number(e.target.value) || null)}
          disabled={!dateColumn}
          style={incrSelectStyle}
        >
          <option value={0}>Off — full rebuild</option>
          {[...new Set([1, 3, 6, 12, ...(incrementalMonths ? [incrementalMonths] : [])])].sort((a, b) => a - b).map((m) => (
            <option key={m} value={m}>Last {m} month{m === 1 ? '' : 's'}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

const incrCardStyle = {
  maxWidth: 1100, margin: '16px auto 0', padding: '16px 20px',
  background: 'var(--bg-panel)', border: '1px solid var(--border-default)', borderRadius: 8,
};
const incrLabelStyle = { fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)' };
const incrSelectStyle = {
  padding: '6px 10px', fontSize: 13, borderRadius: 6,
  border: '1px solid var(--border-default)', background: 'var(--bg-panel)', color: 'var(--text-primary)',
};
