import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { TbSparkles, TbChevronsRight, TbSend, TbPlayerStop, TbRefresh, TbSchema, TbSettings, TbArrowBackUp, TbX, TbLoader2, TbEye } from 'react-icons/tb';
import RobotHead from '../RobotHead';
import api from '../../utils/api';
import { imageColors } from '../../utils/imageColors';
import { toast } from '../Toast/toast';
import AddImageCard from './AddImageCard';
import SlidingDock from '../SlidingDock/SlidingDock';
import AssistantStrip from '../Ask/AssistantStrip';
import { useResizableWidth } from '../../hooks/useResizableWidth';
import { useIsCompact } from '../../hooks/useMediaQuery';
import { studioThreadKey } from '../../utils/studioThread';
import { useAiChat } from '../../hooks/useAiChat';
import { useModelAssistant } from '../../hooks/useModelAssistant';
import ProposalCard from './ProposalCard';
import ActionCard from './ActionCard';
import AddFileCard from './AddFileCard';
import { acceptFiles } from '../../utils/importFiles';
import QuestionCard from './QuestionCard';
import ReportPagesCard from './ReportPagesCard';
import ReportChangesCard from './ReportChangesCard';
import AssistantText from './AssistantText';
import LineageCard from './LineageCard';
import PersonalProvider from './PersonalProvider';
import Suggestions from './Suggestions';
import ModelProposalCard from '../ModelAssistant/ModelProposalCard';
import ShapeProposalCard from '../ModelAssistant/ShapeProposalCard';
import { threadStyle, composerStyle, inputStyle, sendBtn, userBubble, assistantBlock, assistantText, thinkingStyle } from './panelStyles';
import { cardStyle, rowStyle, iconStyle, titleStyle, subStyle, actionsStyle, quietBtn, applyBtn } from './actionCardStyles';

// Border-box: its dock (SlidingDock) is exactly `width` wide, padding included.
const buildReportBtn = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, width: '100%', padding: '10px 12px', marginBottom: 12,
  fontSize: 13, fontWeight: 600, borderRadius: 8, border: 'none', cursor: 'pointer', color: '#fff', background: 'var(--accent-primary)',
};
// The images added to the conversation, as chips over the composer; the
// button that adds one sits at the composer's left, like a paperclip.
const assetsRow = { display: 'flex', flexWrap: 'wrap', gap: 6, padding: '0 0 6px' };
const assetChip = { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, padding: '2px 6px', borderRadius: 10, background: 'var(--bg-panel)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' };
const assetRemove = { border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, display: 'inline-flex', color: 'var(--text-muted)' };
const panelStyle = {
  backgroundColor: 'var(--bg-panel-alt)', borderLeft: '1px solid var(--border-default)',
  padding: 12, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative', boxSizing: 'border-box',
};
const headerStyle = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
  marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid var(--border-default)',
};
// The same title as the Assistant panel of the journey (Ask/AskPanel): one
// assistant, one face, whichever screen it is opened from.
const headerTitleStyle = {
  display: 'inline-flex', alignItems: 'center', gap: 10,
  fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.01em',
};
const headerActionsStyle = { display: 'flex', gap: 4 };
const iconBtn = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, padding: 0,
  color: 'var(--text-muted)', background: 'var(--bg-panel)', border: '1px solid var(--border-default)',
  borderRadius: 6, cursor: 'pointer',
};
const chatStyle = { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' };
const hiddenStyle = { display: 'none' };
// Who answered, when it is not the report's assistant.
const engineTag = { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-muted)' };
// A request passed from one assistant to the other, without a card to click.
const handedStyle = { fontSize: 11, fontStyle: 'italic', color: 'var(--text-muted)' };
const busyRow = { display: 'flex', alignItems: 'center', gap: 6 };

// A turn still running: the words and a ring that turns, so a long turn (a
// review that captures every page) does not read as a stalled panel.
function Busy({ text }) {
  return (
    <div role="status" style={{ ...thinkingStyle, ...busyRow }}>
      <TbLoader2 size={13} className="spin" aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}
// The composer's target: the report (default) or, pressed, the data model.
const targetBtn = (pressed) => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, padding: 0, flexShrink: 0,
  color: pressed ? '#fff' : 'var(--text-muted)', background: pressed ? 'var(--accent-primary)' : 'var(--bg-panel)',
  border: '1px solid var(--border-default)', borderRadius: 8, cursor: 'pointer',
});

