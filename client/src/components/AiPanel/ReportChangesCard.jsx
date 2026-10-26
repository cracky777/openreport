import { useState } from 'react';
import { TbLayoutDashboard, TbCheck, TbPlus, TbMinus, TbReplace, TbArrowsMove, TbFilePlus, TbFileMinus, TbPencil, TbMathFunction, TbLink } from 'react-icons/tb';
import { cardStyle, rowStyle, iconStyle, titleStyle, subStyle, actionsStyle, applyBtn, quietBtn, doneStyle } from './actionCardStyles';
import { measureLine, visualName } from '../../utils/proposedMeasures';
import { syncDecisionLine } from '../../utils/syncedSlicers';

// The report changed as a whole, proposed in the AI studio (kind
// 'reportChanges', server utils/ai/reportChanges.js): page by page, what is
// added, replaced, removed, laid out again. All or nothing: the pages were
// laid out together, half of it would not fit. The studio applies it as one
// undo step; this card only asks.
const pagesStyle = { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--text-secondary)' };
const pageStyle = { display: 'flex', flexDirection: 'column', gap: 3, padding: '6px 8px', borderRadius: 6, background: 'var(--bg-panel)' };
const pageNameStyle = { fontWeight: 600, color: 'var(--text-primary)' };
const lineStyle = { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 };
const summaryStyle = { fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.45 };


function pageLines(p) {
  const lines = [];
  if (p.remove) return [{ Icon: TbFileMinus, text: 'Page removed' }];
  if (p.isNew) lines.push({ Icon: TbFilePlus, text: 'New page' });
  if (p.rename) lines.push({ Icon: TbPencil, text: `Renamed ${JSON.stringify(p.rename)}` });
  for (const w of p.add) lines.push({ Icon: TbPlus, text: visualName(w) });
  for (const r of p.replace) lines.push({ Icon: TbReplace, text: `${r.from || 'A visual'} → ${visualName(r.widget)}` });
  for (const t of p.removedTitles || []) lines.push({ Icon: TbMinus, text: t });
  if (!p.removedTitles && p.removeWidgets.length) lines.push({ Icon: TbMinus, text: `${p.removeWidgets.length} visual${p.removeWidgets.length > 1 ? 's' : ''} removed` });
  if (p.laidOut) lines.push({ Icon: TbArrowsMove, text: 'Page laid out again' });
  else if (p.moves.length) lines.push({ Icon: TbArrowsMove, text: `${p.moves.length} visual${p.moves.length > 1 ? 's' : ''} ${p.add.length ? 'moved to make room' : 'moved'}` });
  return lines;
}

export default function ReportChangesCard({ proposal, widgets, onApply, onOutcome }) {
  const [state, setState] = useState('open');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  // Titles of what goes or is replaced, read from the page shown as it is
  // when the card arrives — once applied, those widgets are gone or renamed.
  const [named] = useState(() => proposal.pages.map((p) => (p.shown ? {
    ...p,
    // A scorecard is named by its label, a text by its words.
    removedTitles: p.removeWidgets.map((id) => visualName(widgets?.[id])),
    replace: p.replace.map((r) => ({ ...r, from: widgets?.[r.widgetId] ? visualName(widgets[r.widgetId]) : '' })),
  } : p)));

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
        <TbLayoutDashboard size={16} style={iconStyle} />
        <div style={{ minWidth: 0 }}>
          <div style={titleStyle}>Changes to the report</div>
          {proposal.summary ? <div style={summaryStyle}>{proposal.summary}</div> : null}
        </div>
      </div>
      <div style={pagesStyle}>
        {proposal.title ? <div style={pageStyle}><span style={lineStyle}><TbPencil size={12} /> <span>Report renamed {JSON.stringify(proposal.title)}</span></span></div> : null}
        {(proposal.measures || []).length ? (
          <div style={pageStyle}>
            <span style={pageNameStyle}>Measures saved with the model</span>
            {proposal.measures.map((m, j) => <span key={j} style={lineStyle}><TbMathFunction size={12} /> <span>{measureLine(m)}</span></span>)}
          </div>
        ) : null}
        {(proposal.filterSync || []).length ? (
          <div style={pageStyle}>
            <span style={pageNameStyle}>Filters across pages</span>
            {proposal.filterSync.map((d, j) => <span key={j} style={lineStyle}><TbLink size={12} /> <span>{syncDecisionLine(d)}</span></span>)}
          </div>
        ) : null}
        {named.map((p, i) => (
          <div key={i} style={pageStyle}>
            <span style={pageNameStyle}>{p.isNew ? p.name : (p.name || (p.shown ? 'This page' : 'Page'))}</span>
            {pageLines(p).map((l, j) => <span key={j} style={lineStyle}><l.Icon size={12} /> <span>{l.text}</span></span>)}
          </div>
        ))}
      </div>
      {state === 'applied' ? (
        <span style={doneStyle}><TbCheck size={14} /> {note || 'Applied to the report'}</span>
      ) : (
        <div style={actionsStyle}>
          <button type="button" style={quietBtn} onClick={dismiss}>Dismiss</button>
          <button type="button" style={applyBtn(!busy)} onClick={apply} disabled={busy}><TbCheck size={14} /> {busy ? 'Applying…' : 'Apply the changes'}</button>
        </div>
      )}
    </div>
  );
}
