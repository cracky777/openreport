import api from '../../utils/api';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TbSend, TbFileText, TbSparkles, TbMessageCircle, TbChevronRight, TbUpload, TbDatabase } from 'react-icons/tb';
import { useAuth } from '../../hooks/useAuth';
import { useGraph } from '../../hooks/graphContext';
import { useTheme } from '../../hooks/useTheme';
import { usePermissions } from '../../hooks/usePermissions';
import Modal from '../Modal/Modal';
import ImportFileList from '../FileImportDialog/ImportFileList';
import DatasourceForm from '../DatasourceForm/DatasourceForm';
import FecPackOffer from '../AccountingPack/FecPackOffer';
import { threadStyle, composerStyle, inputStyle, sendBtn } from './panelStyles';
import { useFileOptions, missingSheets } from '../../utils/importFiles';
import { uploadEach, mergeFecUploads, modelOnFiles } from '../../utils/multiFileImport';
import { ensureModelForUpload, setUpModelFromFiles, draftReportOn } from '../../utils/modelFromFiles';
import { handOver } from '../../utils/assistantHandoff';

// The conversation before a report exists: the studio's panel (AiPanel) shows
// it on `/chat`, where the assistant's thread will go on once the report is
// made. It opens on three cards, each opening on its second step: Continue a
// report (which one), Create a report (start from the beginning with dropped
// files, or from a data model of the workspace — one card, asked by Jonathan),
// and Let's Talk (which model), a conversation with no report
// (components/Talk/TalkConversation, held by the studio). A request typed
// without a card goes to Let's Talk, whose assistant answers a question with a
// visual and a report asked for with a report card.
// Files come by drag and drop only, anywhere on the studio (pages/AiStudio.jsx
// holds them): a file becomes its source, its model and a blank report here;
// several files become one model, joined by their column names; a company's
// books become the Finance package. Then the studio opens on the report, the
// request typed here handed to the assistant as its first message.

/**
 * @param {File[]} files        dropped on the studio, held there
 * @param {function} onFiles    the list after a removal
 * @param {function} onTalk     (modelId, question) => void: Let's Talk on that model
 */
// What the home says when there is nothing to pick from, or no assistant.
const ASSISTANT_NOTE = {
  setup: 'No AI assistant on this account yet: set up your provider with the button at the top of this panel. Files dropped here still become a model and a report without it.',
  disabled: 'The assistant is switched off on this instance: ask an administrator. Files dropped here still become a model and a report.',
  denied: 'The assistant is not available for this account: ask an administrator. Files dropped here still become a model and a report.',
};

