import { useCallback, useEffect, useRef, useState } from 'react';
import { TbSparkles, TbArrowUp, TbPlayerStopFilled, TbX, TbPlus, TbSettings } from 'react-icons/tb';
import api from '../../utils/api';
import { useAiChat } from '../../hooks/useAiChat';
import { useResizableWidth } from '../../hooks/useResizableWidth';
import { useAuth } from '../../hooks/useAuth';
import AssistantText from '../AiPanel/AssistantText';
import PersonalProvider from '../AiPanel/PersonalProvider';
import ActionCard from '../AiPanel/ActionCard';
import Suggestions from '../AiPanel/Suggestions';

const MAX_INPUT_HEIGHT = 140;

// By role: a viewer is never told how to connect a database.
const SUGGESTIONS = {
  builder: [
    { label: 'Get started', items: ['How do I connect a database?', 'How do I import an Excel or CSV file?', 'What is a data model, and how do I build one?', 'How do I create my first report?'] },
    { label: 'Go further', items: ['How do I filter a whole page?', 'How do I share a report with my team?', 'How do I refresh the data every night?', 'What can the AI assistant do for me?'] },
  ],
  viewer: [
    { label: 'Get started', items: ['How do I open and read a report?', 'How do I filter a report?', 'How do I export a report to PDF or Excel?', 'What can I do as a viewer?'] },
  ],
};

/**
 * The Help assistant, beside the user guide (pages/Help.jsx): how to use
 * OpenReport, answered from the same guide (server helpAssistant, `read_help`
 * only — it never sees data). Admins and editors also get the cards that
 * bring data in (connect a database, import a file). Questions about data
 * are Chat's.
 * @param {boolean} compact   a phone: the panel covers the page, `onClose` folds it
 */
