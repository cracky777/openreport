import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TbAlertTriangle, TbCloudUpload, TbDragDrop, TbInfoCircle, TbRefresh, TbLink } from 'react-icons/tb';
import api from '../../utils/api';
import Modal from '../Modal/Modal';
import { appendImportOptions } from '../ImportOptions/ImportOptions';
import ImportFileList, { SourceRow } from './ImportFileList';
import { useFileOptions, missingSheets } from '../../utils/importFiles';
import { PrimaryButton, SecondaryButton } from '../PageHeader/PageHeader';
import { sourceFiles, FILE_IMPORT_ACCEPT } from '../../utils/sourceFiles';
import { uploadEach, mergeFecUploads, modelOnFiles } from '../../utils/multiFileImport';
import { hasFinancePack } from '../../utils/accountingPack';
import FecPackOffer from '../AccountingPack/FecPackOffer';

const head = { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 };
const headIcon = {
  width: 40, height: 40, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'var(--accent-primary-soft)', color: 'var(--accent-primary)',
};
const headTitle = { margin: 0, fontSize: 17, fontWeight: 600, color: 'var(--text-primary)' };
const headSub = { margin: '2px 0 0', fontSize: 12, color: 'var(--text-muted)' };
const noteStyle = {
  display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, lineHeight: 1.5, color: 'var(--text-muted)',
  background: 'var(--bg-subtle)', border: '1px solid var(--border-default)', borderRadius: 8, padding: '8px 10px', margin: '10px 0 4px',
};
const errorStyle = {
  marginTop: 12, padding: '8px 10px', borderRadius: 6, fontSize: 13,
  background: 'var(--state-danger-soft)', color: 'var(--state-danger)', border: '1px solid var(--state-danger-border)',
};
const fieldStyle = { display: 'block', marginTop: 10, fontSize: 13, color: 'var(--text-secondary)' };
const selectStyle = {
  display: 'block', width: '100%', marginTop: 4, padding: '6px 8px', borderRadius: 6, fontSize: 13,
  border: '1px solid var(--border-default)', background: 'var(--bg-input)', color: 'var(--text-primary)',
};
const actionsStyle = { display: 'flex', gap: 8, marginTop: 18, flexWrap: 'wrap', justifyContent: 'flex-end' };
const dropZone = (over) => ({
  marginTop: 10, padding: '14px 12px', borderRadius: 10, cursor: 'pointer', textAlign: 'center',
  border: `1.5px dashed ${over ? 'var(--accent-primary)' : 'var(--border-strong)'}`,
  background: over ? 'var(--accent-primary-soft)' : 'transparent', color: 'var(--text-secondary)', fontSize: 13,
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, transition: 'background 0.15s, border-color 0.15s',
});
const listStyle = { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 };
const leadStyle = { fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, margin: '0 0 14px' };
const hiddenStyle = { display: 'none' };
const illustration = { display: 'block', width: '100%', maxWidth: 360, height: 'auto', margin: '0 auto 14px' };

// Two tables of two files, joined on a shared key: what combining them means.
function JoinIllustration({ names }) {
  const [a = 'File 1', b = 'File 2'] = names;
  const cut = (s) => (s.length > 14 ? `${s.slice(0, 13)}…` : s);
  const table = (x, title, cols) => (
    <g>
      <rect x={x} y="8" width="120" height="84" rx="8" fill="var(--bg-panel-alt)" stroke="var(--border-strong)" />
      <rect x={x} y="8" width="120" height="22" rx="8" fill="var(--accent-primary)" />
      <rect x={x} y="22" width="120" height="8" fill="var(--accent-primary)" />
      <text x={x + 10} y="23" fontSize="11" fontWeight="600" fill="#fff">{cut(title)}</text>
      {cols.map((c, i) => (
        <text key={c} x={x + 10} y={46 + i * 16} fontSize="10.5" fill={i === 0 ? 'var(--accent-primary)' : 'var(--text-secondary)'} fontWeight={i === 0 ? 600 : 400}>{c}</text>
      ))}
    </g>
  );
  return (
    <svg viewBox="0 0 360 100" style={illustration} role="img" aria-label="Two files joined on a shared column">
      {table(10, a, ['customer_id', 'amount', 'date'])}
      {table(230, b, ['customer_id', 'name', 'city'])}
      <path d="M130 42 C 180 42, 180 42, 230 42" fill="none" stroke="var(--accent-primary)" strokeWidth="2" strokeDasharray="4 3" />
      <circle cx="180" cy="42" r="11" fill="var(--accent-primary-soft)" stroke="var(--accent-primary)" />
      <text x="180" y="46" fontSize="11" textAnchor="middle" fill="var(--accent-primary)" fontWeight="700">⋈</text>
    </svg>
  );
}

