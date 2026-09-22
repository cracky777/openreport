import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TbSparkles, TbArrowUp, TbPlayerStopFilled, TbX, TbPlus, TbSettings, TbChevronDown, TbChevronsLeft, TbChevronsRight } from 'react-icons/tb';
import api from '../../utils/api';
import { toast } from '../Toast/toast';
import { useAiChat } from '../../hooks/useAiChat';
import { useGraph } from '../../hooks/graphContext';
import { useResizableWidth } from '../../hooks/useResizableWidth';
import AssistantText from '../AiPanel/AssistantText';
import PersonalProvider from '../AiPanel/PersonalProvider';
import AskAnswer from './AskAnswer';
import { proposedVisuals as visualsOf } from '../../utils/aiProposal';
import AddToReport from './AddToReport';
import ActionCard from '../AiPanel/ActionCard';

const LAST_MODEL_KEY = 'openreport.askModel';
// The same fold as the report editor's Data panel.
const SLIDE = 'width 200ms ease';
const MAX_INPUT_HEIGHT = 140;

function rememberedModel() {
  try { return localStorage.getItem(LAST_MODEL_KEY) || ''; } catch { return ''; /* storage blocked: no memory */ }
}

/**
 * The Assistant, in a panel on the right of the journey.
 * A conversation about one model, with no report: the assistant picks the
 * fields and the visual, this panel draws it on the user's own session, and
 * the user adds it to a report — the assistant's own reads stay cache-only.
 *
 * On a wide screen it folds like the report editor's Data panel: closed, a
 * slim strip on the right opens it; open, the chevrons in its header fold it
 * back, and its width is dragged from its left edge. Closed, the panel stays
 * mounted: reopening finds the conversation where it was.
 */
