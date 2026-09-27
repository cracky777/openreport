import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../utils/api';
import { toast } from '../Toast/toast';
import Modal from '../Modal/Modal';
import DatasourceForm from '../DatasourceForm/DatasourceForm';
import { useGraph } from '../../hooks/graphContext';

// Power BI template (.pbit) import, in four steps: upload → pick or create
// the connection → review what the template maps to → apply. The server
// only analyses the file; the wizard then walks the existing create
// endpoints (datasource, model import, report import) so every rule those
// enforce applies here too.

const STEPS = ['upload', 'datasource', 'review', 'done'];

const SAME_FAMILY = {
  postgres: ['postgres', 'azure_postgres', 'redshift'],
  azure_postgres: ['postgres', 'azure_postgres'],
  mssql: ['mssql', 'azure_sql'],
  azure_sql: ['mssql', 'azure_sql'],
};

const CODE_LABELS = {
  fabric_auth: 'Connection',
  secondary_source: 'Connection',
  unsupported_connector: 'Connection',
  multiple_hosts: 'Connection',
  transformed_table: 'Tables',
  derived_table: 'Tables',
  union_table: 'Tables',
  native_query: 'Tables',
  file_source: 'Tables',
  calculated_table: 'Tables',
  unknown_table: 'Tables',
  calculated_column: 'Columns',
  derived_column: 'Columns',
  join_column_missing: 'Joins',
  duplicate_join: 'Joins',
  many_to_many: 'Joins',
  inactive_relationship: 'Joins',
  unsupported_visual: 'Visuals',
  custom_visual: 'Visuals',
  empty_binding: 'Visuals',
  missing_field: 'Visuals',
  missing_measure: 'Visuals',
  hierarchy: 'Visuals',
  filter_skipped: 'Filters',
  relative_date_filter: 'Filters',
  slicer_default: 'Filters',
  hidden_page: 'Pages',
};
const groupOf = (w) => (w.scope === 'measure' || String(w.code).startsWith('dax_') || w.code === 'measure_note' ? 'Measures' : (CODE_LABELS[w.code] || 'Other'));

function base64ToBlob(base64, mime) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