// One conversation for everything the author may ask beside a report: a
// visual, a change of the report, its look, and — in the studio, for who may
// change it — the data model. The request says which assistant answers; the
// author no longer picks a tab first (asked by Jonathan). The report's
// assistant takes every message unless the target button is pressed; what
// belongs to the model is passed on to the model assistant by itself, and
// the other way round, one hop at most — then the card stays, for the author.
const PLACEHOLDER = 'Ask for a visual, a change, or the look of the page…';
const MODEL_PLACEHOLDER = 'Join the tables, flag the columns…';
const EXAMPLES = ['Which categories drive revenue?', 'Show the monthly trend of the main measure', 'Rearrange this page so the key figure stands out', 'Use one consistent color palette across the page'];
const LEARN = ['How do I filter the whole page?', 'How do I change the theme of the report?', 'How do I share this report?'];
const MODEL_EXAMPLES = ['Identify the relationships between the tables', 'Join the tables and flag the dimensions and measures', 'Which tables are facts, which are dimensions?'];
const MODEL_LEARN = ['What is the difference between a dimension and a measure?'];

// What leaves the instance, kept one hover away on the panel's title rather
// than printed under every conversation.
const SHARING = {
  'schema+cache': 'Reads this report\'s cached data only — never the live source. Field names and cached rows are sent to your AI provider.',
  schema: 'Schema only — no data is shared. Field names are sent to your AI provider.',
  // Here, beside a report, it reads the cache as at 'schema+cache': the live read is Let's Talk's.
  'schema+results': "Reads this report's cached data only — never the live source. Field names and cached rows are sent to your AI provider.",
};

// The model assistant's way out when what was asked belongs to the report:
// shown only when the request already came from the report's assistant
// (nobody takes it), else the request is passed on by itself.
function HandOverCard({ proposal, onOutcome, onHandOver }) {
  const [state, setState] = useState('open'); // open | applied | dismissed
  const finish = (next) => { setState(next); onOutcome?.(next); };
  if (state === 'dismissed') return <div style={subStyle}>Dismissed</div>;
  return (
    <div style={cardStyle}>
      <div style={rowStyle}>
        <RobotHead size={20} style={iconStyle} />
        <div style={{ minWidth: 0 }}>
          <div style={titleStyle}>For the report assistant</div>
          <div style={subStyle}>{proposal.summary || 'This belongs to the report: its assistant can do it.'}</div>
        </div>
      </div>
      <div style={actionsStyle}>
        <button style={quietBtn} onClick={() => finish('dismissed')}>Dismiss</button>
        <button style={applyBtn(true)} onClick={() => { onHandOver(proposal.request); finish('applied'); }}>
          <TbSparkles size={14} /> {state === 'applied' ? 'Ask again' : 'Ask the report assistant'}
        </button>
      </div>
    </div>
  );
}

const handOverIn = (reply, action) => (reply?.proposals || []).findIndex((p) => p.kind === 'action' && p.action === action && p.request);

/**
 * @param {boolean} open    wide screens: the panel, or its bar docked on the right edge
 * @param {function} onOpen the bar was clicked
 * @param {{text: string, at: number}} ask  a question asked from the canvas ("Suggest"), once per `at`
 * @param {boolean} studio  the AI studio (pages/AiStudio.jsx): the panel sits on the left of the report, always open,
 *                          and may be handed a whole report (pages) besides visuals and design changes
 * @param {function} [onModelChanged]  a card changed the data model (a file added to it, the model assistant): the screen reads it again
 * @param {string} [modelId]           the report's data model: the model assistant talks about it
 * @param {boolean} [modelEditable]    this user may change the data model: the model assistant joins the conversation (studio only)
 * @param {ReactNode} children  with no `reportId`, the conversation the panel holds instead of the assistant's
 *                              thread: the one that leads to a report (StartConversation, the studio on `/chat`)
 */
