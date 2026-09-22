import { useCallback, useEffect, useRef, useState } from 'react';
import { TbSparkles, TbArrowUp, TbPlayerStopFilled, TbX, TbPlus, TbSettings } from 'react-icons/tb';
import { useAiChat } from '../../hooks/useAiChat';
import AssistantText from '../AiPanel/AssistantText';
import PersonalProvider from '../AiPanel/PersonalProvider';
import ModelProposalCard from './ModelProposalCard';

const MAX_INPUT_HEIGHT = 120;

/**
 * The assistant of the model editor, in a panel on its right: joins, which
 * columns are dimensions or measures, measures, fact / dimension tables and the
 * diagram. It is shown the editor's draft as it is on screen, unsaved.
 *
 * @param {number} top          where the panel starts (under the editor's header)
 * @param {function} getDraft   () => the draft sent with each question
 * @param {function} onApply    (proposal) => boolean
 */
export default function ModelAssistant({ open, onClose, top, modelId, getDraft, onApply, status, onStatusChange, initialRequest = '' }) {
  const getExtraBody = useCallback(() => ({ draft: getDraft() }), [getDraft]);
  const { messages, loading, send, cancel, reset, setOutcome } = useAiChat(`/ai/models/${modelId}/model-chat`, getExtraBody);
  // A request handed over by another assistant waits in the box: the author
  // reads it and sends it.
  const [draft, setDraft] = useState(initialRequest);
  useEffect(() => { if (initialRequest) setDraft(initialRequest); }, [initialRequest]);
  const [editingProvider, setEditingProvider] = useState(false);
  const threadRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 250); }, [open]);

  const needsSetup = status?.reason === 'setup';
  const showProvider = (needsSetup || editingProvider) && !!status?.personal;

  const submit = async () => {
    const question = draft.trim();
    if (!question || loading) return;
    setDraft('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
    if (!(await send(question))) setDraft(question);
  };

  return (
    <aside style={{ ...shellStyle, top, transform: open ? 'none' : 'translateX(100%)' }} aria-label="Model assistant" aria-hidden={!open} inert={!open}>
      <header style={headerStyle}>
        <span style={badgeStyle}><TbSparkles size={14} /></span>
        <div style={titleStyle}>Model assistant</div>
        {status?.source === 'personal' && (
          <button style={iconBtn} onClick={() => setEditingProvider((v) => !v)} title="Your AI provider" aria-label="Your AI provider"><TbSettings size={16} /></button>
        )}
        <button style={iconBtn} onClick={reset} disabled={!messages.length} title="New conversation" aria-label="New conversation"><TbPlus size={16} /></button>
        <button style={iconBtn} onClick={onClose} title="Close" aria-label="Close model assistant"><TbX size={16} /></button>
      </header>

      {showProvider ? (
        <div style={providerStyle}>
          <PersonalProvider
            key={`${status.personal.baseUrl}|${status.personal.model}|${status.personal.hasApiKey}`}
            personal={status.personal}
            onSaved={async () => { await onStatusChange(); setEditingProvider(false); }}
            onCancel={needsSetup ? null : () => setEditingProvider(false)}
          />
        </div>
      ) : (
        <>
          <div ref={threadRef} style={threadStyle}>
            {messages.length === 0 && (
              <div style={emptyStyle}>
                <span style={{ ...badgeStyle, width: 40, height: 40, borderRadius: 13 }}><TbSparkles size={22} /></span>
                <div style={emptyTitleStyle}>What should the model look like?</div>
              </div>
            )}
            {messages.map((m, i) => (m.role === 'user' ? (
              <div key={i} style={userBubble}>{m.text}</div>
            ) : (
              <div key={i} style={assistantBody}>
                {m.text ? <AssistantText style={assistantText} text={m.text} /> : null}
                {(m.proposals || []).map((p, j) => (
                  <ModelProposalCard key={j} proposal={p} onApply={onApply} onOutcome={(outcome) => setOutcome(i, j, outcome)} />
                ))}
              </div>
            )))}
            {loading && <div style={thinkingStyle}>Thinking…</div>}
          </div>
          <div style={composerStyle}>
            <textarea
              ref={inputRef}
              style={inputStyle}
              value={draft}
              onChange={(e) => { setDraft(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${Math.min(e.target.scrollHeight, MAX_INPUT_HEIGHT)}px`; }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
              placeholder="Join the tables, flag the columns…"
              maxLength={4000}
              rows={1}
              aria-label="Your request"
            />
            {loading ? (
              <button style={sendBtn(true)} onClick={cancel} title="Stop" aria-label="Stop"><TbPlayerStopFilled size={14} /></button>
            ) : (
              <button style={sendBtn(!!draft.trim())} onClick={submit} disabled={!draft.trim()} title="Send" aria-label="Send"><TbArrowUp size={17} /></button>
            )}
          </div>
        </>
      )}
    </aside>
  );
}

const shellStyle = {
  position: 'fixed', right: 0, bottom: 0, width: 400, maxWidth: '100vw', zIndex: 150,
  display: 'flex', flexDirection: 'column', background: 'var(--bg-panel)',
  borderLeft: '1px solid var(--border-default)', boxShadow: '-12px 0 32px -18px rgba(15, 23, 42, 0.3)',
  transition: 'transform 240ms cubic-bezier(0.4, 0, 0.2, 1)',
};
const headerStyle = { display: 'flex', alignItems: 'center', gap: 10, padding: '12px 12px 12px 16px', borderBottom: '1px solid var(--border-default)', flexShrink: 0 };
const badgeStyle = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, width: 26, height: 26, borderRadius: 8, color: '#fff',
  background: 'linear-gradient(135deg, var(--accent-primary) 0%, #c026d3 100%)', boxShadow: '0 2px 6px rgba(124, 58, 237, 0.30)',
};
const titleStyle = { flex: 1, fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' };
const iconBtn = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, padding: 0, flexShrink: 0,
  border: 'none', borderRadius: 8, background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
};
const providerStyle = { flex: 1, minHeight: 0, overflowY: 'auto', padding: 16 };
const threadStyle = { flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 14px 8px', display: 'flex', flexDirection: 'column', gap: 14 };
const emptyStyle = { margin: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center', padding: 24 };
const emptyTitleStyle = { fontSize: 15, fontWeight: 650, color: 'var(--text-primary)' };
const userBubble = {
  alignSelf: 'flex-end', maxWidth: '85%', padding: '8px 12px', fontSize: 13, lineHeight: 1.45,
  borderRadius: '16px 16px 4px 16px', background: 'var(--accent-primary)', color: '#fff', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
};
const assistantBody = { display: 'flex', flexDirection: 'column', gap: 8 };
const assistantText = { fontSize: 13, lineHeight: 1.55, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' };
const thinkingStyle = { fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' };
const composerStyle = {
  display: 'flex', alignItems: 'flex-end', gap: 8, margin: '8px 12px 12px', padding: '8px 8px 8px 12px', borderRadius: 14,
  border: '1px solid var(--border-default)', background: 'var(--bg-app)', flexShrink: 0,
};
const inputStyle = {
  flex: 1, minWidth: 0, resize: 'none', padding: '6px 0', fontSize: 13, lineHeight: 1.45, fontFamily: 'inherit',
  border: 'none', outline: 'none', background: 'transparent', color: 'var(--text-primary)', maxHeight: MAX_INPUT_HEIGHT,
};
const sendBtn = (active) => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, flexShrink: 0,
  border: 'none', borderRadius: '50%', color: '#fff', cursor: active ? 'pointer' : 'default',
  background: active ? 'linear-gradient(135deg, var(--accent-primary) 0%, #c026d3 100%)' : 'var(--border-strong)',
});
