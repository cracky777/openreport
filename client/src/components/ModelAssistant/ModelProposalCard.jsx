import { useState } from 'react';
import { TbLink, TbUnlink, TbTable, TbTag, TbSum, TbLayoutGrid, TbCheck } from 'react-icons/tb';
import { keepModelChoices } from '../../utils/modelProposal';

const cardStyle = {
  display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderRadius: 12,
  background: 'var(--bg-app)', border: '1px solid var(--border-default)',
};
const summaryStyle = { fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.45 };
const groupStyle = { display: 'flex', gap: 8, alignItems: 'flex-start' };
const iconStyle = { flexShrink: 0, marginTop: 1, color: 'var(--accent-primary)' };
const groupTitleStyle = { fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' };
const itemStyle = { fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, wordBreak: 'break-word' };
const choiceRowStyle = { display: 'flex', alignItems: 'flex-start', gap: 6 };
const choiceStyle = { flexShrink: 0, margin: '3px 0 0', accentColor: 'var(--accent-primary)', cursor: 'pointer' };
const actionsStyle = { display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 2 };
const quietBtn = {
  padding: '6px 11px', fontSize: 12, borderRadius: 8, cursor: 'pointer',
  border: '1px solid var(--border-default)', background: 'transparent', color: 'var(--text-muted)',
};
const applyBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 11px', fontSize: 12, fontWeight: 600,
  border: 'none', borderRadius: 8, cursor: 'pointer', color: '#fff', background: 'var(--accent-primary)',
};
const doneStyle = { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--state-success)', fontWeight: 600 };
const CARD = { '*': 'many', 1: 'one' };

// `items`: [{ key, text }]. With `choose`, each line has a checkbox and an
// unticked one is left out when the card is applied.
function Group({ icon: Icon, title, items, choose, dropped }) {
  if (!items.length) return null;
  return (
    <div style={groupStyle}>
      <Icon size={16} style={iconStyle} />
      <div style={{ minWidth: 0 }}>
        <div style={groupTitleStyle}>{title}</div>
        {items.map(({ key, text }) => (choose ? (
          <label key={key} style={{ ...choiceRowStyle, ...itemStyle, opacity: dropped.has(key) ? 0.45 : 1, cursor: 'pointer' }}>
            <input type="checkbox" style={choiceStyle} checked={!dropped.has(key)} onChange={() => choose(key)} />
            <span>{text}</span>
          </label>
        ) : <div key={key} style={itemStyle}>{text}</div>))}
      </div>
    </div>
  );
}

/**
 * What the model assistant proposes, grouped by kind. Applying it changes the
 * editor, like doing it by hand would; the model is saved with Save, as usual.
 */
export default function ModelProposalCard({ proposal, onApply, onOutcome }) {
  const [state, setState] = useState('open');
  // The lines the author unticked, by the keys keepModelChoices reads.
  const [dropped, setDropped] = useState(() => new Set());
  const finish = (next) => { setState(next); onOutcome?.(next); };
  if (state === 'dismissed') return <div style={itemStyle}>Dismissed</div>;

  const joins = (proposal.joins || []).map((j, i) => ({ key: `join${i}`, text: `${j.from_table}.${j.from_column} → ${j.to_table}.${j.to_column} (${CARD[j.cardinality.from]} to ${CARD[j.cardinality.to]})` }));
  const removed = (proposal.removeJoins || []).map((j, i) => ({ key: `remove${i}`, text: `${j.from_table}.${j.from_column} → ${j.to_table}.${j.to_column}` }));
  const roles = Object.entries(proposal.tableRoles || {}).map(([t, r]) => ({ key: `role:${t}`, text: `${t}: ${r === 'fact' ? 'FACT' : 'DIM'}` }));
  const asLabel = { dimension: 'dimension', measure: 'measure (sum)', none: 'not used' };
  const fields = (proposal.fields || []).map((f, i) => ({ key: `field${i}`, text: `${f.table}.${f.column} → ${asLabel[f.as]}` }));
  const measures = (proposal.measures || []).map((m, i) => ({ key: `measure${i}`, text: `${m.label || m.column}: ${m.aggregation.toUpperCase()}(${m.table}.${m.column})` }));
  const diagram = proposal.positions ? [{ key: 'positions', text: 'Tables arranged: facts in the middle, their dimensions around' }] : [];
  const lineCount = joins.length + removed.length + roles.length + fields.length + measures.length + diagram.length;
  const choose = state === 'open' && lineCount > 1 ? (key) => setDropped((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  }) : null;
  const group = { choose, dropped };
  const nothingKept = lineCount > 0 && dropped.size === lineCount;
  const apply = () => {
    const kept = keepModelChoices(proposal, dropped);
    if (!onApply(kept)) return;
    // Kept in part, the next turn tells the model what was turned down.
    setState('applied');
    onOutcome?.(dropped.size ? { status: 'partial', kept } : 'applied');
  };

  return (
    <div style={cardStyle}>
      {proposal.summary ? <div style={summaryStyle}>{proposal.summary}</div> : null}
      <Group icon={TbLink} title="Joins" items={joins} {...group} />
      <Group icon={TbUnlink} title="Joins removed" items={removed} {...group} />
      <Group icon={TbTable} title="Table roles" items={roles} {...group} />
      <Group icon={TbTag} title="Columns" items={fields} {...group} />
      <Group icon={TbSum} title="Measures" items={measures} {...group} />
      <Group icon={TbLayoutGrid} title="Diagram" items={diagram} {...group} />
      {state === 'applied' ? (
        <span style={doneStyle}><TbCheck size={14} /> Applied — Save the model to keep it</span>
      ) : (
        <div style={actionsStyle}>
          <button style={quietBtn} onClick={() => finish('dismissed')}>Dismiss</button>
          <button style={{ ...applyBtn, opacity: nothingKept ? 0.6 : 1 }} onClick={apply} disabled={nothingKept}
            title={nothingKept ? 'Tick at least one change to apply' : undefined}>
            <TbCheck size={14} /> Apply{dropped.size ? ` ${lineCount - dropped.size} of ${lineCount}` : ''}
          </button>
        </div>
      )}
    </div>
  );
}