// The assistant's own verdict on a change it reviewed: worse, and nothing to
// propose instead — the author is offered to take it back (the studio's undo).
function UndoCard({ proposal, onOutcome, onUndo }) {
  const [state, setState] = useState('open'); // open | applied | dismissed
  const finish = (next) => { setState(next); onOutcome?.(next); };
  if (state === 'dismissed') return <div style={subStyle}>Kept as it is</div>;
  return (
    <div style={cardStyle}>
      <div style={rowStyle}>
        <TbArrowBackUp size={18} style={iconStyle} />
        <div style={{ minWidth: 0 }}>
          <div style={titleStyle}>This change made the page worse</div>
          <div style={subStyle}>{proposal.reason || 'The assistant suggests taking it back.'}</div>
        </div>
      </div>
      <div style={actionsStyle}>
        <button style={quietBtn} onClick={() => finish('dismissed')} disabled={state === 'applied'}>Keep it</button>
        <button style={applyBtn(state !== 'applied')} onClick={() => { onUndo?.(); finish('applied'); }} disabled={state === 'applied' || !onUndo}>
          <TbArrowBackUp size={14} /> {state === 'applied' ? 'Taken back' : 'Undo the change'}
        </button>
      </div>
    </div>
  );
}

export default function AiPanel({ reportId, model, widgets, settings, status, onStatusChange, getPageContext, onApplyProposal, onUndo = null, onClose, onResizeStart, onResizeEnd, initialRequest = '', initialModelRequest = '', open = true, onOpen, ask, studio = false, onModelChanged, modelId = null, modelEditable = false, reportEmpty = false, children = null }) {
  const [dragging, setDragging] = useState(false);
  const { width, handleProps } = useResizableWidth(studio
    ? { storageKey: 'openreport.studioPanelWidth', defaultWidth: 420, min: 320, max: 680, side: 'left', onDragStart: () => setDragging(true), onDragEnd: () => setDragging(false) }
    : {
      storageKey: 'openreport.aiPanelWidth', defaultWidth: 300, min: 260, max: 520,
      onDragStart: () => { setDragging(true); onResizeStart?.(); },
      onDragEnd: () => { setDragging(false); onResizeEnd?.(); },
    });
  const compact = useIsCompact();
  // Images the user added to the conversation (a logo), uploaded here and
  // named to the assistant with every request: it places them by name, the
  // server only accepts those names. Asked by Jonathan: a logo from the chat.
  const [assets, setAssets] = useState([]);
  // Read through a ref: the card that took the drop sends the next message at
  // once, before the state has rendered — the request must still carry it.
  const assetsRef = useRef([]);
  const getExtraBody = useCallback(() => ({ pageContext: getPageContext(), ...(studio ? { studio: true } : {}), ...(assetsRef.current.length ? { assets: assetsRef.current } : {}) }), [getPageContext, studio]);
  const keepAssets = (next) => { assetsRef.current = next; setAssets(next); };
  const addImages = async (files) => {
    const added = [];
    for (const file of Array.from(files || []).filter((f) => f.type.startsWith('image/'))) {
      const form = new FormData();
      form.append('image', file);
      try {
        const [{ data }, colors] = await Promise.all([
          api.post('/images', form, { headers: { 'Content-Type': 'multipart/form-data' } }),
          imageColors(file),
        ]);
        // Its colors go along, read here: the assistant offers them as the report's, on a card.
        keepAssets([...assetsRef.current.filter((a) => a.name !== file.name), { name: file.name, url: data.url, ...(colors.length ? { colors } : {}) }]);
        added.push(file.name);
      } catch (err) {
        toast(err.response?.data?.error || `${file.name} could not be uploaded`);
      }
    }
    if (added.length) toast(`Image ${added.join(', ')} added: tell the assistant where it goes`);
    return added;
  };
  const draggingFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
  // The studio keeps its thread for the tab: back from the editor, it is still there.
  const keep = studio && reportId ? studioThreadKey(reportId) : undefined;
  const report = useAiChat(`/ai/reports/${reportId}/chat`, getExtraBody, keep);
  // The model assistant, in the same conversation: studio only, for who may change the model.
  const withModel = studio && modelEditable && !!modelId;
  // Data files dropped in the middle of the conversation (Jonathan: the card
  // only came when the assistant asked for it): each drop opens the card that
  // adds them to the model, as the assistant's own would.
  const [droppedFiles, setDroppedFiles] = useState([]);
  const dropFiles = (picked) => {
    addImages(picked);
    const data = acceptFiles([], picked);
    if (!data.length) return;
    if (!withModel) { toast('Data files join the model from the assistant of a report you can edit'); return; }
    setDroppedFiles((prev) => [...prev, { key: Date.now(), files: data }]);
  };
  const modelChat = useModelAssistant({ modelId: withModel ? modelId : null, onModelChanged, keepKey: keep && `${keep}.model` });
  const [draft, setDraft] = useState('');
  const [toModel, setToModel] = useState(false);
  // The instance has no provider: the user brings their own, first thing in
  // the panel, and may come back to it from the header afterwards.
  const [editingProvider, setEditingProvider] = useState(false);
  // Before a report exists the conversation needs no provider (files become a
  // report without one): the form waits behind its button until then.
  const needsSetup = status.reason === 'setup' && !!reportId;
  const showProvider = (needsSetup || editingProvider) && !!status.personal;
  const dataSharing = status.dataSharing;
  const threadRef = useRef(null);

  // The two assistants' turns, as one thread, in the order they happened.
  const thread = useMemo(() => [
    ...report.messages.map((m, idx) => ({ ...m, engine: 'report', idx })),
    ...(withModel ? modelChat.messages.map((m, idx) => ({ ...m, engine: 'model', idx })) : []),
  ].sort((a, b) => (a.at || 0) - (b.at || 0)), [report.messages, modelChat.messages, withModel]);
  const busy = report.loading || modelChat.loading || !!modelChat.applying;

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread, busy]);

  // A request handed from one assistant to the other goes one hop: the
  // second assistant's own hand-over stays a card, or two of them would pass
  // a request back and forth.
  const hopsRef = useRef(0);
  // What the report waits for while the model assistant joins the data (see applyModel).
  const waitingRef = useRef(null);
  const sendToReport = async (text, extra) => {
    const reply = await report.send(text, extra);
    if (!reply) return false;
    const j = handOverIn(reply, 'open_model_assistant');
    if (j >= 0 && withModel && hopsRef.current < 1) {
      hopsRef.current += 1;
      report.mark(reply.answerId, { handed: j });
      // Handed over because the data was not joined: once the joins are
      // applied, the report goes on (the insurer's claims and contracts).
      waitingRef.current = waitingRef.current || true;
      await sendToModel(reply.proposals[j].request, { fresh: true });
    }
    return reply;
  };
  const sendToModel = async (text, opts) => {
    const reply = await modelChat.send(text, opts);
    if (!reply) return false;
    const j = handOverIn(reply, 'open_report_assistant');
    if (j >= 0 && hopsRef.current < 1) {
      hopsRef.current += 1;
      modelChat.mark(reply.answerId, { handed: j });
      await sendToReport(reply.proposals[j].request);
    }
    return reply;
  };
  // A card of this thread sends a request to the model assistant (a file
  // added with no join found; the model card the author presses by hand).
  // `request`: what the user wanted from the report once the data is in. It
  // waits until the model assistant's joins are applied, then goes back to
  // the report's assistant — Karim had to type it again.
  const askModel = (text, request) => { hopsRef.current = 0; waitingRef.current = request || null; return sendToModel(text, { fresh: true }); };
  const resumeReport = () => {
    const request = waitingRef.current;
    waitingRef.current = null;
    resumeRef.current = null;
    hopsRef.current = 0;
    sendToReport(request === true ? 'The data is joined in the model now. Go on with my request above.' : `The new data is joined to the model now. Go on with my request: ${request}`);
  };
  // Tables added: the model assistant goes on first (its CONTINUE), and the
  // report waits until THAT turn — a reply after the card, not the one that
  // carried it — ends with no card left to apply. Holds the thread's length then.
  const resumeRef = useRef(null);
  const applyModel = async (proposal) => {
    const ok = await modelChat.apply(proposal);
    if (ok && waitingRef.current && (proposal.addTables || []).length) resumeRef.current = modelChat.messages.length;
    // Joins only: the data is in.
    else if (ok && waitingRef.current && (proposal.joins || []).length) resumeReport();
    return ok;
  };
  useEffect(() => {
    if (resumeRef.current === null || modelChat.loading || modelChat.applying) return;
    // Its CONTINUE and the answer to it: until both are in, the model is still at work.
    if (modelChat.messages.length < resumeRef.current + 2) return;
    const last = modelChat.messages[modelChat.messages.length - 1];
    if (!last || last.role !== 'assistant') return;
    const waiting = (last.proposals || []).some((p, j) => ['model', 'shape'].includes(p.kind) && !last.outcomes?.[j]);
    if (!waiting) resumeReport();
  }, [modelChat.messages, modelChat.loading, modelChat.applying]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (text, extra) => {
    const question = (text ?? draft).trim();
    if (!question || busy) return;
    setDraft('');
    hopsRef.current = 0;
    // A new request: the offer to review the last change no longer stands.
    setPendingReview(null);
    // A failed turn hands the question back so it can be re-sent as is.
    const sent = toModel && withModel ? await sendToModel(question, { fresh: true }) : await sendToReport(question, extra);
    if (!sent) setDraft(question);
  };
  // The studio's one-click whole report: a button, which no reading of the
  // words can turn into a single visual (the server refuses anything else).
  const buildReport = () => submit('Build the full report on this model', { intent: 'report' });
  const reset = () => { report.reset(); modelChat.reset(); };

  // A request described before the report existed (the empty Reports stage) is
  // asked right away: the user already pressed the button that says so. Until a
  // provider is set it waits in the box. Once only — StrictMode runs effects twice.
  const askedInitialRef = useRef(false);
  useEffect(() => {
    if (!initialRequest || askedInitialRef.current) return;
    if (status.enabled) {
      askedInitialRef.current = true;
      submit(initialRequest);
    } else if (status.reason === 'setup') {
      setDraft(initialRequest);
    }
  }, [initialRequest, status.enabled, status.reason]); // eslint-disable-line react-hooks/exhaustive-deps

  // A report on a database just connected (Chat home): the model is empty, so
  // its assistant goes first — the tables, their joins and roles — and the
  // report takes the request once the model is in (resumeRef, applyModel).
  const askedModelRef = useRef(false);
  useEffect(() => {
    if (!initialModelRequest || askedModelRef.current || !status.enabled || !withModel) return;
    askedModelRef.current = true;
    askModel(`This data model is new and empty, on a database just connected. Pick the tables that matter for what I want, add them with their joins, the role of each table (fact or dimension) and the fields. What I want: ${initialModelRequest}`, initialModelRequest);
  }, [initialModelRequest, status.enabled, withModel]); // eslint-disable-line react-hooks/exhaustive-deps

  const askedAtRef = useRef(0);
  useEffect(() => {
    if (!ask || askedAtRef.current === ask.at || !status.enabled || busy) return;
    askedAtRef.current = ask.at;
    report.send(ask.text);
  }, [ask, status.enabled, busy, report]);

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const style = compact
    ? { ...panelStyle, width: '100%', borderLeft: 'none', height: '100%' }
    : studio
      ? { ...panelStyle, width, maxWidth: width, borderLeft: 'none', borderRight: '1px solid var(--border-default)', height: '100%' }
      : { ...panelStyle, width, maxWidth: width };

  // A card applied on the page: the studio hands back the page before and
  // after, and the assistant is asked to look at what it did (a review turn:
  // words, a corrected proposal, or an offer to undo).
  //
  // The designer's look of a report just built goes at once (it is the
  // report's first look). Any other review waits for the author: asked by
  // Jonathan, the designer is relaunched only when they want it — a review
  // that always follows turned one request into a string of cards.
  const [pendingReview, setPendingReview] = useState(null);
  const [capturing, setCapturing] = useState(false);
  const sendReview = (review) => report.send(review.of === 'report' ? 'Give the report its look.' : 'Review the change.', { images: review.images, ...(review.of ? { reviewOf: review.of } : {}), ...(review.sheet ? { reviewSheet: true } : {}) });
  const applyAndReview = async (proposal) => {
    const result = await onApplyProposal(proposal);
    if (result?.review?.images) {
      if (result.review.of === 'report') sendReview(result.review);
      else setPendingReview(result.review);
    }
    return result;
  };
  // Asked for: the studio completes the pictures first (every page in small
  // when the change reached several), then the designer looks.
  const reviewNow = async () => {
    const review = pendingReview;
    setPendingReview(null);
    if (!review) return;
    setCapturing(true);
    try {
      sendReview({ ...review, ...(review.complete ? await review.complete() : {}) });
    } finally {
      setCapturing(false);
    }
  };

  // A report Let's Talk proposed, laid here as its card (utils/studioThread
  // seedStudioThread): applied once the studio has drawn the report, then
  // the designer gives it its look — as a report built here would be.
  const autoApplied = useRef(false);
  useEffect(() => {
    if (!studio || autoApplied.current) return undefined;
    const idx = report.messages.findIndex((m) => m.autoApply && m.proposals?.[0]?.kind === 'report' && !m.outcomes?.[0]);
    if (idx < 0) return undefined;
    autoApplied.current = true;
    const m = report.messages[idx];
    let fired = false;
    const timer = setTimeout(async () => {
      fired = true;
      const result = await applyAndReview(m.proposals[0]);
      report.setOutcome(idx, 0, result ? 'applied' : undefined);
      report.mark(m.answerId, { autoApply: false });
    }, 600);
    // Left before it ran: the next render tries again.
    return () => { if (!fired) { clearTimeout(timer); autoApplied.current = false; } };
    // Once, on the thread the studio opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studio, report.messages.length]);

  const reportCard = (m, p, j) => {
    const outcome = (o) => report.setOutcome(m.idx, j, o);
    if (p.kind === 'undo') return <UndoCard key={j} proposal={p} onOutcome={outcome} onUndo={onUndo} />;
    if (p.kind === 'action') {
      if (m.handed === j) return <div key={j} style={handedStyle}>Handed to the data model assistant.</div>;
      if (p.action === 'add_image') return <AddImageCard key={j} proposal={p} onOutcome={outcome} onAddImage={addImages} onAnswer={(text) => submit(text)} />;
      return <ActionCard key={j} proposal={p} reportId={reportId} onOutcome={outcome} onAnswer={(text) => submit(text)} onModelChanged={onModelChanged} onAskModel={withModel ? askModel : undefined} />;
    }
    if (p.kind === 'report') return <ReportPagesCard key={`${j}-${m.outcomes?.[j] || ''}`} proposal={p} model={model} onApply={applyAndReview} onOutcome={outcome} outcome={m.outcomes?.[j]} />;
    if (p.kind === 'reportChanges') return <ReportChangesCard key={j} proposal={p} widgets={widgets} onApply={applyAndReview} onOutcome={outcome} />;
    if (p.kind === 'question') {
      return <QuestionCard key={j} proposal={p} modelId={model?.id} answered={m.outcomes?.[j] === 'answered' ? report.messages[m.idx + 1]?.text : ''} onOutcome={outcome} onAnswer={(text) => submit(text)} />;
    }
    return <ProposalCard key={j} proposal={p} model={model} widgets={widgets} reportId={reportId} settings={settings} onApply={applyAndReview} onOutcome={outcome} />;
  };
  const modelCard = (m, p, j) => {
    const outcome = (o) => modelChat.setOutcome(m.idx, j, o);
    if (p.kind === 'shape') return <ShapeProposalCard key={j} proposal={p} onApply={modelChat.applyShape} onOutcome={outcome} />;
    if (p.kind === 'action') {
      if (m.handed === j) return <div key={j} style={handedStyle}>Handed to the report assistant.</div>;
      return <HandOverCard key={j} proposal={p} onOutcome={outcome} onHandOver={(text) => { hopsRef.current = 0; sendToReport(text); }} />;
    }
    return <ModelProposalCard key={j} proposal={p} saved onApply={applyModel} onOutcome={outcome} />;
  };

  const panel = (
    <div style={style}>
      {!compact && <div {...handleProps} />}
      <div style={headerStyle}>
        <span style={headerTitleStyle} title={SHARING[dataSharing] || SHARING.schema}><RobotHead size={26} /> Assistant</span>
        <span style={headerActionsStyle}>
          {(status.source === 'personal' || (!reportId && !!status.personal)) && (
            <button style={iconBtn} onClick={() => setEditingProvider((v) => !v)} title="Your AI provider" aria-label="Your AI provider"><TbSettings size={13} /></button>
          )}
          {thread.length > 0 && (
            <button style={iconBtn} onClick={reset} title="New conversation" aria-label="New conversation"><TbRefresh size={13} /></button>
          )}
          {!compact && !studio && (
            <button style={iconBtn} onClick={onClose} title="Collapse assistant" aria-label="Close assistant"><TbChevronsRight size={14} /></button>
          )}
        </span>
      </div>

      {showProvider && (
        // Keyed by what is saved, so the form starts from it again after a save or a removal.
        <PersonalProvider
          key={`${status.personal.provider}|${status.personal.baseUrl}|${status.personal.model}|${status.personal.hasApiKey}`}
          personal={status.personal}
          onSaved={async () => { await onStatusChange(); setEditingProvider(false); }}
          onCancel={needsSetup ? null : () => setEditingProvider(false)}
        />
      )}

      {/* The conversation stays mounted behind the provider form: opening the
          settings must not cost the author their thread. */}
      {/* An image dropped anywhere on the conversation joins it (no button:
          like the files of the Chat home, asked by Jonathan); a data file
          opens the card that adds it to the model. */}
      <div style={showProvider ? hiddenStyle : chatStyle} onDragOver={(e) => { if (draggingFiles(e)) e.preventDefault(); }} onDrop={(e) => { if (!draggingFiles(e)) return; e.preventDefault(); dropFiles(e.dataTransfer.files); }}>
      {reportId ? (<>
      <div ref={threadRef} style={threadStyle}>
        {/* A whole report for a report still empty: on one with pages it would
            rebuild over the author's work (typed, "redo the whole report" still works). */}
        {thread.length === 0 && studio && !toModel && reportEmpty && (
          <button type="button" style={buildReportBtn} onClick={buildReport} disabled={busy} title="One page per objective the model can draw, laid out and saved into this report">
            <TbSparkles size={14} /> Build the full report
          </button>
        )}
        {thread.length === 0 && (
          <Suggestions dense onPick={submit} groups={toModel && withModel
            ? [{ label: 'Try', items: MODEL_EXAMPLES }, { label: 'Learn the tool', items: MODEL_LEARN }]
            : [{ label: 'Try', items: EXAMPLES }, { label: 'Learn the tool', items: LEARN }]} />
        )}
        {thread.map((m) => (m.role === 'user' ? (
          m.review
            ? <div key={`${m.engine}-${m.idx}`} style={handedStyle}>Looked at the page after the change.</div>
            : <div key={`${m.engine}-${m.idx}`} style={userBubble}>{m.text}</div>
        ) : (
          <div key={`${m.engine}-${m.idx}`} style={assistantBlock}>
            {m.engine === 'model' && <span style={engineTag}><TbSchema size={11} /> Data model</span>}
            {(m.lineage || []).map((l) => <LineageCard key={l.field} lineage={l} />)}
            {m.text ? <AssistantText style={assistantText} text={m.text} /> : null}
            {(m.proposals || []).map((p, j) => (m.engine === 'model' ? modelCard(m, p, j) : reportCard(m, p, j)))}
          </div>
        )))}
        {/* Gone once settled: the message it sends stays in the thread. */}
        {droppedFiles.map((d) => (
          <AddFileCard key={d.key} proposal={{ modelId, dropped: true, summary: 'Import the file: it joins the data model here.' }} initialFiles={d.files}
            onOutcome={(o) => { if (o === 'applied' || o === 'dismissed') setDroppedFiles((prev) => prev.filter((x) => x.key !== d.key)); }}
            onAnswer={(text) => submit(text)} onModelChanged={onModelChanged} onAskModel={askModel} />
        ))}
        {pendingReview && !busy && (
          <div style={cardStyle}>
            <div style={rowStyle}>
              <TbEye size={15} style={iconStyle} />
              <div>
                <div style={titleStyle}>The designer wants to check the design</div>
                <div style={subStyle}>It looks at the page as it is now and proposes what it would still change.</div>
              </div>
            </div>
            <div style={actionsStyle}>
              <button type="button" style={quietBtn} onClick={() => setPendingReview(null)}>No thanks</button>
              <button type="button" style={applyBtn(true)} onClick={reviewNow}>Review the page</button>
            </div>
          </div>
        )}
        {capturing && <Busy text="Looking at every page…" />}
        {report.loading && <Busy text="Thinking…" />}
        {modelChat.loading && <Busy text="The data model assistant is thinking…" />}
        {modelChat.applying && <Busy text={modelChat.applying} />}
      </div>

      {assets.length > 0 && (
        <div style={assetsRow}>
          {assets.map((a) => (
            <span key={a.url} style={assetChip}>
              {a.name}
              <button type="button" style={assetRemove} onClick={() => keepAssets(assetsRef.current.filter((x) => x.url !== a.url))} aria-label={`Forget ${a.name}`}><TbX size={11} /></button>
            </span>
          ))}
        </div>
      )}
      <div style={composerStyle}>
        {withModel && (
          <button type="button" style={targetBtn(toModel)} onClick={() => setToModel((v) => !v)} aria-pressed={toModel} aria-label="Ask the data model"
            title={toModel ? 'Your messages go to the data model assistant' : 'Send the next messages to the data model assistant'}>
            <TbSchema size={15} />
          </button>
        )}
        <textarea
          style={inputStyle}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={toModel && withModel ? MODEL_PLACEHOLDER : PLACEHOLDER}
          maxLength={4000}
          rows={1}
        />
        {busy ? (
          <button style={sendBtn(true)} onClick={() => { report.cancel(); modelChat.cancel(); }} title="Stop" aria-label="Stop"><TbPlayerStop size={16} /></button>
        ) : (
          <button style={sendBtn(!!draft.trim())} onClick={() => submit()} disabled={!draft.trim()} title="Send" aria-label="Send"><TbSend size={16} /></button>
        )}
      </div>
      </>) : children}
      </div>
    </div>
  );
  // A phone shows it as a tab of the bottom sheet; a wide screen docks it on
  // the right edge, sliding between its bar and the panel.
  if (compact || studio) return panel;
  return (
    <SlidingDock open={open} width={width} dragging={dragging}
      bar={<AssistantStrip onOpen={onOpen} tour="ai" />}>
      {panel}
    </SlidingDock>
  );
}