export default function HelpAssistant({ compact, open = true, onClose, status, onStatusChange }) {
  const { user } = useAuth();
  const builder = user?.role === 'admin' || user?.role === 'editor';
  const { width, handleProps } = useResizableWidth({ storageKey: 'openreport.askPanelWidth', defaultWidth: 440, min: 340, max: 760 });
  const [editingProvider, setEditingProvider] = useState(false);
  const [draft, setDraft] = useState('');
  const threadRef = useRef(null);
  const inputRef = useRef(null);
  const { messages, loading, send, cancel, reset, setOutcome } = useAiChat('/ai/help/chat');

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 280); }, [open]);

  const grow = (el) => {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_INPUT_HEIGHT)}px`;
  };
  const submit = useCallback(async (text) => {
    const question = (text ?? draft).trim();
    if (!question || loading) return;
    setDraft('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
    if (!(await send(question))) setDraft(question);
  }, [draft, loading, send]);

  const needsSetup = status?.reason === 'setup';
  const showProvider = (needsSetup || editingProvider) && !!status?.personal;
  const unavailable = status && !status.enabled && !needsSetup;

  return (
    <aside style={compact ? { ...compactShellStyle, transform: open ? 'none' : 'translateX(100%)' } : { ...shellStyle, width }}
      aria-label="Help assistant" aria-hidden={!open} inert={!open}>
      {!compact && <div {...handleProps} title="Drag to resize" />}
      <header style={headerStyle}>
        <span style={badgeStyle(26)}><TbSparkles size={15} /></span>
        <div style={headerTextStyle}>
          <div style={headerTitleStyle}>Assistant</div>
          <div style={headerSubStyle}>Ask how to do anything in OpenReport</div>
        </div>
        {status?.source === 'personal' && (
          <button style={iconBtn} onClick={() => setEditingProvider((v) => !v)} title="Your AI provider" aria-label="Your AI provider"><TbSettings size={16} /></button>
        )}
        <button style={iconBtn} onClick={reset} disabled={!messages.length} title="New conversation" aria-label="New conversation"><TbPlus size={16} /></button>
        {compact && <button style={iconBtn} onClick={onClose} title="Close" aria-label="Close assistant"><TbX size={16} /></button>}
      </header>

      {showProvider ? (
        <div style={providerStyle}>
          <PersonalProvider
            key={`${status.personal.provider}|${status.personal.baseUrl}|${status.personal.model}|${status.personal.hasApiKey}`}
            personal={status.personal}
            onSaved={async () => { await onStatusChange?.(); setEditingProvider(false); }}
            onCancel={needsSetup ? null : () => setEditingProvider(false)}
          />
        </div>
      ) : (
        <>
          <div ref={threadRef} style={threadStyle}>
            {messages.length === 0 && (
              <div style={emptyStyle}>
                <span style={badgeStyle(44)}><TbSparkles size={24} /></span>
                <div style={emptyTitleStyle}>{unavailable ? 'The assistant is not available for this account' : 'How can I help you with OpenReport?'}</div>
                {status?.enabled && <Suggestions groups={SUGGESTIONS[builder ? 'builder' : 'viewer']} onPick={submit} disabled={loading} />}
              </div>
            )}
            {messages.map((m, i) => (m.role === 'user' ? (
              <div key={i} style={userBubble}>{m.text}</div>
            ) : (
              <div key={i} style={assistantRow}>
                <span style={badgeStyle(22)}><TbSparkles size={12} /></span>
                <div style={assistantBody}>
                  {m.text ? <AssistantText style={assistantText} text={m.text} /> : null}
                  {m.proposals?.[0]?.kind === 'action' && (
                    <ActionCard proposal={m.proposals[0]} onOutcome={(outcome) => setOutcome(i, 0, outcome)} onAnswer={(text) => submit(text)} />
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
                placeholder="Ask how to do something in OpenReport…"
                maxLength={4000}
                rows={1}
                disabled={!status?.enabled}
                aria-label="Your question"
              />
              {loading ? (
                <button style={sendBtn(true)} onClick={cancel} title="Stop" aria-label="Stop"><TbPlayerStopFilled size={14} /></button>
              ) : (
                <button style={sendBtn(!!draft.trim())} onClick={() => submit()} disabled={!draft.trim()} title="Send" aria-label="Send"><TbArrowUp size={17} /></button>
              )}
            </div>
          </div>
        </>
      )}
    </aside>
  );
}

/** Whether this account has the assistant, or may set one up for itself. */
export function useHelpStatus() {
  const [status, setStatus] = useState(null);
  const refresh = useCallback(() => (
    api.get('/ai/status').then((res) => setStatus(res.data)).catch(() => setStatus({ enabled: false }))
  ), []);
  useEffect(() => { refresh(); }, [refresh]);
  return { status, refresh, available: !!status && (status.enabled || status.reason === 'setup') };
}

const badgeStyle = (size) => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  width: size, height: size, borderRadius: Math.round(size * 0.32), color: '#fff',
  background: 'linear-gradient(135deg, var(--accent-primary) 0%, #c026d3 100%)',
  boxShadow: '0 2px 6px rgba(124, 58, 237, 0.30)',
});
const shellStyle = {
  position: 'relative', flexShrink: 0, height: '100vh', display: 'flex', flexDirection: 'column',
  background: 'var(--bg-panel)', borderLeft: '1px solid var(--border-default)',
  boxShadow: '-12px 0 32px -18px rgba(15, 23, 42, 0.25)',
};
const compactShellStyle = {
  position: 'fixed', inset: 0, zIndex: 300, display: 'flex', flexDirection: 'column', background: 'var(--bg-panel)',
  transition: 'transform 260ms cubic-bezier(0.4, 0, 0.2, 1)',
};
const headerStyle = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '12px 12px 12px 16px',
  borderBottom: '1px solid var(--border-default)', flexShrink: 0,
};
const headerTextStyle = { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 };
const headerTitleStyle = { fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.01em' };
const headerSubStyle = { fontSize: 12, fontWeight: 500, color: 'var(--text-muted)' };
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