export default function AskPanel({ open, onToggle, onClose, compact }) {
  const navigate = useNavigate();
  const { models, selectedWs, personalWorkspace, refresh } = useGraph();
  const [dragging, setDragging] = useState(false);
  const { width, handleProps } = useResizableWidth({
    storageKey: 'openreport.askPanelWidth', defaultWidth: 440, min: 340, max: 760,
    onDragStart: () => setDragging(true), onDragEnd: () => setDragging(false),
  });

  const [status, setStatus] = useState(null);
  const [editingProvider, setEditingProvider] = useState(false);
  const [pickedModel, setPickedModel] = useState(rememberedModel);
  const modelId = (models || []).some((m) => m.id === pickedModel) ? pickedModel : (models?.[0]?.id || '');
  const [loadedModel, setModel] = useState(null);
  // The one loaded for another selection is never shown while the new one loads.
  const model = loadedModel?.id === modelId ? loadedModel : null;
  const [draft, setDraft] = useState('');
  const [ratings, setRatings] = useState({});
  const [adding, setAdding] = useState(null); // index of the answer being added
  const threadRef = useRef(null);
  const inputRef = useRef(null);

  // The workspace picked in the header: its library of custom visuals is
  // offered, and its admins may have a new one written.
  const workspaceId = selectedWs || personalWorkspace?.id || '';
  const getExtraBody = useCallback(() => (workspaceId ? { workspaceId } : {}), [workspaceId]);
  const { messages, loading, send, cancel, reset, setOutcome } = useAiChat(`/ai/models/${modelId}/chat`, getExtraBody);

  const refreshStatus = useCallback(() => (
    api.get('/ai/status').then((res) => setStatus(res.data)).catch(() => setStatus({ enabled: false }))
  ), []);
  useEffect(() => { if (open) refreshStatus(); }, [open, refreshStatus]);

  useEffect(() => {
    if (!modelId) return undefined;
    let stale = false;
    api.get(`/models/${modelId}`)
      .then((res) => { if (!stale) setModel(res.data.model); })
      .catch((err) => toast(err.response?.data?.error || 'Failed to load the model'));
    return () => { stale = true; };
  }, [modelId]);

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  // Opening puts the cursor where the question goes.
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 280);
  }, [open]);

  // Another model — or another workspace, another library: the conversation
  // starts over, since the next turn would carry proposals about the other one.
  const firstWs = useRef(workspaceId);
  useEffect(() => {
    if (firstWs.current === workspaceId) return;
    firstWs.current = workspaceId;
    reset();
  }, [workspaceId, reset]);
  const switchModel = (id) => {
    if (id === modelId) return;
    reset();
    setPickedModel(id);
    try { localStorage.setItem(LAST_MODEL_KEY, id); } catch { /* storage blocked: no memory */ }
  };

  const grow = (el) => {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_INPUT_HEIGHT)}px`;
  };

  const submit = async () => {
    const question = draft.trim();
    if (!question || loading || !modelId) return;
    setDraft('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
    if (!(await send(question))) setDraft(question);
  };

  const rate = async (m, rating) => {
    setRatings((prev) => ({ ...prev, [m.answerId]: rating }));
    try {
      await api.post('/ai/feedback', { modelId, surface: 'ask', answerId: m.answerId, rating, question: m.question, visuals: visualsOf(m.proposals?.[0]) });
    } catch {
      setRatings((prev) => ({ ...prev, [m.answerId]: undefined }));
      toast('Your feedback could not be saved');
    }
  };

  const needsSetup = status?.reason === 'setup';
  const showProvider = (needsSetup || editingProvider) && !!status?.personal;
  const unavailable = status && !status.enabled && !needsSetup;
  const addingMessage = adding !== null ? messages[adding] : null;
  const addingProposal = addingMessage?.proposals?.[0];

  const outer = compact
    ? { ...compactShellStyle, transform: open ? 'none' : 'translateX(100%)' }
    : { ...shellStyle, width: open ? width : 0, borderLeftWidth: open ? 1 : 0, transition: dragging ? 'none' : SLIDE };

  return (
    <>
    {!compact && !open && (
      <button type="button" onClick={onToggle} style={stripStyle} aria-label="Assistant" aria-expanded={false} title="Open the assistant">
        <span style={stripChevronStyle}><TbChevronsLeft size={14} /></span>
        <TbSparkles size={14} color="var(--accent-primary)" />
        <span style={stripLabelStyle}>Assistant</span>
      </button>
    )}
    <aside style={outer} aria-label="Assistant" aria-hidden={!open} inert={!open}>
      <div style={compact ? { ...panelStyle, width: '100%' } : { ...panelStyle, width }}>
        {!compact && <div {...handleProps} title="Drag to resize" />}

        <header style={headerStyle}>
          <span style={badgeStyle(26)}><TbSparkles size={15} /></span>
          <div style={headerTextStyle}>
            <div style={headerTitleStyle}>Assistant</div>
            <label style={modelPickStyle}>
              <select style={modelSelectStyle} value={modelId} onChange={(e) => switchModel(e.target.value)} aria-label="Data model" disabled={loading}>
                {(models || []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              <TbChevronDown size={12} style={chevronStyle} />
            </label>
          </div>
          {status?.source === 'personal' && (
            <button style={iconBtn} onClick={() => setEditingProvider((v) => !v)} title="Your AI provider" aria-label="Your AI provider"><TbSettings size={16} /></button>
          )}
          <button style={iconBtn} onClick={reset} disabled={!messages.length} title="New conversation" aria-label="New conversation"><TbPlus size={16} /></button>
          {compact
            ? <button style={iconBtn} onClick={onClose} title="Close" aria-label="Close assistant"><TbX size={16} /></button>
            : (
              <button style={foldBtn} onClick={onClose} title="Collapse panel" aria-label="Collapse assistant"
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.borderColor = 'var(--border-strong)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-panel)'; e.currentTarget.style.borderColor = 'var(--border-default)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
              ><TbChevronsRight size={14} /></button>
            )}
        </header>

        {showProvider ? (
          <div style={providerStyle}>
            <PersonalProvider
              key={`${status.personal.baseUrl}|${status.personal.model}|${status.personal.hasApiKey}`}
              personal={status.personal}
              onSaved={async () => { await refreshStatus(); setEditingProvider(false); }}
              onCancel={needsSetup ? null : () => setEditingProvider(false)}
            />
          </div>
        ) : (
          <>
            <div ref={threadRef} style={threadStyle}>
              {messages.length === 0 && (
                <div style={emptyStyle}>
                  <span style={badgeStyle(44)}><TbSparkles size={24} /></span>
                  <div style={emptyTitleStyle}>{unavailable ? 'The assistant is not available for this account' : 'What would you like to know?'}</div>
                  {!unavailable && model?.name ? <div style={emptySubStyle}>{model.name}</div> : null}
                </div>
              )}
              {messages.map((m, i) => (m.role === 'user' ? (
                <div key={i} style={userBubble}>{m.text}</div>
              ) : (
                <div key={i} style={assistantRow}>
                  <span style={badgeStyle(22)}><TbSparkles size={12} /></span>
                  <div style={assistantBody}>
                    {m.text ? <AssistantText style={assistantText} text={m.text} /> : null}
                    {visualsOf(m.proposals?.[0]).length > 0 && model && (
                      <AskAnswer
                        proposal={m.proposals[0]}
                        model={model}
                        rating={ratings[m.answerId]}
                        added={m.added}
                        onRate={(rating) => rate(m, rating)}
                        onAdd={() => setAdding(i)}
                        onOpen={(id) => navigate(`/edit/${id}`)}
                      />
                    )}
                    {m.proposals?.[0]?.kind === 'action' && (
                      <ActionCard proposal={m.proposals[0]} modelId={modelId} onOutcome={(outcome) => setOutcome(i, 0, outcome)} />
                    )}
                  </div>
                </div>
              )))}
              {loading && (
                <div style={assistantRow}>
                  <span style={badgeStyle(22)}><TbSparkles size={12} /></span>
                  <span style={dotsStyle} aria-label="Thinking"><i style={dot(0)} /><i style={dot(1)} /><i style={dot(2)} /></span>
                </div>
              )}
            </div>

            <div style={composerWrapStyle}>
              <div style={composerStyle}>
                <textarea
                  ref={inputRef}
                  style={inputStyle}
                  value={draft}
                  onChange={(e) => { setDraft(e.target.value); grow(e.target); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
                  placeholder="Ask anything about your data…"
                  maxLength={4000}
                  rows={1}
                  disabled={!status?.enabled || !modelId}
                  aria-label="Your question"
                />
                {loading ? (
                  <button style={sendBtn(true)} onClick={cancel} title="Stop" aria-label="Stop"><TbPlayerStopFilled size={14} /></button>
                ) : (
                  <button style={sendBtn(!!draft.trim())} onClick={submit} disabled={!draft.trim()} title="Send" aria-label="Send"><TbArrowUp size={17} /></button>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {addingProposal && (
        <AddToReport
          widgets={visualsOf(addingProposal)}
          generated={addingProposal.kind === 'customVisual' ? addingProposal : null}
          workspaceId={workspaceId}
          modelId={modelId}
          defaultTitle={visualsOf(addingProposal).length > 1 ? (model?.name || '') : (visualsOf(addingProposal)[0].config?.title || '')}
          onClose={() => setAdding(null)}
          onAdded={(where) => {
            // `applied` is what the next turn tells the model about its proposal.
            setOutcome(adding, 0, 'applied', { added: where });
            setAdding(null);
            refresh?.();
            toast(`Added to ${where.title}`, 'success');
          }}
        />
      )}
    </aside>
    </>
  );
}

// Folded, the panel is the strip the report editor's Data panel folds into.
const stripStyle = {
  flexShrink: 0, width: 34, height: '100%', boxSizing: 'border-box', padding: '10px 8px',
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', gap: 10,
  border: 'none', borderLeft: '1px solid var(--border-default)', borderRadius: 0, overflow: 'hidden', cursor: 'pointer',
  background: 'var(--bg-panel-alt)', fontFamily: 'inherit',
};
const stripChevronStyle = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 22, height: 22, background: 'var(--bg-panel)', border: '1px solid var(--border-default)',
  borderRadius: 6, color: 'var(--text-muted)',
};
const stripLabelStyle = {
  fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.08em',
  textTransform: 'uppercase', writingMode: 'vertical-rl', textOrientation: 'mixed',
};
const foldBtn = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  width: 24, height: 24, color: 'var(--text-muted)',
  background: 'var(--bg-panel)', border: '1px solid var(--border-default)', borderRadius: 6,
  cursor: 'pointer', padding: 0,
};
const badgeStyle = (size) => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  width: size, height: size, borderRadius: Math.round(size * 0.32), color: '#fff',
  background: 'linear-gradient(135deg, var(--accent-primary) 0%, #c026d3 100%)',
  boxShadow: '0 2px 6px rgba(124, 58, 237, 0.30)',
});
// The outer box animates its width; the panel inside keeps its own, so the
// content slides in whole instead of reflowing at every frame.
const shellStyle = {
  position: 'relative', flexShrink: 0, height: '100%', overflow: 'hidden',
  borderLeft: '1px solid var(--border-default)',
  boxShadow: '-12px 0 32px -18px rgba(15, 23, 42, 0.25)',
};
const compactShellStyle = {
  position: 'fixed', inset: 0, zIndex: 300, transition: 'transform 260ms cubic-bezier(0.4, 0, 0.2, 1)',
};
const panelStyle = {
  position: 'relative', height: '100%', display: 'flex', flexDirection: 'column',
  background: 'var(--bg-panel)',
};
const headerStyle = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '12px 12px 12px 16px',
  borderBottom: '1px solid var(--border-default)', flexShrink: 0,
};
const headerTextStyle = { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 };
const headerTitleStyle = { fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.01em' };
const modelPickStyle = { position: 'relative', display: 'inline-flex', alignItems: 'center', maxWidth: '100%', alignSelf: 'flex-start' };
const modelSelectStyle = {
  appearance: 'none', WebkitAppearance: 'none', maxWidth: '100%', padding: '0 18px 0 0', fontSize: 12, fontWeight: 500,
  border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', outline: 'none',
  textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap',
};
const chevronStyle = { position: 'absolute', right: 2, pointerEvents: 'none', color: 'var(--text-muted)' };
const iconBtn = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, padding: 0, flexShrink: 0,
  border: 'none', borderRadius: 8, background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
};
const providerStyle = { flex: 1, minHeight: 0, overflowY: 'auto', padding: 16 };
const threadStyle = {
  flex: 1, minHeight: 0, overflowY: 'auto', padding: '18px 16px 8px',
  display: 'flex', flexDirection: 'column', gap: 18,
};
const emptyStyle = { margin: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center', padding: 24 };
const emptyTitleStyle = { fontSize: 16, fontWeight: 650, color: 'var(--text-primary)', letterSpacing: '-0.01em' };
const emptySubStyle = { fontSize: 12.5, color: 'var(--text-muted)' };
const userBubble = {
  alignSelf: 'flex-end', maxWidth: '85%', padding: '9px 13px', fontSize: 13, lineHeight: 1.45,
  borderRadius: '16px 16px 4px 16px', background: 'var(--accent-primary)', color: '#fff',
  whiteSpace: 'pre-wrap', wordBreak: 'break-word', boxShadow: '0 1px 2px rgba(15,23,42,0.12)',
};
const assistantRow = { display: 'flex', gap: 10, alignItems: 'flex-start' };
const assistantBody = { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 };
const assistantText = { fontSize: 13, lineHeight: 1.55, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', paddingTop: 2 };
const dotsStyle = { display: 'inline-flex', gap: 4, padding: '8px 2px' };
const dot = (i) => ({
  width: 6, height: 6, borderRadius: '50%', background: 'var(--accent-primary)', display: 'inline-block',
  animation: `askDot 1.2s ${i * 0.15}s infinite ease-in-out`,
});
const composerWrapStyle = { padding: '10px 14px 14px', flexShrink: 0 };
const composerStyle = {
  display: 'flex', alignItems: 'flex-end', gap: 8, padding: '8px 8px 8px 14px', borderRadius: 16,
  border: '1px solid var(--border-default)', background: 'var(--bg-app)',
  boxShadow: '0 1px 3px rgba(15,23,42,0.06)',
};
const inputStyle = {
  flex: 1, minWidth: 0, resize: 'none', padding: '6px 0', fontSize: 13.5, lineHeight: 1.45, fontFamily: 'inherit',
  border: 'none', outline: 'none', background: 'transparent', color: 'var(--text-primary)', maxHeight: MAX_INPUT_HEIGHT,
};
const sendBtn = (active) => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, flexShrink: 0,
  border: 'none', borderRadius: '50%', color: '#fff', cursor: active ? 'pointer' : 'default',
  background: active ? 'linear-gradient(135deg, var(--accent-primary) 0%, #c026d3 100%)' : 'var(--border-strong)',
  transition: 'background 0.15s',
});
