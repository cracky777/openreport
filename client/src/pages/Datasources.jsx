import { useState, useRef, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../utils/api';
import { toast } from '../components/Toast/toast';
import ImportOptions, { DEFAULT_IMPORT_OPTIONS, appendImportOptions, importKind } from '../components/ImportOptions/ImportOptions';
import { readSheetNames } from '../utils/readSheetNames';
import { TbUpload } from 'react-icons/tb';
import { PrimaryButton, SecondaryButton } from '../components/PageHeader/PageHeader';
import { DatasourcesHeader } from '../cloud';
import DatasourceForm, { createModelAndNavigate } from '../components/DatasourceForm/DatasourceForm';
import JoinOut from '../components/AppShell/JoinOut';
import { useGraph } from '../hooks/graphContext';
import { sortActiveFirst } from '../utils/sortActiveFirst';
import FilterCrumb from '../components/AppShell/FilterCrumb';
import ConfirmDeleteButton from '../components/ConfirmDeleteButton/ConfirmDeleteButton';

// Fills the stage slot AppShell gives it; the shell owns the viewport height.
const _hs0 = { flex: 1, overflow: 'auto', backgroundColor: 'var(--bg-app)' };
// Action bar sitting at the top of the panel — the stage switcher in the shell
// already says where we are, so this row carries actions only.
const _hs1 = { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginBottom: 20 };
// Pushes the crumb to the left edge, leaving the actions on the right.
const crumbSlot = { marginRight: 'auto' };
const _hs2 = { display: 'none' };
const _hs3 = { color: 'var(--accent-primary)', borderColor: '#ddd6fe', background: 'var(--accent-primary-soft)' };
const _hs4 = { padding: '32px 24px' };
const _hs5 = { fontSize: 16, fontWeight: 600, marginBottom: 16 };
const _hs6 = { color: 'var(--text-disabled)', textAlign: 'center', marginTop: 60 };
const _hs7 = { textAlign: 'center', marginTop: 80 };
const _hs8 = { fontSize: 16, color: 'var(--text-muted)', marginBottom: 12 };
const _hs9 = { display: 'flex', flexDirection: 'column', gap: 8 };
const _hs10 = { flex: 1 };
const _hs11 = { fontWeight: 600, color: 'var(--text-primary)', fontSize: 15 };
const _hs12 = { fontSize: 13, color: 'var(--text-muted)', marginTop: 2 };
const _hs13 = { display: 'flex', alignItems: 'center', gap: 6 };

const DB_TYPE_LABELS = {
  postgres: 'PostgreSQL',
  azure_postgres: 'Azure PostgreSQL',
  mysql: 'MySQL',
  azure_sql: 'Azure SQL Database',
  bigquery: 'Google BigQuery',
  duckdb: 'DuckDB',
};

export default function Datasources() {
  const navigate = useNavigate();
  // Rows come from the shell-level graph so this column is already populated
  // when the carousel slides it in.
  const { datasources, setDatasources, modelsByDatasource, modelsByDatasourceAll, modelSpreadByDatasource, activeDatasourceIds, loading, refresh } = useGraph();
  // Arrived by walking a model's join backwards: narrow to that datasource.
  const [searchParams, setSearchParams] = useSearchParams();
  const idFilter = searchParams.get('id');
  const idName = idFilter ? datasources.find((x) => x.id === idFilter)?.name : null;

  const orderedDatasources = useMemo(() => {
    const scoped = idFilter ? datasources.filter((d) => d.id === idFilter) : datasources;
    return sortActiveFirst(scoped, activeDatasourceIds);
  }, [datasources, activeDatasourceIds, idFilter]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [importOpts, setImportOpts] = useState(DEFAULT_IMPORT_OPTIONS);
  const [selectedFile, setSelectedFile] = useState(null);
  const [sheetNames, setSheetNames] = useState([]);
  const fileInputRef = useRef(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingValues, setEditingValues] = useState(null);
  const [saveMsg, setSaveMsg] = useState(null);

  // Mutations re-pull the whole graph: creating a datasource can also create
  // a model, and the counts on this column have to follow.
  const loadDatasources = refresh;

  const handleSaved = async ({ datasource, isNew }) => {
    setShowForm(false);
    setEditingId(null);
    setEditingValues(null);
    if (isNew) {
      // Brand-new connection — chain into the model editor on the table selection step.
      const ok = await createModelAndNavigate(navigate, datasource);
      if (ok) return;
    }
    loadDatasources();
    setSaveMsg('Saved');
    setTimeout(() => setSaveMsg(null), 2000);
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingId(null);
    setEditingValues(null);
  };

  const handleEdit = async (ds) => {
    try {
      const res = await api.get(`/datasources/${ds.id}`);
      const full = res.data.datasource;
      let extraConfig = {};
      if (ds.extra_config) {
        try { extraConfig = typeof ds.extra_config === 'string' ? JSON.parse(ds.extra_config) : ds.extra_config; } catch { extraConfig = {}; }
      }
      setEditingId(ds.id);
      setEditingValues({
        name: full.name || '',
        dbType: full.db_type || 'postgres',
        host: full.host || '',
        port: full.port || 5432,
        dbName: full.db_name || '',
        dbUser: full.db_user || '',
        dbPassword: '',
        extraConfig,
      });
      setShowForm(true);
    } catch (err) {
      toast(err.response?.data?.error || 'Could not load datasource');
    }
  };

  const handleDelete = async (id) => {
    try {
      await api.delete(`/datasources/${id}`);
      setDatasources((prev) => prev.filter((d) => d.id !== id));
    } catch (err) {
      toast(err.response?.data?.error || 'Delete failed');
    }
  };

  // Record the pick only — the import options appear next; the upload waits for
  // the Import button so those options can be set first.
  const handleFileSelected = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    setImportOpts(DEFAULT_IMPORT_OPTIONS);
    setSheetNames([]);
    setUploadProgress('');
    if (fileInputRef.current) fileInputRef.current.value = ''; // allow re-picking the same file
    if (importKind(file.name) === 'excel') {
      const names = await readSheetNames(file);
      setSheetNames(names);
      setImportOpts((o) => ({ ...o, sheets: names })); // default: import every sheet
    }
  };

  const handleFileUpload = async () => {
    const file = selectedFile;
    if (!file) return;
    setUploading(true);
    setUploadProgress(`Uploading ${file.name}...`);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('name', file.name.replace(/\.[^.]+$/, ''));
      appendImportOptions(formData, importOpts);
      const res = await api.post('/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setUploadProgress(`Imported ${res.data.datasource.rowCount?.toLocaleString() || '?'} rows from ${file.name}`);
      setSelectedFile(null);
      loadDatasources();
      setTimeout(() => setUploadProgress(''), 5000);
    } catch (err) {
      setUploadProgress(`Error: ${err.response?.data?.error || err.message}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div style={_hs0}>
      <main style={_hs4}>
        <div style={_hs1}>
          {idFilter && (
            <div style={crumbSlot}>
              <FilterCrumb label={idName || 'this data source'} verb="Showing" onClear={() => setSearchParams({})} />
            </div>
          )}
          <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls,.parquet,.json,.tsv"
            style={_hs2} onChange={handleFileSelected} />
          <SecondaryButton onClick={() => fileInputRef.current?.click()} disabled={uploading}
            style={_hs3}>
            <TbUpload size={16} />{uploading ? 'Uploading...' : 'Upload File'}
          </SecondaryButton>
          <PrimaryButton onClick={() => { setEditingId(null); setEditingValues(null); setShowForm(true); }}>+ New Connection</PrimaryButton>
        </div>
        {DatasourcesHeader && <DatasourcesHeader />}
        {uploadProgress && (
          <div style={{
            padding: '10px 16px', marginBottom: 16, borderRadius: 6, fontSize: 13,
            background: uploadProgress.startsWith('Error') ? 'var(--state-danger-soft)' : '#f0fdf4',
            color: uploadProgress.startsWith('Error') ? '#dc2626' : '#16a34a',
            border: `1px solid ${uploadProgress.startsWith('Error') ? '#fca5a5' : '#bbf7d0'}`,
          }}>
            {uploadProgress}
          </div>
        )}
        {selectedFile && (
          <div style={formCard}>
            <h2 style={_hs5}>Import file</h2>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>
              Selected: <strong style={{ color: 'var(--text-primary)' }}>{selectedFile.name}</strong>
            </div>
            <ImportOptions value={importOpts} onChange={setImportOpts} kind={importKind(selectedFile.name)} sheetNames={sheetNames} />
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <PrimaryButton onClick={handleFileUpload} disabled={uploading || (importKind(selectedFile.name) === 'excel' && sheetNames.length > 0 && !(importOpts.sheets && importOpts.sheets.length))}>
                {uploading ? 'Importing...' : 'Import'}
              </PrimaryButton>
              <SecondaryButton onClick={() => setSelectedFile(null)} disabled={uploading}>Cancel</SecondaryButton>
            </div>
          </div>
        )}
        {showForm && (
          <div style={formCard}>
            <h2 style={_hs5}>{editingId ? 'Edit Data Source' : 'New Data Source'}</h2>
            <DatasourceForm
              editingId={editingId}
              initialValues={editingValues}
              onSaved={handleSaved}
              onCancel={handleCancel}
            />
          </div>
        )}

        {loading ? (
          <div style={_hs6}>Loading...</div>
        ) : orderedDatasources.length === 0 && !showForm ? (
          // A filter that matches nothing must say so, otherwise the column just
          // looks broken — and the way out has to be one click away.
          idFilter ? (
            <div style={_hs7}>
              <p style={_hs8}>Nothing here for this filter</p>
              <button className="btn-hover btn-hover-primary" onClick={() => setSearchParams({})} style={primaryBtn}>Show every data source</button>
            </div>
          ) : (
            <div style={_hs7}>
              <p style={_hs8}>No data sources configured</p>
              <button className="btn-hover btn-hover-primary" onClick={() => setShowForm(true)} style={primaryBtn}>Add your first data source</button>
            </div>
          )
        ) : (
          <div style={_hs9}>
            {orderedDatasources.map((ds) => {
              const extra = ds.extra_config ? (typeof ds.extra_config === 'string' ? JSON.parse(ds.extra_config) : ds.extra_config) : {};
              const isUploadedFile = !!extra.sourceFile;
              // Guard on the unscoped count: the server refuses while any model uses it.
              const modelCount = modelsByDatasourceAll.get(ds.id) || 0;
              return (
                <div key={ds.id} style={activeDatasourceIds && !activeDatasourceIds.has(ds.id) ? dimmedRowStyle : joinRowStyle}>
                {/* Sources open the journey — nothing flows in, but the empty
                    gutter keeps the card centred like the other stages. */}
                <div className="journey-gutter" style={joinInGutterStyle} />
                <div className="journey-card" style={dsCardStyle}>
                  <div style={_hs10}>
                    <div style={_hs11}>{ds.name}</div>
                    <div style={_hs12}>
                      {(() => {
                        const dbLabel = DB_TYPE_LABELS[ds.db_type] || ds.db_type.toUpperCase();
                        if (extra.sourceFile) return `${dbLabel} — 📄 ${extra.sourceFile} (${extra.rowCount?.toLocaleString() || '?'} rows)`;
                        if (ds.db_type === 'bigquery' || ds.db_type === 'duckdb') return `${dbLabel} — ${ds.db_name}`;
                        return `${dbLabel} — ${ds.host}:${ds.port}/${ds.db_name}`;
                      })()}
                    </div>
                  </div>
                  <div style={_hs13}>
                    {!isUploadedFile && (
                      <button className="btn-hover" onClick={() => handleEdit(ds)} style={{ ...secondaryBtn, fontSize: 12, padding: '4px 10px' }}>
                        Edit
                      </button>
                    )}
                    <ConfirmDeleteButton
                      onConfirm={() => handleDelete(ds.id)}
                      blockedReason={modelCount ? `Used by ${modelCount} model${modelCount > 1 ? 's' : ''} — delete those first` : null}
                    />
                  </div>
                </div>
                <div className="journey-gutter" style={joinGutterStyle}><JoinOut count={modelsByDatasource.get(ds.id) || 0} noun="model" targets={modelSpreadByDatasource.get(ds.id)}
                    onClick={() => navigate(`/models?source=${ds.id}`)} /></div>
                </div>
              );
            })}
          </div>
        )}
      </main>
      {saveMsg && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          padding: '8px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600, zIndex: 9999,
          backgroundColor: saveMsg === 'Saved' ? 'var(--state-success)' : 'var(--state-danger)', color: '#fff',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        }}>{saveMsg === 'Saved' ? '✓ Datasource saved' : '✗ Save failed'}</div>
      )}
    </div>
  );
}


const primaryBtn = {
  padding: '8px 16px', fontSize: 14, fontWeight: 600, border: 'none',
  borderRadius: 6, background: 'var(--accent-primary)', color: '#fff', cursor: 'pointer',
};

const secondaryBtn = {
  padding: '8px 16px', fontSize: 14, background: 'var(--bg-panel)', color: 'var(--text-secondary)',
  border: '1px solid var(--border-default)', borderRadius: 6, cursor: 'pointer',
};

const formCard = {
  backgroundColor: 'var(--bg-panel)', padding: 24, borderRadius: 8,
  border: '1px solid var(--border-default)', marginBottom: 24,
};

// Card plus the join gutter to its right; the card flexes, the join keeps a
// fixed width so every arrow and count lines up down the column.
// The row only anchors the join gutter: the gutter is taken out of the flow
// so the cards stay centred on the page and the arrows reach past them,
// towards the stage that lives to the right.
const joinRowStyle = { display: 'flex', alignItems: 'stretch' };
// Outside the active workspace: dimmed, never hidden — a datasource no report
// uses yet still has to be reachable and editable from here.
const dimmedRowStyle = { ...joinRowStyle, opacity: 0.4 };
const joinGutterStyle = { flex: 1, minWidth: 0, display: 'flex', alignItems: 'stretch' };
const joinInGutterStyle = joinGutterStyle;
const dsCardStyle = { width: 760, flexShrink: 0,
  backgroundColor: 'var(--bg-panel)', padding: '16px 20px', borderRadius: 8,
  border: '1px solid var(--border-default)', display: 'flex', alignItems: 'center',
};
