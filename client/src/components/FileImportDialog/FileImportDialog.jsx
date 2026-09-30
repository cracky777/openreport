import { useEffect, useState } from 'react';
import api from '../../utils/api';
import Modal from '../Modal/Modal';
import ImportOptions, { DEFAULT_IMPORT_OPTIONS, appendImportOptions, importKind } from '../ImportOptions/ImportOptions';
import { readSheetNames } from '../../utils/readSheetNames';
import { PrimaryButton, SecondaryButton } from '../PageHeader/PageHeader';
import { sourceFiles } from '../../utils/sourceFiles';

const noteStyle = {
  fontSize: 12, lineHeight: 1.5, color: 'var(--text-muted)',
  background: 'var(--bg-subtle)', border: '1px solid var(--border-default)',
  borderRadius: 6, padding: '8px 10px', margin: '10px 0 4px',
};
const selectedStyle = { fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 };
const headingStyle = { fontSize: 16, fontWeight: 600, marginBottom: 16 };
const errorStyle = {
  marginTop: 12, padding: '8px 10px', borderRadius: 6, fontSize: 13,
  background: 'var(--state-danger-soft)', color: 'var(--state-danger)', border: '1px solid var(--state-danger-border)',
};
const fieldStyle = { display: 'block', marginTop: 10, fontSize: 13, color: 'var(--text-secondary)' };
const selectStyle = {
  display: 'block', width: '100%', marginTop: 4, padding: '6px 8px', borderRadius: 6, fontSize: 13,
  border: '1px solid var(--border-default)', background: 'var(--bg-input)', color: 'var(--text-primary)',
};
const actionsStyle = { display: 'flex', gap: 8, marginTop: 16 };

// One file on its way into a source: the parse options, then the upload.
// - create:  a new source (`workspaceId` says where)
// - refresh: newer data for one of `target`'s files
// `onDone(responseData)` after a success. `onFailed()` after a refusal: a
// failed response is no proof the server created nothing (a proxy timeout, a
// 409 on a source already there), so callers re-read their lists.
export default function FileImportDialog({ file, mode, target, workspaceId, onDone, onFailed, onCancel }) {
  const kind = importKind(file.name);
  const files = mode === 'create' ? [] : sourceFiles(target);
  const [opts, setOpts] = useState(DEFAULT_IMPORT_OPTIONS);
  const [sheetNames, setSheetNames] = useState([]);
  // Refreshing a source of several files: which one the new data replaces.
  // The file of the same name is the likely answer.
  const [replacing, setReplacing] = useState(() => (files.find((f) => f.sourceFile === file.name) || files[0])?.sourceFile || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (kind !== 'excel') return undefined;
    let live = true;
    readSheetNames(file).then((names) => {
      if (!live) return;
      setSheetNames(names);
      setOpts((o) => ({ ...o, sheets: names })); // default: import every sheet
    });
    return () => { live = false; };
  }, [file, kind]);

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      if (mode === 'create') {
        formData.append('name', file.name.replace(/\.[^.]+$/, ''));
        if (workspaceId) formData.append('workspaceId', workspaceId);
      }
      if (mode === 'refresh' && files.length > 1) formData.append('sourceFile', replacing);
      appendImportOptions(formData, opts);
      const headers = { 'Content-Type': 'multipart/form-data' };
      const res = mode === 'create'
        ? await api.post('/upload', formData, { headers })
        : await api.put(`/upload/${target.id}`, formData, { headers });
      onDone(res.data);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      onFailed?.();
    } finally {
      setBusy(false);
    }
  };

  const noSheet = kind === 'excel' && sheetNames.length > 0 && !(opts.sheets && opts.sheets.length);
  const verb = mode === 'refresh' ? 'Refresh data' : 'Import';
  return (
    <Modal onClose={busy ? undefined : onCancel} width={560}>
      <h2 style={headingStyle}>{mode === 'create' ? 'Import file' : `Refresh ${target.name}`}</h2>
      <div style={selectedStyle}>
        Selected: <strong style={{ color: 'var(--text-primary)' }}>{file.name}</strong>
      </div>
      {mode === 'refresh' && (
        <>
          <div style={noteStyle}>
            Replaces the data of one file of this source. Models and reports built on it are kept —
            but a column the new file no longer carries will show up as a broken reference.
          </div>
          {files.length > 1 && (
            <label style={fieldStyle}>
              File to replace
              <select style={selectStyle} value={replacing} onChange={(e) => setReplacing(e.target.value)}>
                {files.map((f) => <option key={f.sourceFile} value={f.sourceFile}>{f.sourceFile}</option>)}
              </select>
            </label>
          )}
        </>
      )}
      <ImportOptions value={opts} onChange={setOpts} kind={kind} sheetNames={sheetNames} />
      {error && <div style={errorStyle}>{error}</div>}
      <div style={actionsStyle}>
        <PrimaryButton onClick={submit} disabled={busy || noSheet}>{busy ? 'Importing...' : verb}</PrimaryButton>
        <SecondaryButton onClick={onCancel} disabled={busy}>Cancel</SecondaryButton>
      </div>
    </Modal>
  );
}
