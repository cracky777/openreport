import api from '../../utils/api';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TbHelpCircle, TbSend } from 'react-icons/tb';
import { useAuth } from '../../hooks/useAuth';
import { useGraph } from '../../hooks/graphContext';
import { useTheme } from '../../hooks/useTheme';
import { usePermissions } from '../../hooks/usePermissions';
import Modal from '../Modal/Modal';
import ImportFileList from '../FileImportDialog/ImportFileList';
import FecPackOffer from '../AccountingPack/FecPackOffer';
import { cardStyle, rowStyle, iconStyle, titleStyle, chipsStyle, chip } from './actionCardStyles';
import { threadStyle, composerStyle, inputStyle, sendBtn } from './panelStyles';
import { useFileOptions, missingSheets } from '../../utils/importFiles';
import { uploadEach, mergeFecUploads, modelOnFiles } from '../../utils/multiFileImport';
import { ensureModelForUpload, setUpModelFromFiles, draftReportOn } from '../../utils/modelFromFiles';
import { handOver } from '../../utils/assistantHandoff';

// The conversation before a report exists: the studio's panel (AiPanel) shows
// it on `/chat`, where the assistant's thread will go on once the report is
// made. It opens on questions with choices, as the assistant asks them
// (QuestionCard): continue a report, start a new one on dropped files, or
// start from a data model of the workspace, then which report or which model.
// Files come by drag and drop only, anywhere on the studio (pages/AiStudio.jsx
// holds them): a file becomes its source, its model and a blank report here;
// several files become one model, joined by their column names; a company's
// books become the Finance package. Then the studio opens on the report, the
// request typed here handed to the assistant as its first message.

/**
 * @param {File[]} files        dropped on the studio, held there
 * @param {function} onFiles    the list after a removal
 */
// What the home says when there is nothing to pick from, or no assistant.
const ASSISTANT_NOTE = {
  setup: 'No AI assistant on this account yet: set up your provider with the button at the top of this panel. Files dropped here still become a model and a report without it.',
  disabled: 'The assistant is switched off on this instance: ask an administrator. Files dropped here still become a model and a report.',
  denied: 'The assistant is not available for this account: ask an administrator. Files dropped here still become a model and a report.',
};