// Files on their way into sources.
// - create:  one or several new sources (`workspaceId` says where). More
//   files can be added before importing; each becomes a source of its own.
//   Then, in turn: the books (FEC, SAF-T, DATEV) of one company are merged into one source of
//   several fiscal years and offered the Finance package; and when several
//   other files came in, the dialog offers one model combining them, whose
//   joins the author draws in the model editor.
// - refresh: newer data for one of `target`'s files (one file).
// `onDone(responseData)` after a success: the first new source's response,
// with `imported` listing every source the import left. `onFailed()` after a
// refusal: a failed response is no proof the server created nothing (a proxy
// timeout, a 409 on a source already there), so callers re-read their lists.
// `offerAccountingPack` / `offerCombine` turn those offers off where they make
// no sense (files added to the model being edited, a model being created).
export default function FileImportDialog({ file, files: initialFiles, mode, target, workspaceId, onDone, onFailed, onCancel, offerAccountingPack = true, offerCombine = true }) {
  const navigate = useNavigate();
  const [files, setFiles] = useState(() => (initialFiles?.length ? [...initialFiles] : [file]).filter(Boolean));
  const first = files[0];
  const single = files.length === 1;
  const sourceFileList = mode === 'create' ? [] : sourceFiles(target);
  // Each file's own import options (a CSV's separator, a workbook's sheets).
  const fileOptions = useFileOptions();
  // Refreshing a source of several files: which one the new data replaces.
  // The file of the same name is the likely answer.
  const [replacing, setReplacing] = useState(() => (sourceFileList.find((f) => f.sourceFile === first?.name) || sourceFileList[0])?.sourceFile || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState({}); // index → { state, error }
  const [dragOver, setDragOver] = useState(false);
  // After the uploads: what is left to offer, one step at a time.
  const [step, setStep] = useState(null); // null | 'report' | 'fec' | 'combine'
  const [outcome, setOutcome] = useState(null); // { payload, books, sources, failures }
  const addRef = useRef(null);

  const addFiles = (picked) => {
    const accepted = FILE_IMPORT_ACCEPT.split(',');
    const fresh = Array.from(picked || []).filter((f) => accepted.includes(`.${f.name.split('.').pop().toLowerCase()}`)
      && !files.some((x) => x.name === f.name && x.size === f.size));
    if (fresh.length) setFiles((prev) => [...prev, ...fresh]);
  };

  const refresh = async () => {
    setBusy(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('file', first);
      if (sourceFileList.length > 1) formData.append('sourceFile', replacing);
      appendImportOptions(formData, fileOptions.optionsFor(first));
      const res = await api.put(`/upload/${target.id}`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      onDone(res.data);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      onFailed?.();
    } finally {
      setBusy(false);
    }
  };

  // What comes after the step just closed: the books' offer, then the
  // combined model, then back to the caller.
  const advance = (o, from) => {
    const order = ['report', 'fec', 'combine'];
    const due = {
      report: o.failures.length > 0,
      fec: offerAccountingPack && o.books.length > 0,
      combine: offerCombine && o.sources.length >= 2,
    };
    const next = order.slice(from ? order.indexOf(from) + 1 : 0).find((s) => due[s]);
    if (next) setStep(next);
    else onDone(o.payload);
  };

  const create = async () => {
    setBusy(true);
    setError('');
    setStatus({});
    try {
      const results = await uploadEach(files, {
        workspaceId,
        optionsFor: fileOptions.optionsFor,
        // One file: its failure is told once, in the dialog's error line below.
        onStatus: (i, state, err) => setStatus((s) => ({ ...s, [i]: { state, error: single ? '' : err } })),
      });
      const ok = results.filter((r) => r.data);
      const failures = results.filter((r) => r.error);
      if (!ok.length) {
        setError(single ? failures[0].error : 'None of the files could be imported.');
        onFailed?.();
        return;
      }
      const books = offerAccountingPack ? await mergeFecUploads(ok) : [];
      const kept = ok.filter((r) => !r.mergedInto);
      const sources = kept.filter((r) => !hasFinancePack(r.data.accounting)).map((r) => r.data.datasource);
      const o = { payload: { ...kept[0].data, imported: kept.map((r) => r.data) }, books, sources, failures };
      setOutcome(o);
      if (failures.length) onFailed?.();
      advance(o);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      onFailed?.();
    } finally {
      setBusy(false);
    }
  };

  const combine = async () => {
    setBusy(true);
    setError('');
    try {
      const modelId = await modelOnFiles(outcome.sources, { workspaceId });
      navigate(`/models/${modelId}?setup=files`);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      setBusy(false);
    }
  };

  const header = (Icon, title, sub, tone) => (
    <div style={head}>
      <span style={{ ...headIcon, ...(tone || {}) }}><Icon size={22} /></span>
      <div style={{ minWidth: 0 }}>
        <h2 style={headTitle}>{title}</h2>
        {sub && <p style={headSub}>{sub}</p>}
      </div>
    </div>
  );

  if (step === 'report') {
    return (
      <Modal onClose={() => advance(outcome, 'report')} width={560}>
        {header(TbAlertTriangle, 'Some files were not imported', 'The others are in; these need a look.', { background: 'var(--state-danger-soft)', color: 'var(--state-danger)' })}
        <ImportFileList files={outcome.failures.map((f) => f.file)} options={fileOptions} busy
          status={Object.fromEntries(outcome.failures.map((f, i) => [i, { state: 'error', error: f.error }]))} />
        <div style={actionsStyle}>
          <PrimaryButton onClick={() => advance(outcome, 'report')}>Continue</PrimaryButton>
        </div>
      </Modal>
    );
  }

  if (step === 'fec') {
    const book = outcome.books[0];
    return (
      <Modal onClose={() => advance(outcome, 'fec')} width={600}>
        <FecPackOffer datasourceId={book.datasource.id} workspaceId={workspaceId} accounting={book.accounting}
          sameCompany={book.sameCompany}
          // Merged into another source: that one is what the caller now has.
          onMerged={(t) => setOutcome((o) => ({ ...o, payload: { ...o.payload, datasource: { ...o.payload.datasource, id: t.id, name: t.name } } }))}
          onDecline={() => advance(outcome, 'fec')} />
      </Modal>
    );
  }

  if (step === 'combine') {
    return (
      <Modal onClose={busy ? undefined : () => onDone(outcome.payload)} width={560}>
        {header(TbLink, `${outcome.sources.length} files imported`, 'Use their data together in one report')}
        <JoinIllustration names={outcome.sources.map((s) => s.name)} />
        <p style={leadStyle}>
          Combine them in one model: each file stays a source of its own, and the model editor opens with their tables
          side by side, the joins it can find from the column names already drawn.
        </p>
        <ul style={listStyle}>
          {outcome.sources.map((s) => <SourceRow key={s.id} name={s.sourceFile || s.name} />)}
        </ul>
        {error && <div style={errorStyle}>{error}</div>}
        <div style={actionsStyle}>
          <SecondaryButton onClick={() => onDone(outcome.payload)} disabled={busy}>Keep separate</SecondaryButton>
          <PrimaryButton onClick={combine} disabled={busy}>{busy ? 'Creating…' : 'Combine in one model'}</PrimaryButton>
        </div>
      </Modal>
    );
  }

  const isCreate = mode === 'create';
  const noSheet = missingSheets(files, fileOptions.optionsFor);
  const verb = !isCreate ? 'Refresh data' : single ? 'Import' : `Import ${files.length} files`;
  const onDrop = (e) => { e.preventDefault(); setDragOver(false); if (!busy) addFiles(e.dataTransfer?.files); };
  return (
    <Modal onClose={busy ? undefined : onCancel} width={580}>
      <div onDragOver={isCreate ? (e) => { e.preventDefault(); setDragOver(true); } : undefined}
        onDragLeave={isCreate ? (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false); } : undefined}
        onDrop={isCreate ? onDrop : undefined}>
        {isCreate
          ? header(TbCloudUpload, single ? 'Import a file' : `Import ${files.length} files`, 'CSV, Excel, Parquet, JSON, SQLite, DuckDB or accounting books (FEC, SAF-T, XAF, SIE, DATEV) — each file becomes a data source')
          : header(TbRefresh, `Refresh ${target.name}`, 'Newer data for one of its files')}
        <ImportFileList files={files} options={fileOptions} status={status} busy={busy}
          onRemove={isCreate ? (i) => setFiles((prev) => prev.filter((_, k) => k !== i)) : null} />
        {isCreate && !busy && (
          <>
            <div style={dropZone(dragOver)} role="button" tabIndex={0}
              onClick={() => addRef.current?.click()} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') addRef.current?.click(); }}>
              <TbDragDrop size={18} /> Drop more files here, or <strong style={{ color: 'var(--accent-primary)' }}>add another file</strong>
            </div>
            <input ref={addRef} type="file" multiple accept={FILE_IMPORT_ACCEPT} style={hiddenStyle} aria-label="Add another file"
              onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
          </>
        )}
        {isCreate && !single && (
          <div style={noteStyle}>
            <TbInfoCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              Each file is read with automatic detection unless you change its Options. Accounting books (FEC, SAF-T, XAF, SIE, DATEV) of the same
              company are merged into one source of several fiscal years; other files can then be combined in one model.
            </span>
          </div>
        )}
        {!isCreate && (
          <>
            <div style={noteStyle}>
              <TbInfoCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>
                Replaces the data of one file of this source. Models and reports built on it are kept — but a column the new
                file no longer carries will show up as a broken reference.
              </span>
            </div>
            {sourceFileList.length > 1 && (
              <label style={fieldStyle}>
                File to replace
                <select style={selectStyle} value={replacing} onChange={(e) => setReplacing(e.target.value)}>
                  {sourceFileList.map((f) => <option key={f.sourceFile} value={f.sourceFile}>{f.sourceFile}</option>)}
                </select>
              </label>
            )}
          </>
        )}
        {error && <div style={errorStyle}>{error}</div>}
        <div style={actionsStyle}>
          <SecondaryButton onClick={onCancel} disabled={busy}>Cancel</SecondaryButton>
          <PrimaryButton onClick={isCreate ? create : refresh} disabled={busy || noSheet || !files.length}>{busy ? 'Importing…' : verb}</PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}
