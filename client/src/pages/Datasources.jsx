import { useState, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';
import { toast } from '../components/Toast/toast';
import ImportOptions, { DEFAULT_IMPORT_OPTIONS, appendImportOptions, importKind } from '../components/ImportOptions/ImportOptions';
import { readSheetNames } from '../utils/readSheetNames';
import { TbUpload } from 'react-icons/tb';
import { EditIcon, ICON_SIZE } from '../components/actionIcons';
import { cardActionBtn } from '../components/dashboardModalStyles';
import { PrimaryButton, SecondaryButton, ImportButton } from '../components/PageHeader/PageHeader';
import { DatasourcesHeader } from '../cloud';
import DatasourceForm, { createModelAndNavigate } from '../components/DatasourceForm/DatasourceForm';
import Portal from '../components/Portal/Portal';
import Modal from '../components/Modal/Modal';
import { useGraph } from '../hooks/graphContext';
import { useJourneyFocus } from '../hooks/useJourneyFocus';
import FilterCrumb from '../components/AppShell/FilterCrumb';
import JoinAdd from '../components/AppShell/JoinAdd';
import SourceIcon from '../components/AppShell/SourceIcon';
import ConfirmDeleteButton from '../components/ConfirmDeleteButton/ConfirmDeleteButton';

// Fills the stage slot AppShell gives it; the shell owns the viewport height.
const _hs0 = { flex: 1, overflow: 'auto', backgroundColor: 'var(--bg-app)' };
// Action bar sitting at the top of the panel — the stage switcher in the shell
// already says where we are, so this row carries actions only.
// Three columns rather than a centred flex row: the actions sit in the middle
// one, so they stay on the axis of the cards whether or not the crumb is there.
// Centring the row itself would shift the buttons every time a filter appears.
const _hs1 = {
  display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)',
  alignItems: 'center', gap: 8, marginBottom: 20,
};
const crumbSlot = { justifySelf: 'start' };
const replaceNote = {
  fontSize: 12, lineHeight: 1.5, color: 'var(--text-muted)',
  background: 'var(--bg-subtle)', border: '1px solid var(--border-default)',
  borderRadius: 6, padding: '8px 10px', margin: '10px 0 4px',
};
const actionGroup = { display: 'flex', alignItems: 'center', gap: 8 };
const _hs2 = { display: 'none' };
const _hs4 = { padding: '32px 24px' };
const _hs5 = { fontSize: 16, fontWeight: 600, marginBottom: 16 };
const _hs6 = { color: 'var(--text-disabled)', textAlign: 'center', marginTop: 60 };
const _hs7 = { textAlign: 'center', marginTop: 80 };
const _hs8 = { fontSize: 16, color: 'var(--text-muted)', marginBottom: 12 };
const _hs9 = { display: 'flex', flexDirection: 'column', gap: 8 };
const _hs10 = { flex: '1 1 180px', minWidth: 0 };
const _hs11 = { fontWeight: 600, color: 'var(--text-primary)', fontSize: 15 };
const _hs12 = { fontSize: 13, color: 'var(--text-muted)', marginTop: 2 };
const _hs13 = { display: 'flex', alignItems: 'center', gap: 6 };

const DB_TYPE_LABELS = {
  postgres: 'PostgreSQL',
  azure_postgres: 'Azure PostgreSQL',
  redshift: 'Amazon Redshift',
  mysql: 'MySQL',
  azure_sql: 'Azure SQL Database',
  bigquery: 'Google BigQuery',
  duckdb: 'DuckDB',
};