export default function StartConversation({ files, onFiles, aiStatus = null }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { resolved: themeResolved, themes } = useTheme();
  const { scopedModels, scopedReports, models, selectedWs, currentWsKey, currentWsRole, refresh } = useGraph();
  const { canEdit } = usePermissions(selectedWs, user, currentWsRole);
  const fileOptions = useFileOptions();

  const [request, setRequest] = useState('');
  const [choice, setChoice] = useState(null); // 'report' | 'new' | 'model': the first question's answer
  const [status, setStatus] = useState({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null); // { text, error }
  const [books, setBooks] = useState(null); // books uploaded: the Finance package is offered first

  const theme = themes[themeResolved] ? { key: themeResolved, ...themes[themeResolved] } : null;

  // The studio on a blank report of this model, the request (if any) handed
  // to the assistant there as its first message. A model this conversation
  // just made from the files goes with the draft if it is never saved.
  const openStudio = async (mid, title) => {
    const ownsModel = !models.some((m) => m.id === mid);
    const id = await draftReportOn(mid, { title, autoTitle: true, workspaceId: selectedWs || undefined, theme, ownsModel });
    if (request.trim()) handOver('report', id, request.trim());
    navigate(`/studio/${id}`);
  };

  const run = async (work) => {
    setBusy(true);
    setNote(null);
    try {
      await work();
    } catch (err) {
      setNote({ text: err.response?.data?.error || err.message, error: true });
      refresh();
    } finally {
      setBusy(false);
    }
  };

  // The files, then the studio: one file is its own model; a company's books
  // are offered as the Finance package; other files are combined in one model,
  // joined by their column names, the assistant taking it from there.
  const importAndBuild = () => run(async () => {
    const results = await uploadEach(files, {
      workspaceId: currentWsKey,
      optionsFor: fileOptions.optionsFor,
      freeName: true,
      onStatus: (i, state, err) => setStatus((s) => ({ ...s, [i]: { state, error: err } })),
    });
    const ok = results.filter((r) => r.data);
    const failed = results.filter((r) => r.error);
    // One file: its line in the list already says why.
    if (!ok.length) { if (files.length > 1) throw new Error('None of the files could be imported.'); return; }
    const booksFound = await mergeFecUploads(ok);
    const kept = ok.filter((r) => !r.mergedInto);
    if (booksFound.length) {
      // What the offer would hide: a file that failed, books of another
      // company (or without a company number) left as sources of their own.
      const warnings = [
        ...failed.map((r) => `${r.file.name}: ${r.error}`),
        ...booksFound.slice(1).map((b) => `${b.datasource.name} was imported as a source of its own: not the same company number, so not merged.`),
      ];
      // The other files dropped with the books (a budget): linked to the
      // package's model once it exists, the assistant then joins them — a
      // controller who drops books and budget together expects one model.
      const others = kept.filter((r) => !r.data.accounting && !booksFound.some((b) => b.datasource.id === r.data.datasource.id));
      setBooks({ ...booksFound[0], warnings, others });
      return;
    }
    if (kept.length === 1) {
      const mid = await ensureModelForUpload(kept[0].data, { workspaceId: currentWsKey, models });
      await openStudio(mid, kept[0].data.datasource.name);
      return;
    }
    const sources = kept.map((r) => r.data.datasource);
    const mid = await modelOnFiles(sources, { workspaceId: currentWsKey });
    const found = await setUpModelFromFiles(mid, sources[0].id);
    setNote({ text: `${sources.length} files in one model, ${found.joins.length} join${found.joins.length === 1 ? '' : 's'} found from the column names.` });
    await openStudio(mid, `${sources[0].name} + ${sources.length - 1} more`);
  });

  // Send: with files, the import; without, the studio on the workspace's only
  // model — with several, the question above picks one.
  const send = () => {
    if (busy) return;
    if (files.length) { importAndBuild(); return; }
    if (!request.trim()) return;
    if (scopedModels.length !== 1) { setNote({ text: 'Drop a file, or pick a data model above.', error: true }); return; }
    run(() => openStudio(scopedModels[0].id, scopedModels[0].name));
  };

  const startOn = (m) => run(() => openStudio(m.id, m.name));
  const noSheet = missingSheets(files, fileOptions.optionsFor);
  const ready = !busy && !noSheet && (files.length > 0 || (request.trim() && scopedModels.length === 1));
  const sendLabel = busy ? 'Working…' : files.length ? (files.length > 1 ? `Import ${files.length} files` : 'Import and build') : 'Build it';

  // The first question's choices: continue a report of the workspace, a new
  // report on dropped files, or a new report on a model of the workspace. A
  // single choice is not asked, its own question comes first.
  const ways = [
    ...(scopedReports.length ? [{ key: 'report', label: 'Continue a report' }] : []),
    ...(canEdit ? [{ key: 'new', label: 'Start a new report' }] : []),
    ...(canEdit && scopedModels.length ? [{ key: 'model', label: 'Start from a data model' }] : []),
  ];
  const way = ways.some((w) => w.key === choice) ? choice : (ways.length === 1 ? ways[0].key : null);

  return (
    <>
      <div style={threadStyle}>
        {aiStatus && !aiStatus.enabled && <div style={noteStyle(false)}>{ASSISTANT_NOTE[aiStatus.reason] || ASSISTANT_NOTE.disabled}</div>}
        {!files.length && !ways.length && <Question text={canEdit ? 'Nothing to start from in this workspace yet: drop your files anywhere on this page.' : 'Nothing to continue in this workspace: ask its editors for a report, or pick another workspace at the top.'} />}
        {!files.length && ways.length > 1 && (
          <Question text="What would you like to do?">
            {ways.map((w) => (
              <button key={w.key} type="button" style={chip(way === w.key, busy)} onClick={() => setChoice(w.key)} disabled={busy}>{w.label}</button>
            ))}
          </Question>
        )}
        {!files.length && way === 'report' && (
          <Question text="Which report?">
            {scopedReports.map((r) => (
              <button key={r.id} type="button" style={chip(false, busy)} onClick={() => navigate(canEdit ? `/studio/${r.id}` : `/view/${r.id}`)} disabled={busy}>{r.title}</button>
            ))}
          </Question>
        )}
        {!files.length && way === 'new' && <Question text="Drop your files anywhere on this page." />}
        {!files.length && way === 'model' && (
          <Question text="Which data model?">
            {scopedModels.map((m) => (
              <button key={m.id} type="button" style={chip(false, busy)} onClick={() => startOn(m)} disabled={busy}>{m.name}</button>
            ))}
          </Question>
        )}
        {files.length > 0 && (
          <ImportFileList files={files} options={fileOptions} status={status} busy={busy}
            onRemove={busy ? null : (i) => onFiles(files.filter((_, k) => k !== i))} />
        )}
        {note && <div style={noteStyle(note.error)}>{note.text}</div>}
      </div>
      {canEdit && (
        <div style={composerStyle}>
          <textarea
            aria-label="Describe the report you want"
            style={inputStyle}
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (ready) send(); } }}
            placeholder={files.length ? 'What should the report show?' : 'A sales dashboard by region and month…'}
            maxLength={4000}
            rows={1}
            disabled={busy}
          />
          <button type="button" style={sendBtn(ready)} onClick={send} disabled={!ready} title={sendLabel} aria-label={sendLabel}><TbSend size={16} /></button>
        </div>
      )}

      {books && (
        <Modal width={600} onClose={() => setBooks(null)}>
          {books.warnings?.length ? <div style={warningStyle}>{books.warnings.map((w, i) => <div key={i}>{w}</div>)}</div> : null}
          <FecPackOffer datasourceId={books.datasource.id} workspaceId={currentWsKey} accounting={books.accounting}
            sameCompany={books.sameCompany}
            onMerged={(t) => setBooks((prev) => ({ ...prev, datasource: { ...prev.datasource, id: t.id, name: t.name } }))}
            onCreated={(reportId) => run(async () => {
              // The files dropped with the books join the package's model, unjoined:
              // the assistant is told, and takes the request from there.
              const others = books.others || [];
              const linked = [];
              if (others.length) {
                const modelId = (await api.get(`/reports/${reportId}`)).data.report.model_id;
                for (const o of others) {
                  try {
                    const link = (await api.post(`/models/${modelId}/datasources`, { datasourceId: o.data.datasource.id })).data.datasource;
                    linked.push(link.name);
                  } catch { /* already linked, or not linkable: the assistant can still be asked */ }
                }
              }
              // What was typed before the import is the first message of the studio:
              // the package answers most of it, the assistant takes the rest.
              const note = linked.length ? `The file${linked.length > 1 ? 's' : ''} ${linked.join(', ')} imported with the books ${linked.length > 1 ? 'are' : 'is'} linked to the data model but not joined yet.` : '';
              const text = [request.trim(), note].filter(Boolean).join(' ');
              if (text) handOver('report', reportId, text);
              setBooks(null); refresh(); navigate(`/studio/${reportId}`);
            })}
            declineLabel="Start from a blank report"
            onDecline={() => {
              const data = books;
              setBooks(null);
              run(async () => { const mid = await ensureModelForUpload(data, { workspaceId: currentWsKey, models }); await openStudio(mid, data.datasource.name); });
            }} />
        </Modal>
      )}
    </>
  );
}

// A question of the conversation, its answers as chips (none when the answer
// is a drop), in the look of the assistant's own questions.
function Question({ text, children }) {
  return (
    <div style={cardStyle}>
      <div style={rowStyle}>
        <TbHelpCircle size={16} style={iconStyle} />
        <div style={titleStyle}>{text}</div>
      </div>
      {children ? <div style={chipsStyle}>{children}</div> : null}
    </div>
  );
}

const warningStyle = { margin: '0 0 10px', padding: '8px 10px', borderRadius: 8, fontSize: 12.5, lineHeight: 1.45, color: 'var(--state-danger)', background: 'var(--bg-app)', border: '1px solid var(--border-default)' };
const noteStyle = (error) => ({ fontSize: 12.5, lineHeight: 1.45, color: error ? 'var(--state-danger)' : 'var(--text-secondary)' });
