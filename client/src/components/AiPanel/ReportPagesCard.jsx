import { useState } from 'react';
import { TbFileText, TbCheck, TbMathFunction, TbLink } from 'react-icons/tb';
import { describeUnderstood } from '../../utils/aiProposal';
import { measureLine, visualName } from '../../utils/proposedMeasures';
import { syncDecisionLine } from '../../utils/syncedSlicers';
import { cardStyle, rowStyle, iconStyle, titleStyle, subStyle, actionsStyle, applyBtn, quietBtn, doneStyle } from './actionCardStyles';

// A whole report proposed in the AI studio (kind 'report'): its pages go into
// the open report when applied — the studio writes them, this card only asks.
const pagesStyle = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text-secondary)' };
const pageRowStyle = { display: 'flex', justifyContent: 'space-between', gap: 8, padding: '4px 8px', borderRadius: 6, background: 'var(--bg-panel)' };
const countStyle = { color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
const measureStyle = { display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px' };

export default function ReportPagesCard({ proposal, model, onApply, onOutcome }) {
  const [state, setState] = useState('open');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const visuals = proposal.pages.reduce((n, p) => n + p.widgets.length, 0);
  const understood = describeUnderstood(proposal.understood, model);

  const apply = async () => {
    if (busy) return;
    setBusy(true);
    const result = await onApply(proposal);
    setBusy(false);
    if (!result) return;
    setNote(result.note || '');
    setState('applied');
    onOutcome?.('applied');
  };
  const dismiss = () => { setState('dismissed'); onOutcome?.('dismissed'); };

  if (state === 'dismissed') return <div style={subStyle}>Dismissed</div>;
  return (
    <div style={cardStyle}>
      <div style={rowStyle}>
        <TbFileText size={16} style={iconStyle} />
        <div style={{ minWidth: 0 }}>
          <div style={titleStyle}>{proposal.title}</div>
          <div style={subStyle}>{proposal.pages.length} page{proposal.pages.length > 1 ? 's' : ''}, {visuals} visual{visuals > 1 ? 's' : ''}</div>
          {understood ? <div style={subStyle}>{understood}</div> : null}
        </div>
      </div>
      <div style={pagesStyle}>
        {proposal.pages.map((p, i) => (
          <div key={i} style={pageRowStyle}>
            <span>{i + 1}. {p.name}</span>
            <span style={countStyle}>{p.widgets.map(visualName).join(' · ')}</span>
          </div>
        ))}
        {(proposal.measures || []).map((m, j) => <span key={`m${j}`} style={measureStyle}><TbMathFunction size={12} /> {measureLine(m)}</span>)}
        {(proposal.filterSync || []).map((d, j) => <span key={`s${j}`} style={measureStyle}><TbLink size={12} /> {syncDecisionLine(d)}</span>)}
      </div>
      {state === 'applied' ? (
        <span style={doneStyle}><TbCheck size={14} /> {note || 'Added to the report'}</span>
      ) : (
        <div style={actionsStyle}>
          <button type="button" style={quietBtn} onClick={dismiss}>Dismiss</button>
          <button type="button" style={applyBtn(!busy)} onClick={apply} disabled={busy}><TbCheck size={14} /> {busy ? 'Adding…' : `Add ${proposal.pages.length} page${proposal.pages.length > 1 ? 's' : ''}`}</button>
        </div>
      )}
    </div>
  );
}
