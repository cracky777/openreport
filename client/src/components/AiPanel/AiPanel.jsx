import { useState, useRef, useEffect, useCallback } from 'react';
import { TbSparkles, TbSend, TbPlayerStop, TbX, TbRefresh, TbChartBar, TbPalette, TbSettings } from 'react-icons/tb';
import { useResizableWidth } from '../../hooks/useResizableWidth';
import { useIsCompact } from '../../hooks/useMediaQuery';
import { useAiChat } from '../../hooks/useAiChat';
import ProposalCard from './ProposalCard';
import ActionCard from './ActionCard';
import AssistantText from './AssistantText';
import PersonalProvider from './PersonalProvider';

const panelStyle = {
  backgroundColor: 'var(--bg-panel-alt)', borderLeft: '1px solid var(--border-default)',
  padding: 12, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative',
};
const headerStyle = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
  marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid var(--border-default)',
};
const headerTitleStyle = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: '0.04em', textTransform: 'uppercase',
};
const headerActionsStyle = { display: 'flex', gap: 4 };
const iconBtn = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, padding: 0,
  color: 'var(--text-muted)', background: 'var(--bg-panel)', border: '1px solid var(--border-default)',
  borderRadius: 6, cursor: 'pointer',
};
const threadStyle = { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, paddingRight: 2 };
const emptyStyle = { fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 };
const exampleBtn = {
  display: 'block', width: '100%', textAlign: 'left', marginTop: 6, padding: '6px 8px', fontSize: 12,
  color: 'var(--text-secondary)', background: 'var(--bg-panel)', border: '1px solid var(--border-default)',
  borderRadius: 6, cursor: 'pointer',
};
const userBubble = {
  alignSelf: 'flex-end', maxWidth: '90%', padding: '6px 10px', borderRadius: 10, fontSize: 12, lineHeight: 1.45,
  background: 'var(--accent-primary)', color: '#fff', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
};
const assistantBlock = { display: 'flex', flexDirection: 'column', gap: 8 };
const assistantText = { fontSize: 12, lineHeight: 1.5, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' };
const thinkingStyle = { fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' };
const composerStyle = { display: 'flex', gap: 6, alignItems: 'flex-end', marginTop: 10 };
const inputStyle = {
  flex: 1, minHeight: 36, maxHeight: 120, resize: 'none', padding: '8px 10px', fontSize: 12, lineHeight: 1.4,
  fontFamily: 'inherit', color: 'var(--text-primary)', background: 'var(--bg-panel)',
  border: '1px solid var(--border-default)', borderRadius: 8, outline: 'none',
};
const sendBtn = (enabled) => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, flexShrink: 0,
  border: 'none', borderRadius: 8, color: '#fff', cursor: enabled ? 'pointer' : 'default',
  background: enabled ? 'var(--accent-primary)' : 'var(--border-strong)',
});