export default function StartConversation({ files, onFiles, aiStatus = null, onTalk = null }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { resolved: themeResolved, themes } = useTheme();
  const { scopedModels, scopedReports, models, selectedWs, currentWsKey, currentWsRole, refresh } = useGraph();
  const { canEdit } = usePermissions(selectedWs, user, currentWsRole);
  const fileOptions = useFileOptions();

  const [request, setRequest] = useState('');
  const [choice, setChoice] = useState(null); // 'report' | 'create' | 'talk': the card open
  const [status, setStatus] = useState({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null); // { text, error }
  const [books, setBooks] = useState(null); // books uploaded: the Finance package is offered first
  // A database instead of files (Jonathan): the usual connection form, then the
  // studio at once — in Chat, never the model editor. An empty model on the
  // database and a draft report on it; the model assistant there picks the
  // tables, joins them and sets their roles, and the report goes on with the
  // request once the model is in ('reportModel', AiPanel `initialModelRequest`).
  const [connecting, setConnecting] = useState(false);
  const canConnect = currentWsRole === 'admin';
  const startOnDatabase = (datasource) => run(async () => {
    const name = datasource.name || 'Database';
    let created = null;
    for (const n of [name, `${name} (2)`, `${name} (3)`]) {
      try { created = (await api.post('/models', { name: n, datasourceId: datasource.id, description: '', ...(currentWsKey ? { workspaceId: currentWsKey } : {}) })).data.model; break; } catch (err) { if (err.response?.status !== 409) throw err; }
    }
    if (!created) throw new Error('A data model with this name already exists');
    refresh();
    const id = await draftReportOn(created.id, { autoTitle: true, workspaceId: selectedWs || undefined, theme, ownsModel: true });
    handOver('reportModel', id, request.trim() || 'Build a first report on this data.');
    navigate(`/studio/${id}`);
  });

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

  // Send: with files, the import. A request typed without a card picked is a
  // conversation (Let's Talk) — which answers a question with a visual and a
  // report asked for with a report card: the assistant reads the request, the
  // page never does. In a card, it goes with what is picked there.
  const send = () => {
    if (busy) return;
    if (files.length) { importAndBuild(); return; }
    const text = request.trim();
    if (!text) return;
    const ask = (msg) => setNote({ text: msg });
    if (way === 'report') { ask('Pick the report above: your request goes with it.'); return; }
    if (way !== 'create' && canTalk) {
      if (scopedModels.length === 1) { onTalk(scopedModels[0].id, text); return; }
      setChoice('talk');
      ask('Which data model is your question about? Pick it above.');
      return;
    }
    if (scopedModels.length === 1) { run(() => openStudio(scopedModels[0].id, scopedModels[0].name)); return; }
    ask(scopedModels.length ? 'Drop your files, or pick the data model above: your request goes with it.' : 'Drop your files anywhere on this page: your request goes with them.');
    if (canEdit) setChoice('create');
  };

  const startOn = (m) => run(() => openStudio(m.id, m.name));
  const noSheet = missingSheets(files, fileOptions.optionsFor);

  // The first question, as three cards: continue a report of the workspace,
  // create one — from dropped files or from a data model of the workspace,
  // one intent whatever the source — or a conversation about a model (Let's
  // Talk). The card picked opens on its second step; a single card is open
  // from the start.
  const canTalk = !!onTalk && !!aiStatus?.enabled && canEdit && scopedModels.length > 0;
  const ways = [
    ...(scopedReports.length ? [{ key: 'report', icon: TbFileText, label: 'Continue a report', sub: 'Pick up where you left off' }] : []),
    ...(canEdit ? [{ key: 'create', icon: TbSparkles, label: 'Create a report', sub: currentWsRole === 'admin' ? (scopedModels.length ? 'From your files, a database or a data model' : 'From your files or a database') : (scopedModels.length ? 'From your files or a data model' : 'From your files') }] : []),
    // A conversation needs the assistant itself: no provider, no talk.
    ...(canTalk ? [{ key: 'talk', icon: TbMessageCircle, label: "Let's Talk", sub: 'Ask your data anything, no report needed' }] : []),
  ];
  const way = ways.some((w) => w.key === choice) ? choice : (ways.length === 1 ? ways[0].key : null);
  const ready = !busy && !noSheet && (files.length > 0 || !!request.trim());
  const talking = way === 'talk' || (!way && canTalk);
  const sendLabel = busy ? 'Working…' : files.length ? (files.length > 1 ? `Import ${files.length} files` : 'Import and build') : (talking ? 'Ask' : 'Build it');

  // The request goes with the report picked: the studio's first message.
  const continueReport = (r) => {
    if (canEdit && request.trim()) handOver('report', r.id, request.trim());
    navigate(canEdit ? `/studio/${r.id}` : `/view/${r.id}`);
  };

  // The second step of each card.
  const stepOf = (key) => {
    if (key === 'report') {
      return <Picks label="Which report?" items={scopedReports.map((r) => ({ id: r.id, name: r.title }))} busy={busy} onPick={continueReport} />;
    }
    if (key === 'talk') {
      return <Picks label="Which data model shall we talk about?" items={scopedModels} busy={busy} onPick={(m) => onTalk(m.id, request.trim())} />;
    }
    return (
      <div style={sourcesStyle}>
        <div style={dropTileStyle}>
          <TbUpload size={20} style={tileIconStyle} />
          <div style={{ minWidth: 0 }}>
            <div style={tileTitleStyle}>Start from the beginning</div>
            <div style={tileSubStyle}>Drop your files anywhere on this page: CSV, Excel, Parquet, JSON, accounting books.</div>
          </div>
        </div>
        {canConnect && (
          <button type="button" style={connectTileStyle} onClick={() => setConnecting(true)} disabled={busy}>
            <TbDatabase size={20} style={tileIconStyle} />
            <span style={{ minWidth: 0 }}>
              <span style={{ ...tileTitleStyle, display: 'block' }}>Connect a database</span>
              <span style={{ ...tileSubStyle, display: 'block' }}>PostgreSQL, MySQL, BigQuery, DuckDB…: the assistant then picks the tables and joins them, here in the conversation, and builds the report on them.</span>
            </span>
          </button>
        )}
        {connecting && (
          <Modal onClose={() => setConnecting(false)} width={560}>
            <DatasourceForm
              workspaceId={currentWsKey}
              onSaved={({ datasource }) => { setConnecting(false); startOnDatabase(datasource); }}
              onCancel={() => setConnecting(false)}
            />
          </Modal>
        )}
        {scopedModels.length > 0 && (
          <Picks label="Or create it from a data model" items={scopedModels} busy={busy} onPick={startOn} />
        )}
      </div>
    );
  };

  return (
    <>
      <div style={threadStyle}>
        {aiStatus && !aiStatus.enabled && <div style={noteStyle(false)}>{ASSISTANT_NOTE[aiStatus.reason] || ASSISTANT_NOTE.disabled}</div>}
        {!files.length && !ways.length && <div style={noteStyle(false)}>{canEdit ? 'Nothing to start from in this workspace yet: drop your files anywhere on this page.' : 'Nothing to continue in this workspace: ask its editors for a report, or pick another workspace at the top.'}</div>}
        {!files.length && ways.length > 0 && (
          <div style={waysStyle}>
            {ways.map((w) => {
              const open = way === w.key;
              const Icon = w.icon;
              return (
                <div key={w.key} style={wayCard(open)}>
                  <button type="button" style={wayHead} onClick={() => { setNote(null); setChoice(open && ways.length > 1 ? null : w.key); }} disabled={busy} aria-expanded={open}>
                    <span style={wayIcon(open)}><Icon size={18} /></span>
                    <span style={wayText}>
                      <span style={wayTitle}>{w.label}</span>
                      <span style={waySub}>{w.sub}</span>
                    </span>
                    <TbChevronRight size={16} style={chevron(open)} />
                  </button>
                  {open && <div style={wayBody}>{stepOf(w.key)}</div>}
                </div>
              );
            })}
          </div>
        )}
        {files.length > 0 && (
          <ImportFileList files={files} options={fileOptions} status={status} busy={busy}
            onRemove={busy ? null : (i) => { onFiles(files.filter((_, k) => k !== i)); setStatus({}); setNote(null); }} />
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
            placeholder={files.length ? 'What should the report show?' : talking ? 'Ask, or describe a report…' : 'A sales dashboard by region and month…'}
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

// A list to pick from, inside a card: reports or data models, one row each.
function Picks({ label, items, busy, onPick }) {
  return (
    <div style={picksStyle}>
      <div style={picksLabel}>{label}</div>
      <div style={picksList}>
        {items.map((it) => (
          <button key={it.id} type="button" style={pickRow} onClick={() => onPick(it)} disabled={busy}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            title={it.name}
          >{it.name}</button>
        ))}
      </div>
    </div>
  );
}

// The panel's thread and the lists scroll: nothing in them may shrink to fit.
const waysStyle = { display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0 };
const wayCard = (open) => ({
  flexShrink: 0,
  borderRadius: 14, background: 'var(--bg-panel)', overflow: 'hidden',
  border: `1px solid ${open ? 'var(--accent-primary)' : 'var(--border-default)'}`,
  boxShadow: open ? '0 4px 16px -8px rgba(124, 58, 237, 0.35)' : '0 1px 2px rgba(15,23,42,0.05)',
  transition: 'border-color 0.15s, box-shadow 0.15s',
});
const wayHead = {
  display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: 14, textAlign: 'left',
  border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', color: 'inherit',
};
const wayIcon = (open) => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, width: 36, height: 36, borderRadius: 10,
  color: open ? '#fff' : 'var(--accent-primary)',
  background: open ? 'linear-gradient(135deg, var(--accent-primary) 0%, #c026d3 100%)' : 'var(--accent-primary-soft)',
});
const wayText = { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 };
const wayTitle = { fontSize: 14, fontWeight: 650, color: 'var(--text-primary)', letterSpacing: '-0.01em' };
const waySub = { fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.35 };
const chevron = (open) => ({ flexShrink: 0, color: 'var(--text-muted)', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' });
const wayBody = { padding: '0 14px 14px' };
const sourcesStyle = { display: 'flex', flexDirection: 'column', gap: 12 };
const dropTileStyle = {
  display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
  borderRadius: 10, border: '1.5px dashed var(--border-strong)', background: 'var(--bg-app)',
};
const tileIconStyle = { flexShrink: 0, color: 'var(--accent-primary)' };
const connectTileStyle = {
  display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', width: '100%', textAlign: 'left',
  borderRadius: 10, border: '1px solid var(--border-default)', background: 'var(--bg-app)', cursor: 'pointer', fontFamily: 'inherit',
};
const tileTitleStyle = { fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' };
const tileSubStyle = { fontSize: 11.5, lineHeight: 1.4, color: 'var(--text-muted)' };
const picksStyle = { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 };
const picksLabel = { fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase' };
const picksList = { display: 'flex', flexDirection: 'column', maxHeight: 220, overflowY: 'auto', borderRadius: 10, border: '1px solid var(--border-default)', background: 'var(--bg-app)' };
const pickRow = {
  flexShrink: 0,
  padding: '8px 12px', fontSize: 13, textAlign: 'left', border: 'none', borderBottom: '1px solid var(--border-default)',
  background: 'transparent', color: 'var(--text-primary)', cursor: 'pointer', fontFamily: 'inherit',
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
};
const warningStyle = { margin: '0 0 10px', padding: '8px 10px', borderRadius: 8, fontSize: 12.5, lineHeight: 1.45, color: 'var(--state-danger)', background: 'var(--bg-app)', border: '1px solid var(--border-default)' };
const noteStyle = (error) => ({ fontSize: 12.5, lineHeight: 1.45, color: error ? 'var(--state-danger)' : 'var(--text-secondary)' });
