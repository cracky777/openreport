import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TbSparkles, TbArrowUp, TbPlayerStopFilled, TbPlus, TbArrowLeft, TbChevronDown } from 'react-icons/tb';
import api from '../../utils/api';
import { toast } from '../Toast/toast';
import { useAiChat } from '../../hooks/useAiChat';
import { useGraph } from '../../hooks/graphContext';
import { useAuth } from '../../hooks/useAuth';
import { useTheme } from '../../hooks/useTheme';
import { talkColorsFor, sameColors, answerWidgets, withConfigs } from '../../utils/talkColors';
import { proposedVisuals as visualsOf } from '../../utils/aiProposal';
import AssistantText from '../AiPanel/AssistantText';
import ActionCard from '../AiPanel/ActionCard';
import QuestionCard from '../AiPanel/QuestionCard';
import Suggestions from '../AiPanel/Suggestions';
import TalkAnswer from './TalkAnswer';
import AddToReport from './AddToReport';
import ReportCard from './ReportCard';
import TalkColorsCard from './TalkColorsCard';
import RememberCard from './RememberCard';

// Let's Talk, the fourth way into the Chat home: a conversation about one
// data model, ad hoc, with no report — the user asks, the assistant answers
// in words what the cache says and draws a visual in the conversation when it
// says it better (the model chat route with `talk: true`, prompt TALK_RULES).
// A visual worth keeping goes to a report (AddToReport, revalidated and placed
// by the server); a whole report asked for is a card that creates it. The
// thread is kept for the tab, by model.

const MAX_INPUT_HEIGHT = 160;
const SUGGESTIONS = [
  { label: 'Try', items: ['What are the key figures?', 'How did the main measure evolve month by month?', 'What weighs the most, and what has changed lately?'] },
];

const talkThreadKey = (modelId) => `openreport.talk.${modelId}`;
const scrollKey = (modelId) => `openreport.talk.${modelId}.scroll`;

/**
 * @param {string} modelId          the model talked about
 * @param {function} onModelChange  (id) => void: another model, another thread
 * @param {function} onBack         back to the first question of the Chat home
 * @param {string} [firstQuestion]  typed on the Chat home before picking the model: asked at once
 */