const chatStyle = { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' };
const hiddenStyle = { display: 'none' };
const modeBarStyle = {
  display: 'flex', gap: 2, padding: 2, marginBottom: 10, borderRadius: 8,
  background: 'var(--bg-subtle)', border: '1px solid var(--border-default)',
};
const modeBtn = (active) => ({
  flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '5px 8px',
  fontSize: 12, fontWeight: 600, border: 'none', borderRadius: 6, cursor: 'pointer',
  background: active ? 'var(--bg-panel)' : 'transparent',
  color: active ? 'var(--accent-primary)' : 'var(--text-muted)',
  boxShadow: active ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
});

// Two jobs, chosen by the author rather than guessed from the wording: the
// server offers the model only the tools of the selected one.
const MODES = {
  visuals: {
    label: 'Visuals',
    icon: TbChartBar,
    placeholder: 'Ask a business question…',
    examples: ['Which categories drive revenue?', 'Show the monthly trend of the main measure'],
  },
  design: {
    label: 'Design',
    icon: TbPalette,
    placeholder: 'Describe the look you want…',
    examples: ['Rearrange this page so the key figure stands out', 'Use one consistent color palette across the page'],
  },
};

// What leaves the instance, kept one hover away on the panel's title rather
// than printed under every conversation.
const SHARING = {
  'schema+cache': 'Reads this report\'s cached data only — never the live source. Field names and cached rows are sent to your AI provider.',
  schema: 'Schema only — no data is shared. Field names are sent to your AI provider.',
};

export default function AiPanel({ reportId, model, widgets, settings, status, onStatusChange, getPageContext, onApplyProposal, onClose, onResizeStart, onResizeEnd }) {
  const { width, handleProps } = useResizableWidth({ storageKey: 'openreport.aiPanelWidth', defaultWidth: 300, min: 260, max: 520, onDragStart: onResizeStart, onDragEnd: onResizeEnd });
  const compact = useIsCompact();
  const getExtraBody = useCallback(() => ({ pageContext: getPageContext() }), [getPageContext]);
  const { messages, loading, send, cancel, reset, setOutcome } = useAiChat(`/ai/reports/${reportId}/chat`, getExtraBody);
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState('visuals');
  // The instance has no provider: the user brings their own, first thing in
  // the panel, and may come back to it from the header afterwards.
  const [editingProvider, setEditingProvider] = useState(false);
  const needsSetup = status.reason === 'setup';
  const showProvider = (needsSetup || editingProvider) && !!status.personal;
  const dataSharing = status.dataSharing;
  const threadRef = useRef(null);

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, loading]);

  const submit = async (text) => {
    const question = (text ?? draft).trim();
    if (!question || loading) return;
    setDraft('');
    // A failed turn hands the question back so it can be re-sent as is.
    if (!(await send(question, { mode }))) setDraft(question);
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const style = compact
    ? { ...panelStyle, width: '100%', borderLeft: 'none', height: '100%' }
    : { ...panelStyle, width, maxWidth: width };

  return (
    <div style={style}>
      {!compact && <div {...handleProps} />}
      <div style={headerStyle}>
        <span style={headerTitleStyle} title={SHARING[dataSharing] || SHARING.schema}><TbSparkles size={14} color="var(--accent-primary)" /> Assistant</span>
        <span style={headerActionsStyle}>
          {status.source === 'personal' && (
            <button style={iconBtn} onClick={() => setEditingProvider((v) => !v)} title="Your AI provider" aria-label="Your AI provider"><TbSettings size={13} /></button>
          )}
          {messages.length > 0 && (
            <button style={iconBtn} onClick={reset} title="New conversation" aria-label="New conversation"><TbRefresh size={13} /></button>
          )}
          {!compact && (
            <button style={iconBtn} onClick={onClose} title="Close assistant" aria-label="Close assistant"><TbX size={13} /></button>
          )}
        </span>
      </div>

      {showProvider && (
        // Keyed by what is saved, so the form starts from it again after a save or a removal.
        <PersonalProvider
          key={`${status.personal.baseUrl}|${status.personal.model}|${status.personal.hasApiKey}`}
          personal={status.personal}
          onSaved={async () => { await onStatusChange(); setEditingProvider(false); }}
          onCancel={needsSetup ? null : () => setEditingProvider(false)}
        />
      )}

      {/* The conversation stays mounted behind the provider form: opening the
          settings must not cost the author their thread. */}
      <div style={showProvider ? hiddenStyle : chatStyle}>
      <div style={modeBarStyle} role="tablist" aria-label="Assistant mode">
        {Object.entries(MODES).map(([key, m]) => (
          <button key={key} role="tab" aria-selected={mode === key} style={modeBtn(mode === key)} onClick={() => setMode(key)} disabled={loading}>
            <m.icon size={13} /> {m.label}
          </button>
        ))}
      </div>

      <div ref={threadRef} style={threadStyle}>
        {messages.length === 0 && (
          <div style={emptyStyle}>
            {MODES[mode].examples.map((ex) => (
              <button key={ex} style={exampleBtn} onClick={() => submit(ex)}>{ex}</button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (m.role === 'user' ? (
          <div key={i} style={userBubble}>{m.text}</div>
        ) : (
          <div key={i} style={assistantBlock}>
            {m.text ? <AssistantText style={assistantText} text={m.text} /> : null}
            {(m.proposals || []).map((p, j) => (p.kind === 'action' ? (
              <ActionCard key={j} proposal={p} reportId={reportId} onOutcome={(outcome) => setOutcome(i, j, outcome)} />
            ) : (
              <ProposalCard key={j} proposal={p} model={model} widgets={widgets} reportId={reportId} settings={settings}
                onApply={onApplyProposal} onOutcome={(outcome) => setOutcome(i, j, outcome)} />
            )))}
          </div>
        )))}
        {loading && <div style={thinkingStyle}>Thinking…</div>}
      </div>

      <div style={composerStyle}>
        <textarea
          style={inputStyle}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={MODES[mode].placeholder}
          maxLength={4000}
          rows={1}
        />
        {loading ? (
          <button style={sendBtn(true)} onClick={cancel} title="Stop" aria-label="Stop"><TbPlayerStop size={16} /></button>
        ) : (
          <button style={sendBtn(!!draft.trim())} onClick={() => submit()} disabled={!draft.trim()} title="Send" aria-label="Send"><TbSend size={16} /></button>
        )}
      </div>
      </div>
    </div>
  );
}