// `workspaceId`: where the report lands (the workspace open on the Reports
// page); `onImported` lets that page refresh its list once the report exists.
export default function PbitImportWizard({ onClose, workspaceId, onImported }) {
  const navigate = useNavigate();
  const { datasources, refresh } = useGraph();
  const fileRef = useRef(null);
  const [step, setStep] = useState('upload');
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState(null);
  const [dsMode, setDsMode] = useState('existing'); // 'existing' | 'new'
  const [dsId, setDsId] = useState('');
  const [modelName, setModelName] = useState('');
  const [reportTitle, setReportTitle] = useState('');
  const [progress, setProgress] = useState('');
  const [result, setResult] = useState(null);
  const [openGroups, setOpenGroups] = useState({});

  const candidates = useMemo(() => {
    if (!plan?.datasource) return datasources;
    const { dbType, host, dbName } = plan.datasource;
    const family = SAME_FAMILY[dbType] || [dbType];
    const score = (ds) => (ds.host === host && ds.db_name === dbName ? 3 : ds.db_name === dbName ? 2 : family.includes(ds.db_type) ? 1 : 0);
    return [...datasources].sort((a, b) => score(b) - score(a));
  }, [datasources, plan]);

  const analyze = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await api.post('/import/pbit', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      const p = res.data.plan;
      setPlan(p);
      setModelName(p.model.name);
      setReportTitle(p.report.title);
      const best = p.datasource ? candidates.find((ds) => ds.db_name === p.datasource.dbName && ds.host === p.datasource.host) : null;
      if (best) { setDsMode('existing'); setDsId(best.id); } else if (datasources.length === 0) { setDsMode('new'); }
      setStep('datasource');
    } catch (err) {
      toast(err.response?.data?.error || 'Could not read this template');
    } finally {
      setBusy(false);
    }
  };

  const grouped = useMemo(() => {
    const g = {};
    for (const w of plan?.warnings || []) {
      const k = groupOf(w);
      (g[k] = g[k] || []).push(w);
    }
    return Object.entries(g).sort((a, b) => b[1].length - a[1].length);
  }, [plan]);

  const apply = async () => {
    if (!plan || !dsId) return;
    setBusy(true);
    setStep('done');
    const outcome = { modelId: null, reportId: null, issues: [], failedImages: [] };
    try {
      setProgress('Creating the model…');
      const yaml = plan.model.yaml.replace(/^name: .*$/m, `name: ${JSON.stringify(modelName || plan.model.name)}`);
      const mRes = await api.post('/models/import', { yaml, datasourceId: dsId, ...(workspaceId ? { workspaceId } : {}) });
      outcome.modelId = mRes.data.model.id;

      // Images travel inside the template; the report references them by
      // resource name until each one is uploaded and swapped for its URL.
      const bundle = JSON.parse(JSON.stringify(plan.report.bundle));
      const urls = {};
      const names = Object.keys(plan.resources || {});
      for (let i = 0; i < names.length; i++) {
        const name = names[i];
        setProgress(`Uploading image ${i + 1} of ${names.length}…`);
        try {
          const r = plan.resources[name];
          const form = new FormData();
          form.append('image', base64ToBlob(r.base64, r.mime), name);
          const up = await api.post('/images', form, { headers: { 'Content-Type': 'multipart/form-data' } });
          urls[name] = up.data.url;
        } catch {
          // A single bad image should not sink the report — its widget stays empty.
          outcome.failedImages.push(name);
        }
      }
      for (const page of bundle.report.pages || []) {
        for (const w of Object.values(page.widgets || {})) {
          if (w.config?.pbitResource) {
            w.config.url = urls[w.config.pbitResource] || '';
            delete w.config.pbitResource;
          }
        }
      }
      bundle.report.widgets = bundle.report.pages?.[0]?.widgets || {};
      bundle.report.title = reportTitle || plan.report.title;

      setProgress('Creating the report…');
      const rRes = await api.post('/reports/import', { bundle, modelId: outcome.modelId, workspaceId: workspaceId || undefined });
      outcome.reportId = rRes.data.report.id;
      // /import suffixes the title; put the chosen one back.
      await api.put(`/reports/${outcome.reportId}`, { title: reportTitle || plan.report.title });
      onImported?.();

      setProgress('Checking the model against the database…');
      try {
        // An unreachable database must not hold the wizard for minutes.
        const v = await api.get(`/models/${outcome.modelId}/validate`, { timeout: 20000 });
        outcome.issues = v.data.issues || [];
        outcome.validated = true;
      } catch (err) {
        outcome.validated = false;
        outcome.validationError = err.code === 'ECONNABORTED' ? 'no answer from the database within 20 s' : (err.response?.data?.error || 'connection failed');
      }
      refresh();
    } catch (err) {
      toast(err.response?.data?.error || 'Import failed');
      if (!outcome.modelId) { setStep('review'); setBusy(false); return; }
    }
    setResult(outcome);
    setBusy(false);
    setProgress('');
  };

  const stepIndex = STEPS.indexOf(step);

  return (
    <Modal onClose={busy ? () => {} : onClose} width={720}>
      <h2 style={titleStyle}>Import a Power BI template</h2>
      <div style={stepsRow}>
        {['Template', 'Connection', 'Review', 'Import'].map((label, i) => (
          <span key={label} style={{ ...stepChip, ...(i === stepIndex ? stepChipActive : {}), ...(i < stepIndex ? stepChipDone : {}) }}>{i + 1}. {label}</span>
        ))}
      </div>

      {step === 'upload' && (
        <div>
          <p style={helpText}>
            Pick a <strong>.pbit</strong> file (Power BI Desktop → Save as → Template). It carries the model and the
            report but no data and no password: you choose the connection in the next step.
          </p>
          <input ref={fileRef} type="file" accept=".pbit" style={{ display: 'none' }} onChange={(e) => analyze(e.target.files?.[0])} />
          <div style={dropZone} onClick={() => fileRef.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); analyze(e.dataTransfer.files?.[0]); }}>
            {busy ? 'Reading the template…' : 'Click or drop a .pbit file here'}
          </div>
          <div style={footer}><button className="btn-hover" style={secondaryBtn} onClick={onClose}>Cancel</button></div>
        </div>
      )}

      {step === 'datasource' && plan && (
        <div>
          {plan.datasource ? (
            <p style={helpText}>
              The template reads <strong>{plan.datasource.kind}</strong> on <code>{plan.datasource.host || '—'}</code>
              {plan.datasource.port ? `:${plan.datasource.port}` : ''}, database <code>{plan.datasource.dbName || '—'}</code>
              {' '}({plan.datasource.tableCount} table{plan.datasource.tableCount > 1 ? 's' : ''}).
            </p>
          ) : (
            <p style={helpText}>No database connection was found in the template; pick the datasource the model should read from.</p>
          )}
          <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
            <label style={radioLabel}><input type="radio" checked={dsMode === 'existing'} onChange={() => setDsMode('existing')} disabled={datasources.length === 0} /> Use an existing connection</label>
            <label style={radioLabel}><input type="radio" checked={dsMode === 'new'} onChange={() => setDsMode('new')} /> Create the connection</label>
          </div>
          {dsMode === 'existing' && (
            <>
              <select value={dsId} onChange={(e) => setDsId(e.target.value)} style={{ ...inputStyle, marginBottom: 14 }}>
                <option value="">— choose —</option>
                {candidates.map((ds) => (
                  <option key={ds.id} value={ds.id}>{ds.name} — {ds.db_type} {ds.host ? `${ds.host}/` : ''}{ds.db_name}</option>
                ))}
              </select>
              <div style={footer}>
                <button className="btn-hover" style={secondaryBtn} onClick={() => setStep('upload')}>Back</button>
                <button className="btn-hover btn-hover-primary" style={primaryBtn} disabled={!dsId} onClick={() => setStep('review')}>Next</button>
              </div>
            </>
          )}
          {dsMode === 'new' && (
            <DatasourceForm
              workspaceId={workspaceId}
              initialValues={{
                name: plan.model.name,
                dbType: plan.datasource?.dbType || 'postgres',
                host: plan.datasource?.host || 'localhost',
                port: plan.datasource?.port || 5432,
                dbName: plan.datasource?.dbName || '',
                dbUser: '',
                dbPassword: '',
                extraConfig: {},
              }}
              onSaved={({ datasource }) => { setDsId(datasource.id); setDsMode('existing'); setStep('review'); }}
              onCancel={() => setDsMode(datasources.length ? 'existing' : 'new')}
            />
          )}
        </div>
      )}

      {step === 'review' && plan && (
        <div>
          <div style={statsGrid}>
            <Stat label="Tables" value={plan.stats.tables} sub={`of ${plan.stats.pbiTables}`} />
            <Stat label="Joins" value={plan.stats.joins} />
            <Stat label="Measures translated" value={plan.stats.measuresTranslated} sub={`of ${plan.stats.pbiMeasures}`} />
            <Stat label="Measures kept as drafts" value={plan.stats.measuresDraft} />
            <Stat label="Pages" value={plan.stats.pages} />
            <Stat label="Visuals" value={plan.stats.visuals} sub={plan.stats.unsupported ? `${plan.stats.unsupported} unsupported` : ''} />
          </div>
          <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Model name</label>
              <input style={inputStyle} value={modelName} onChange={(e) => setModelName(e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Report title</label>
              <input style={inputStyle} value={reportTitle} onChange={(e) => setReportTitle(e.target.value)} />
            </div>
          </div>
          {(plan.report.customVisuals || []).length > 0 && (
            <div style={customVisualsAlert} role="alert">
              <strong>This template uses {plan.report.customVisuals.length === 1 ? 'a custom visual' : `${plan.report.customVisuals.length} custom visuals`} that will not be imported.</strong>
              <div style={{ marginTop: 4 }}>
                {plan.report.customVisuals.map((c) => (
                  <div key={c.type}>{c.name} — {c.uses} {c.uses > 1 ? 'uses' : 'use'}</div>
                ))}
              </div>
              <div style={{ marginTop: 4 }}>Custom visuals are third-party code OpenReport cannot run. A placeholder keeps each one's place on the page; rebuild them with a built-in visual or one from the workspace library.</div>
            </div>
          )}
          {(plan.model.draftMeasures || []).length > 0 && (
            <div style={customVisualsAlert} role="alert">
              <strong>{plan.model.draftMeasures.length === 1 ? 'One measure' : `${plan.model.draftMeasures.length} measures`} could not be translated and {plan.model.draftMeasures.length === 1 ? 'is' : 'are'} imported as empty drafts.</strong>
              <div style={{ marginTop: 4 }}>
                {plan.model.draftMeasures.map((d) => (
                  <div key={d.measureName} title={d.dax}>
                    <span style={{ fontWeight: 600 }}>{d.name}</span> — {d.reason}{d.uses ? ` — ${d.uses} ${d.uses > 1 ? 'visuals' : 'visual'}` : ''}
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 4 }}>The visuals bound to a draft stay in place but show nothing until the measure is rebuilt in the model editor (its Power BI formula is kept in the measure's description).</div>
            </div>
          )}
          {grouped.length > 0 && (
            <div style={warningsBox}>
              {grouped.map(([group, items]) => {
                const warnCount = items.filter((w) => w.level === 'warn').length;
                const open = !!openGroups[group];
                return (
                  <div key={group}>
                    <button type="button" style={groupHeader} onClick={() => setOpenGroups((g) => ({ ...g, [group]: !open }))}>
                      <span>{open ? '▾' : '▸'} {group}</span>
                      <span style={{ color: 'var(--text-disabled)' }}>{warnCount ? `${warnCount} to review` : ''}{warnCount && items.length - warnCount ? ' · ' : ''}{items.length - warnCount ? `${items.length - warnCount} notes` : ''}</span>
                    </button>
                    {open && (
                      <ul style={warnList}>
                        {items.map((w, i) => (
                          <li key={i} style={{ color: w.level === 'warn' ? 'var(--text-primary)' : 'var(--text-disabled)' }}>{w.message}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <div style={footer}>
            <button className="btn-hover" style={secondaryBtn} onClick={() => setStep('datasource')}>Back</button>
            <button className="btn-hover btn-hover-primary" style={primaryBtn} disabled={!modelName.trim() || !reportTitle.trim()} onClick={apply}>Import</button>
          </div>
        </div>
      )}

      {step === 'done' && (
        <div>
          {!result ? (
            <p style={helpText}>{progress || 'Importing…'}</p>
          ) : (
            <>
              <p style={helpText}>
                Model and report created.
                {result.validated === false && ` The model could not be checked against the database (${result.validationError}); open it and run the check once the connection works.`}
                {result.validated && result.issues.length === 0 && ' Every table and column was found in the database.'}
              </p>
              {result.validated && result.issues.length > 0 && (
                <div style={warningsBox}>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>{result.issues.length} reference{result.issues.length > 1 ? 's' : ''} not found in the database</div>
                  <ul style={warnList}>
                    {result.issues.slice(0, 40).map((it, i) => (
                      <li key={i}>{it.kind} {it.label || it.name}: {it.issue.replace('_', ' ')}{it.table ? ` (${it.table}${it.column ? '.' + it.column : ''})` : ''}</li>
                    ))}
                    {result.issues.length > 40 && <li>… and {result.issues.length - 40} more</li>}
                  </ul>
                </div>
              )}
              {result.failedImages.length > 0 && <p style={helpText}>{result.failedImages.length} image(s) could not be uploaded; their widgets are empty.</p>}
              <div style={footer}>
                <button className="btn-hover" style={secondaryBtn} onClick={() => { onClose(); navigate(`/models/${result.modelId}`); }}>Open the model</button>
                <button className="btn-hover btn-hover-primary" style={primaryBtn} onClick={() => { onClose(); navigate(`/edit/${result.reportId}`); }}>Open the report</button>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div style={statBox}>
      <div style={{ fontSize: 22, fontWeight: 600 }}>{value}</div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{label}{sub ? <span style={{ color: 'var(--text-disabled)' }}> · {sub}</span> : null}</div>
    </div>
  );
}

const titleStyle = { fontSize: 16, fontWeight: 600, marginBottom: 12 };
const stepsRow = { display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' };
const stepChip = { fontSize: 12, padding: '3px 10px', borderRadius: 12, background: 'var(--bg-panel)', color: 'var(--text-disabled)', border: '1px solid var(--border-default)' };
const stepChipActive = { color: '#fff', background: 'var(--accent-primary)', borderColor: 'var(--accent-primary)' };
const stepChipDone = { color: 'var(--text-secondary)' };
const helpText = { fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14, lineHeight: 1.5 };
const dropZone = { border: '2px dashed var(--border-default)', borderRadius: 8, padding: '36px 16px', textAlign: 'center', cursor: 'pointer', color: 'var(--text-secondary)', marginBottom: 14 };
const footer = { display: 'flex', justifyContent: 'flex-end', gap: 8 };
const radioLabel = { fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' };
const statsGrid = { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 14 };
const statBox = { padding: '10px 12px', borderRadius: 8, background: 'var(--bg-panel)', border: '1px solid var(--border-default)' };
const customVisualsAlert = {
  padding: '10px 12px', marginBottom: 12, borderRadius: 8, fontSize: 12, lineHeight: 1.5,
  background: 'var(--state-warning-soft)', border: '1px solid var(--state-warning)', color: 'var(--text-primary)',
};

const warningsBox = { border: '1px solid var(--border-default)', borderRadius: 8, padding: '6px 10px', marginBottom: 14, maxHeight: 260, overflowY: 'auto', fontSize: 13 };
const groupHeader = { width: '100%', display: 'flex', justifyContent: 'space-between', background: 'none', border: 'none', padding: '6px 0', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', textAlign: 'left' };
const warnList = { margin: '0 0 8px 0', paddingLeft: 18, lineHeight: 1.45 };
const primaryBtn = { padding: '8px 16px', fontSize: 14, fontWeight: 600, border: 'none', borderRadius: 6, background: 'var(--accent-primary)', color: '#fff', cursor: 'pointer' };
const secondaryBtn = { padding: '8px 16px', fontSize: 14, background: 'var(--bg-panel)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)', borderRadius: 6, cursor: 'pointer' };
const inputStyle = { width: '100%', padding: '8px 10px', border: '1px solid var(--border-default)', borderRadius: 6, fontSize: 14, outline: 'none', boxSizing: 'border-box' };
const labelStyle = { display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4, fontWeight: 500 };
