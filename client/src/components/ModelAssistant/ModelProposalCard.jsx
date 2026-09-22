import { useState } from 'react';
import { TbLink, TbUnlink, TbTable, TbTag, TbSum, TbLayoutGrid, TbCheck } from 'react-icons/tb';

const cardStyle = {
  display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderRadius: 12,
  background: 'var(--bg-app)', border: '1px solid var(--border-default)',
};
const summaryStyle = { fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.45 };
const groupStyle = { display: 'flex', gap: 8, alignItems: 'flex-start' };
const iconStyle = { flexShrink: 0, marginTop: 1, color: 'var(--accent-primary)' };
const groupTitleStyle = { fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' };
const itemStyle = { fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, wordBreak: 'break-word' };
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

function Group({ icon: Icon, title, items }) {
  if (!items.length) return null;
  return (
    <div style={groupStyle}>
      <Icon size={16} style={iconStyle} />
      <div style={{ minWidth: 0 }}>
        <div style={groupTitleStyle}>{title}</div>
        {items.map((t, i) => <div key={i} style={itemStyle}>{t}</div>)}
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
  const finish = (next) => { setState(next); onOutcome?.(next); };
  if (state === 'dismissed') return <div style={itemStyle}>Dismissed</div>;

  const joins = (proposal.joins || []).map((j) => `${j.from_table}.${j.from_column} → ${j.to_table}.${j.to_column} (${CARD[j.cardinality.from]} to ${CARD[j.cardinality.to]})`);
  const removed = (proposal.removeJoins || []).map((j) => `${j.from_table}.${j.from_column} → ${j.to_table}.${j.to_column}`);
  const roles = Object.entries(proposal.tableRoles || {}).map(([t, r]) => `${t}: ${r === 'fact' ? 'FACT' : 'DIM'}`);
  const asLabel = { dimension: 'dimension', measure: 'measure (sum)', none: 'not used' };
  const fields = (proposal.fields || []).map((f) => `${f.table}.${f.column} → ${asLabel[f.as]}`);
  const measures = (proposal.measures || []).map((m) => `${m.label || m.column}: ${m.aggregation.toUpperCase()}(${m.table}.${m.column})`);

  return (
    <div style={cardStyle}>
      {proposal.summary ? <div style={summaryStyle}>{proposal.summary}</div> : null}
      <Group icon={TbLink} title="Joins" items={joins} />
      <Group icon={TbUnlink} title="Joins removed" items={removed} />
      <Group icon={TbTable} title="Table roles" items={roles} />
      <Group icon={TbTag} title="Columns" items={fields} />
      <Group icon={TbSum} title="Measures" items={measures} />
      <Group icon={TbLayoutGrid} title="Diagram" items={proposal.positions ? ['Tables arranged: facts in the middle, their dimensions around'] : []} />
      {state === 'applied' ? (
        <span style={doneStyle}><TbCheck size={14} /> Applied — Save the model to keep it</span>
      ) : (
        <div style={actionsStyle}>
          <button style={quietBtn} onClick={() => finish('dismissed')}>Dismiss</button>
          <button style={applyBtn} onClick={() => { if (onApply(proposal)) finish('applied'); }}><TbCheck size={14} /> Apply</button>
        </div>
      )}
    </div>
  );
}
