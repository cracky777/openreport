import { useState } from 'react';
import { TbHelpCircle, TbCheck } from 'react-icons/tb';
import api from '../../utils/api';
import { toast } from '../Toast/toast';
import { cardStyle, rowStyle, iconStyle, titleStyle, subStyle, actionsStyle, applyBtn, chipsStyle, chip } from './actionCardStyles';

// One closed question of the guided path (server utils/ai/guidedPath.js). A
// click is the user's answer: it is sent as their next message, and when the
// question teaches something — which domain, which column holds a role — the
// browser records it on the model's glossary first, with the user's rights.
// A `multiple` question (which pages a report should have) collects several
// picks and sends them together on Confirm.
const DECIDE = 'Decide for me';
const NONE = "I don't have it";
const ghost = (disabled) => ({ ...chip(false, disabled), color: 'var(--text-muted)', borderStyle: 'dashed' });
const learnedStyle = { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: 'var(--state-success)' };

// What the answer teaches the model, by the options picked.
async function teach(modelId, learn, picked) {
  const values = picked.map((o) => o.value).filter(Boolean);
  if (!learn || !modelId || !values.length) return false;
  const body = learn.kind === 'domain'
    ? { domains: values }
    : { fields: { [values[0]]: { role: learn.role, synonyms: learn.synonyms || [] } } };
  await api.put(`/models/${modelId}/glossary`, body);
  return true;
}

/**
 * @param {object} proposal   { question, options: [{ label, value? }], multiple?, learn?: { kind: 'domain' } | { kind: 'role', role, synonyms } }
 * @param {string} modelId    the model the answer may teach
 * @param {function} onAnswer (text) → sends the answer as the user's next message
 * @param {string} answered   the text already sent, when the card is from an earlier turn
 */
export default function QuestionCard({ proposal, modelId, onAnswer, onOutcome, answered }) {
  const [sent, setSent] = useState(answered || '');
  const [picked, setPicked] = useState(() => new Set());
  const [learned, setLearned] = useState(false);
  const done = !!sent;
  const learn = proposal.learn;
  const multiple = !!proposal.multiple;
  // The way out of a column question, unless the assistant already offered one.
  const offerNone = learn?.kind === 'role' && proposal.options.every((o) => o.value);
  const isOn = (label) => (done ? sent.split(', ').includes(label) || sent === label : picked.has(label));

  const answer = async (options, text) => {
    if (done) return;
    setSent(text);
    try {
      if (await teach(modelId, learn, options)) setLearned(true);
    } catch (err) {
      // The answer still goes through: the glossary is a memory, not a gate.
      toast(err.response?.data?.error || 'The answer could not be saved on the model');
    }
    onOutcome?.('answered');
    onAnswer(text);
  };
  const choose = (option) => {
    if (done) return;
    if (!multiple || !option.label || option.label === DECIDE || option.label === NONE) { answer([option], option.label); return; }
    setPicked((prev) => { const next = new Set(prev); if (next.has(option.label)) next.delete(option.label); else next.add(option.label); return next; });
  };
  const confirm = () => {
    const chosen = proposal.options.filter((o) => picked.has(o.label));
    if (chosen.length) answer(chosen, chosen.map((o) => o.label).join(', '));
  };

  return (
    <div style={cardStyle}>
      <div style={rowStyle}>
        <TbHelpCircle size={16} style={iconStyle} />
        <div style={{ minWidth: 0 }}>
          <div style={titleStyle}>{proposal.question}</div>
          {multiple && !done ? <div style={subStyle}>Pick one or more, then confirm.</div> : null}
          {learn?.kind === 'role' && !done ? <div style={subStyle}>Your answer is remembered on the model: next time, no question.</div> : null}
        </div>
      </div>
      <div style={chipsStyle}>
        {proposal.options.map((o) => (
          <button key={o.label} type="button" style={chip(isOn(o.label), done)} onClick={() => choose(o)} disabled={done}>{o.label}</button>
        ))}
        {offerNone && (
          <button type="button" style={sent === NONE ? chip(true, true) : ghost(done)} onClick={() => choose({ label: NONE })} disabled={done}>{NONE}</button>
        )}
        <button type="button" style={sent === DECIDE ? chip(true, true) : ghost(done)} onClick={() => choose({ label: DECIDE })} disabled={done}>{DECIDE}</button>
      </div>
      {multiple && !done && (
        <div style={actionsStyle}>
          <button type="button" style={applyBtn(picked.size > 0)} onClick={confirm} disabled={!picked.size}><TbCheck size={14} /> Confirm{picked.size ? ` (${picked.size})` : ''}</button>
        </div>
      )}
      {learned ? <span style={learnedStyle}><TbCheck size={13} /> Remembered on the model</span> : null}
    </div>
  );
}
