import { useState } from 'react';
import { TbFileSpreadsheet, TbCheck, TbTable } from 'react-icons/tb';

// The recipe the assistant proposes for a file table, step by step in plain
// words, for the user to read and validate: nothing happens to the file before
// Apply. Applying rewrites the file (its as-imported copy kept, the recipe
// replayed on every refresh) and saves the model with the new tables.
const cardStyle = {
  display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderRadius: 12,
  background: 'var(--bg-app)', border: '1px solid var(--border-default)',
};
const summaryStyle = { fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.45 };
const headStyle = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' };
const stepsStyle = { margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, display: 'flex', flexDirection: 'column', gap: 2 };
const outputsStyle = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' };
const noteStyle = { fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.4 };
const errorStyle = { fontSize: 12, color: 'var(--state-danger)' };
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
const shortName = (t) => t.replace(/^[a-z0-9_]+__/, '');

/**
 * @param {object} proposal   { summary, table, lines, outputs, shape }
 * @param {function} onApply  async (proposal) => boolean — rewrites the file, saves the model
 */
export default function ShapeProposalCard({ proposal, onApply, onOutcome }) {
  const [state, setState] = useState('open');
  const [error, setError] = useState('');
  const finish = (next) => { setState(next); onOutcome?.(next); };
  if (state === 'dismissed') return <div style={noteStyle}>Dismissed</div>;
  const apply = async () => {
    setState('applying');
    setError('');
    try {
      if (await onApply(proposal)) finish('applied'); else setState('open');
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'The file could not be reshaped');
      setState('open');
    }
  };
  return (
    <div style={cardStyle}>
      {proposal.summary ? <div style={summaryStyle}>{proposal.summary}</div> : null}
      <div style={headStyle}><TbFileSpreadsheet size={16} style={{ color: 'var(--accent-primary)' }} /> {shortName(proposal.table)}: what will be done</div>
      <ol style={stepsStyle}>
        {proposal.lines.map((line, i) => <li key={i}>{line}</li>)}
      </ol>
      <div style={outputsStyle}><TbTable size={14} /> Tables after: {proposal.outputs.map(shortName).join(', ')}</div>
      {state !== 'applied' && <div style={noteStyle}>The file as imported is kept; the same steps run again whenever the file is refreshed.</div>}
      {error ? <div style={errorStyle}>{error}</div> : null}
      {state === 'applied' ? (
        <span style={doneStyle}><TbCheck size={14} /> File reshaped and the model saved</span>
      ) : (
        <div style={actionsStyle}>
          <button style={quietBtn} onClick={() => finish('dismissed')} disabled={state === 'applying'}>Dismiss</button>
          <button style={{ ...applyBtn, opacity: state === 'applying' ? 0.6 : 1 }} onClick={apply} disabled={state === 'applying'}>
            <TbCheck size={14} /> {state === 'applying' ? 'Reshaping…' : 'Apply'}
          </button>
        </div>
      )}
    </div>
  );
}