export default function Datasources() {
  const navigate = useNavigate();
  // Rows come from the shell-level graph so this column is already populated
  // when the carousel slides it in.
  const {
    setDatasources, modelsByDatasourceAll, activeDatasourceIds, loading, refresh,
    orderedDatasources: graphOrderedDatasources,
  } = useGraph();
  // The branch the journey is focused on, resolved once for all three stages.
  const focus = useJourneyFocus();

  // Order comes from the graph so the three columns agree; filtering is all
  // that is left to do here, and it preserves it.
  const orderedDatasources = useMemo(() => (
    focus.datasourceIds
      ? graphOrderedDatasources.filter((d) => focus.datasourceIds.has(d.id))
      : graphOrderedDatasources
  ), [graphOrderedDatasources, focus.datasourceIds]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [importOpts, setImportOpts] = useState(DEFAULT_IMPORT_OPTIONS);
  const [selectedFile, setSelectedFile] = useState(null);
  // Set while the picker is refreshing an existing source rather than creating one.
  const [replaceTarget, setReplaceTarget] = useState(null);
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

  // Refreshing an existing source reuses the whole picker: same options, same
  // dialog. Only the endpoint differs — and with it whether models and reports
  // built on this source survive.
  const startReplace = (ds) => {
    setReplaceTarget(ds);
    fileInputRef.current?.click();
  };

  const cancelFilePick = () => {
    setSelectedFile(null);
    setReplaceTarget(null);
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
      const headers = { 'Content-Type': 'multipart/form-data' };
      const res = replaceTarget
        ? await api.put(`/upload/${replaceTarget.id}`, formData, { headers })
        : await api.post('/upload', formData, { headers });
      const rows = res.data.datasource.rowCount?.toLocaleString() || '?';
      setUploadProgress(replaceTarget
        ? `${replaceTarget.name} refreshed — ${rows} rows from ${file.name}`
        : `Imported ${rows} rows from ${file.name}`);
      // Tables the new file didn't bring back. Said now, while the cause is
      // still on screen, rather than at the next model open.
      const missing = res.data.missingTables || [];
      if (missing.length) {
        toast(`Models using ${missing.join(', ')} will need fixing — the new file has no such table.`);
      }
      cancelFilePick();
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
          <div style={crumbSlot}>
            {focus.active && (
              <FilterCrumb
                label={focus.label}
                verb={focus.stage === 'sources' ? 'Showing' : 'Following'}
                onClear={focus.clear}
              />
            )}
          </div>
          <div style={actionGroup}>
            <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls,.parquet,.json,.tsv"
              style={_hs2} onChange={handleFileSelected} />
            {/* Clears the refresh target: the OS dialog can be dismissed, which
                would otherwise leave the next pick aimed at a source. */}
            <ImportButton onClick={() => { setReplaceTarget(null); fileInputRef.current?.click(); }} disabled={uploading}>
              {uploading ? 'Uploading...' : 'Import file'}
            </ImportButton>
            <PrimaryButton onClick={() => { setEditingId(null); setEditingValues(null); setShowForm(true); }}>+ New Connection</PrimaryButton>
          </div>
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
          <Modal onClose={uploading ? undefined : cancelFilePick} width={560}>
            <h2 style={_hs5}>{replaceTarget ? `Refresh ${replaceTarget.name}` : 'Import file'}</h2>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>
              Selected: <strong style={{ color: 'var(--text-primary)' }}>{selectedFile.name}</strong>
            </div>
            {replaceTarget && (
              <div style={replaceNote}>
                Replaces the data behind this source. Models and reports built on it are kept —
                but a column the new file no longer carries will show up as a broken reference.
              </div>
            )}
            <ImportOptions value={importOpts} onChange={setImportOpts} kind={importKind(selectedFile.name)} sheetNames={sheetNames} />
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <PrimaryButton onClick={handleFileUpload} disabled={uploading || (importKind(selectedFile.name) === 'excel' && sheetNames.length > 0 && !(importOpts.sheets && importOpts.sheets.length))}>
                {uploading ? (replaceTarget ? 'Refreshing...' : 'Importing...') : (replaceTarget ? 'Refresh data' : 'Import')}
              </PrimaryButton>
              <SecondaryButton onClick={cancelFilePick} disabled={uploading}>Cancel</SecondaryButton>
            </div>
          </Modal>
        )}
        {showForm && (
          <Modal onClose={handleCancel} width={620}>
            <h2 style={_hs5}>{editingId ? 'Edit Data Source' : 'New Data Source'}</h2>
            <DatasourceForm
              editingId={editingId}
              initialValues={editingValues}
              onSaved={handleSaved}
              onCancel={handleCancel}
            />
          </Modal>
        )}

        {loading ? (
          <div style={_hs6}>Loading...</div>
        ) : orderedDatasources.length === 0 && !showForm ? (
          // A filter that matches nothing must say so, otherwise the column just
          // looks broken — and the way out has to be one click away.
          focus.active ? (
            <div style={_hs7}>
              <p style={_hs8}>Nothing here for this filter</p>
              <button className="btn-hover btn-hover-primary" onClick={focus.clear} style={primaryBtn}>Show every data source</button>
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
                <div className="journey-card" data-join-anchor={`sources:${ds.id}`} style={dsCardStyle}>
                  <SourceIcon file={isUploadedFile} />
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
                    {/* Same icon-button language as the report and model cards. */}
                    {isUploadedFile ? (
                      // A file source has no connection to edit — what it has is
                      // data that goes stale. Same id, so everything downstream
                      // survives the refresh.
                      <button
                        onClick={() => startReplace(ds)}
                        disabled={uploading}
                        title={`Import a newer ${extra.sourceFile || 'file'} into this source`}
                        {...cardActionBtn('muted')}
                      >
                        <TbUpload size={16} />
                      </button>
                    ) : (
                      <button
                        onClick={() => handleEdit(ds)}
                        title="Edit connection"
                        {...cardActionBtn()}
                      >
                        <EditIcon size={ICON_SIZE.card} />
                      </button>
                    )}
                    <ConfirmDeleteButton
                      variant="icon"
                      label="Delete data source"
                      onConfirm={() => handleDelete(ds.id)}
                      blockedReason={modelCount ? `Used by ${modelCount} model${modelCount > 1 ? 's' : ''} — delete those first` : null}
                    />
                  </div>
                  {/* Hands the Models stage a source already chosen, the same
                      way the model editor hands the wizard a model. */}
                  <JoinAdd
                    title={`Add a data model on ${ds.name}`}
                    onClick={() => navigate(`/models?focus=sources:${ds.id}&newModel=1&datasourceId=${ds.id}`)}
                  />
                </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
      {saveMsg && (
        <Portal>
          <div style={{
            position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
            padding: '8px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600, zIndex: 9999,
            backgroundColor: saveMsg === 'Saved' ? 'var(--state-success)' : 'var(--state-danger)', color: '#fff',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          }}>{saveMsg === 'Saved' ? '✓ Datasource saved' : '✗ Save failed'}</div>
        </Portal>
      )}
    </div>
  );
}


const primaryBtn = {
  padding: '8px 16px', fontSize: 14, fontWeight: 600, border: 'none',
  borderRadius: 6, background: 'var(--accent-primary)', color: '#fff', cursor: 'pointer',
};

// Card plus the join gutter to its right; the card flexes, the join keeps a
// fixed width so every arrow and count lines up down the column.
// The row only anchors the join gutter: the gutter is taken out of the flow
// so the cards stay centred on the page and the arrows reach past them,
// towards the stage that lives to the right.
// A row is just a centred card now — the join layer draws over the space
// either side of it.
const joinRowStyle = { display: 'flex', justifyContent: 'center' };
// Outside the active workspace: dimmed, never hidden — a datasource no report
// uses yet still has to be reachable and editable from here.
const dimmedRowStyle = { ...joinRowStyle, opacity: 0.4 };
const dsCardStyle = { width: '100%', maxWidth: 760, flexShrink: 0, flexWrap: 'wrap', rowGap: 10,
  backgroundColor: 'var(--bg-panel)', padding: '16px 20px', borderRadius: 8,
  border: '1px solid var(--border-default)', display: 'flex', alignItems: 'center', gap: 12,
};