export default function TalkConversation({ modelId, onModelChange, onBack, firstQuestion = '' }) {
  const navigate = useNavigate();
  const { scopedModels: models, selectedWs, personalWorkspace, refresh } = useGraph();
  const [model, setModel] = useState(null);
  const [draft, setDraft] = useState('');
  const [ratings, setRatings] = useState({});
  const [adding, setAdding] = useState(null); // index of the answer being added
  const threadRef = useRef(null);
  const inputRef = useRef(null);

  // The workspace open at the top: its library of custom visuals is offered.
  const workspaceId = selectedWs || personalWorkspace?.id || '';
  // The colors of the answers: Open Report's or the user's (TalkColorsCard),
  // for the app's theme, dark or light.
  const { user } = useAuth();
  const { themes, resolved } = useTheme();
  const surface = themes[resolved]?.kind === 'dark' ? 'dark' : 'light';
  const colors = useMemo(() => talkColorsFor(user?.talk_theme, surface), [user?.talk_theme, surface]);
  const getExtraBody = useCallback(() => ({ talk: true, theme: surface, ...(workspaceId ? { workspaceId } : {}) }), [workspaceId, surface]);
  const { messages, loading, send, cancel, reset, setOutcome, mark } = useAiChat(`/ai/models/${modelId}/chat`, getExtraBody, talkThreadKey(modelId));

  // Answers drawn with other colors (the user changed theirs, or the app went
  // dark / light) are drawn again: colors only, by the server's rule — once
  // per answer and colors, so a refusal never loops.
  const redrawn = useRef(new Set());
  useEffect(() => {
    const key = `${colors.base}|${colors.harmony}|${colors.theme}`;
    const stale = messages.filter((m) => m.answerId && m.proposals?.[0]?.colors && !sameColors(m.proposals[0].colors, colors)
      && answerWidgets(m.proposals[0]).length && !redrawn.current.has(`${m.answerId}|${key}`));
    if (!stale.length) return undefined;
    let cancelled = false;
    (async () => {
      for (const m of stale) {
        redrawn.current.add(`${m.answerId}|${key}`);
        const proposal = m.proposals[0];
        try {
          const widgets = answerWidgets(proposal).map((w) => ({ type: w.type, config: w.config, dataBinding: w.dataBinding }));
          const res = await api.post(`/ai/models/${modelId}/talk-colors`, { theme: colors.theme, widgets });
          if (cancelled) return;
          mark(m.answerId, { proposals: [withConfigs(proposal, res.data.configs, res.data.colors), ...m.proposals.slice(1)] });
        } catch { /* kept in the colors it had */ }
      }
    })();
    return () => { cancelled = true; };
  }, [messages, colors, modelId, mark]);

  useEffect(() => {
    let stale = false;
    api.get(`/models/${modelId}`)
      .then((res) => { if (!stale) setModel(res.data.model); })
      .catch((err) => toast(err.response?.data?.error || 'Failed to load the model'));
    return () => { stale = true; };
  }, [modelId]);

  // Back from a report: where the reader was, once the answers are drawn;
  // otherwise the end of the thread, as each answer comes.
  const restoring = useRef(null);
  if (restoring.current === null) {
    let saved = null;
    try { saved = sessionStorage.getItem(scrollKey(modelId)); sessionStorage.removeItem(scrollKey(modelId)); } catch { /* storage blocked */ }
    restoring.current = saved === null ? false : Number(saved) || 0;
  }
  useEffect(() => {
    const el = threadRef.current;
    if (!el) return undefined;
    if (restoring.current !== false) {
      const top = restoring.current;
      restoring.current = false;
      // The charts take their height as they load: set again once they have.
      el.scrollTop = top;
      const timer = setTimeout(() => { el.scrollTop = top; }, 700);
      return () => clearTimeout(timer);
    }
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    return undefined;
  }, [messages, loading]);
  useEffect(() => { inputRef.current?.focus(); }, [modelId]);
  // Asked once, even when StrictMode runs the effect twice.
  const askedRef = useRef(false);
  useEffect(() => {
    if (askedRef.current || !firstQuestion.trim()) return;
    askedRef.current = true;
    send(firstQuestion.trim());
  }, [firstQuestion, send]);

  const grow = (el) => {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_INPUT_HEIGHT)}px`;
  };

  const submit = async (text) => {
    const question = (text ?? draft).trim();
    if (!question || loading) return;
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

  const addingProposal = adding !== null ? messages[adding]?.proposals?.[0] : null;
  // To a report and back (Jonathan): the studio's Back returns to this
  // conversation, where the reader was in it.
  const openStudio = (id) => {
    try { sessionStorage.setItem(scrollKey(modelId), String(threadRef.current?.scrollTop || 0)); } catch { /* storage blocked: back at the end of the thread */ }
    navigate(`/studio/${id}`, { state: { back: `/chat?talk=${modelId}`, backLabel: "Let's Talk" } });
  };

  return (
    <section style={shellStyle} aria-label="Let's talk">
      <header style={headerStyle}>
        <button type="button" style={backBtn} onClick={onBack} title="Back to the first question"><TbArrowLeft size={14} /> Back</button>
        <span style={badgeStyle(24)}><TbSparkles size={13} /></span>
        <span style={headerTitleStyle}>Let's talk</span>
        <label style={modelPickStyle}>
          <select style={modelSelectStyle} value={modelId} onChange={(e) => onModelChange(e.target.value)} aria-label="Data model" disabled={loading}>
            {(models || []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <TbChevronDown size={12} style={chevronStyle} />
        </label>
        <span style={{ flex: 1 }} />
        <button type="button" style={iconBtn} onClick={reset} disabled={!messages.length} title="New conversation" aria-label="New conversation"><TbPlus size={16} /></button>
      </header>

      <div ref={threadRef} style={scrollStyle}>
        <div style={columnStyle}>
          {messages.length === 0 && (
            <div style={emptyStyle}>
              <span style={badgeStyle(44)}><TbSparkles size={24} /></span>
              <div style={emptyTitleStyle}>What would you like to know?</div>
              {model?.name ? <div style={emptySubStyle}>{model.name}</div> : null}
              <Suggestions groups={SUGGESTIONS} onPick={submit} disabled={loading} />
            </div>
          )}
          {messages.map((m, i) => (m.role === 'user' ? (
            <div key={i} style={userBubble}>{m.text}</div>
          ) : (
            <div key={i} style={assistantRow}>
              <span style={badgeStyle(26)}><TbSparkles size={14} /></span>
              <div style={assistantBody}>
                {m.text ? <AssistantText style={assistantText} text={m.text} /> : null}
                {visualsOf(m.proposals?.[0]).length > 0 && model && (
                  <TalkAnswer
                    proposal={m.proposals[0]}
                    model={model}
                    rating={ratings[m.answerId]}
                    added={m.added}
                    onRate={(rating) => rate(m, rating)}
                    onAdd={() => setAdding(i)}
                    modelId={modelId}
                    remembered={m.outcomes?.remember}
                    onRemember={(outcome) => setOutcome(i, 'remember', outcome)}
                    onOpen={openStudio}
                  />
                )}
                {m.proposals?.[0]?.kind === 'action' && m.proposals[0].action === 'talk_colors' && (
                  <TalkColorsCard proposal={m.proposals[0]} outcome={m.outcomes?.[0]} onOutcome={(outcome) => setOutcome(i, 0, outcome)} />
                )}
                {m.proposals?.[0]?.kind === 'action' && m.proposals[0].action === 'remember_fields' && (
                  <RememberCard items={m.proposals[0].remember || []} modelId={modelId} outcome={m.outcomes?.[0]} onOutcome={(outcome) => setOutcome(i, 0, outcome)} />
                )}
                {m.proposals?.[0]?.kind === 'action' && !['talk_colors', 'remember_fields'].includes(m.proposals[0].action) && (
                  <ActionCard proposal={m.proposals[0]} modelId={modelId} onOutcome={(outcome) => setOutcome(i, 0, outcome)} onAnswer={(text) => submit(text)} />
                )}
                {m.proposals?.[0]?.kind === 'report' && (
                  <ReportCard proposal={m.proposals[0]} model={model} modelId={modelId} workspaceId={workspaceId} created={m.created} question={m.question} answer={m.text}
                    onCreated={(where) => { setOutcome(i, 0, 'applied', { created: where }); refresh?.(); toast(`Created ${where.title}`, 'success'); }}
                    onOpen={openStudio} />
                )}
                {m.proposals?.[0]?.kind === 'question' && (
                  <QuestionCard proposal={m.proposals[0]} modelId={modelId} answered={m.outcomes?.[0] === 'answered' ? messages[i + 1]?.text : ''}
                    onOutcome={(outcome) => setOutcome(i, 0, outcome)} onAnswer={(text) => submit(text)} />
                )}
              </div>
            </div>
          )))}
          {loading && (
            <div style={assistantRow}>
              <span style={badgeStyle(26)}><TbSparkles size={14} /></span>
              <span style={dotsStyle} aria-label="Thinking"><i style={dot(0)} /><i style={dot(1)} /><i style={dot(2)} /></span>
            </div>
          )}
        </div>
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
            aria-label="Your question"
          />
          {loading ? (
            <button type="button" style={sendBtn(true)} onClick={cancel} title="Stop" aria-label="Stop"><TbPlayerStopFilled size={14} /></button>
          ) : (
            <button type="button" style={sendBtn(!!draft.trim())} onClick={() => submit()} disabled={!draft.trim()} title="Send" aria-label="Send"><TbArrowUp size={17} /></button>
          )}
        </div>
      </div>

      {addingProposal && (
        <AddToReport
          widgets={visualsOf(addingProposal)}
          generated={addingProposal.kind === 'customVisual' ? addingProposal : null}
          measures={addingProposal.measureArgs || null}
          workspaceId={workspaceId}
          modelId={modelId}
          defaultTitle={visualsOf(addingProposal).length > 1 ? (model?.name || '') : (visualsOf(addingProposal)[0].config?.title || '')}
          onClose={() => setAdding(null)}
          onAdded={(where) => {
            // `applied` is what the next turn tells the assistant about its proposal.
            setOutcome(adding, 0, 'applied', { added: where });
            setAdding(null);
            refresh?.();
            toast(`Added to ${where.title}`, 'success');
          }}
        />
      )}
    </section>
  );
}

const COLUMN = 820;
const shellStyle = { flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg-app)' };
const headerStyle = { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--border-default)', background: 'var(--bg-panel)', flexShrink: 0 };
const backBtn = { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border-default)', background: 'var(--bg-panel)', color: 'var(--text-secondary)', cursor: 'pointer' };
const headerTitleStyle = { fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.01em' };
const modelPickStyle = { position: 'relative', display: 'inline-flex', alignItems: 'center', minWidth: 0 };
const modelSelectStyle = {
  appearance: 'none', WebkitAppearance: 'none', maxWidth: 260, padding: '0 18px 0 0', fontSize: 12.5, fontWeight: 500,
  border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', outline: 'none',
  textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap',
};
const chevronStyle = { position: 'absolute', right: 2, pointerEvents: 'none', color: 'var(--text-muted)' };
const iconBtn = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, padding: 0, flexShrink: 0,
  border: 'none', borderRadius: 8, background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
};
const badgeStyle = (size) => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  width: size, height: size, borderRadius: Math.round(size * 0.32), color: '#fff',
  background: 'linear-gradient(135deg, var(--accent-primary) 0%, #c026d3 100%)',
  boxShadow: '0 2px 6px rgba(124, 58, 237, 0.30)',
});
const scrollStyle = { flex: 1, minHeight: 0, overflowY: 'auto', padding: '24px 16px 8px' };
const columnStyle = { maxWidth: COLUMN, margin: '0 auto', minHeight: '100%', display: 'flex', flexDirection: 'column', gap: 22 };
const emptyStyle = { margin: 'auto', maxWidth: 520, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center', padding: 24 };
const emptyTitleStyle = { fontSize: 18, fontWeight: 650, color: 'var(--text-primary)', letterSpacing: '-0.01em' };
const emptySubStyle = { fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 6 };
const userBubble = {
  alignSelf: 'flex-end', maxWidth: '75%', padding: '10px 14px', fontSize: 14, lineHeight: 1.5,
  borderRadius: '16px 16px 4px 16px', background: 'var(--accent-primary)', color: '#fff',
  whiteSpace: 'pre-wrap', wordBreak: 'break-word', boxShadow: '0 1px 2px rgba(15,23,42,0.12)',
};
const assistantRow = { display: 'flex', gap: 12, alignItems: 'flex-start' };
const assistantBody = { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 };
const assistantText = { fontSize: 14, lineHeight: 1.6, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', paddingTop: 3 };
const dotsStyle = { display: 'inline-flex', gap: 4, padding: '10px 2px' };
const dot = (i) => ({
  width: 6, height: 6, borderRadius: '50%', background: 'var(--accent-primary)', display: 'inline-block',
  animation: `askDot 1.2s ${i * 0.15}s infinite ease-in-out`,
});
const composerWrapStyle = { padding: '10px 16px 18px', flexShrink: 0 };
const composerStyle = {
  maxWidth: COLUMN, margin: '0 auto', display: 'flex', alignItems: 'flex-end', gap: 8, padding: '8px 8px 8px 16px', borderRadius: 18,
  border: '1px solid var(--border-default)', background: 'var(--bg-panel)', boxShadow: '0 2px 8px rgba(15,23,42,0.08)',
};
const inputStyle = {
  flex: 1, minWidth: 0, resize: 'none', padding: '7px 0', fontSize: 14, lineHeight: 1.45, fontFamily: 'inherit',
  border: 'none', outline: 'none', background: 'transparent', color: 'var(--text-primary)', maxHeight: MAX_INPUT_HEIGHT,
};
const sendBtn = (active) => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, flexShrink: 0,
  border: 'none', borderRadius: '50%', color: '#fff', cursor: active ? 'pointer' : 'default',
  background: active ? 'linear-gradient(135deg, var(--accent-primary) 0%, #c026d3 100%)' : 'var(--border-strong)',
  transition: 'background 0.15s',
});
