import { useMemo, useState } from 'react';
import { TbChartBar, TbTable, TbPlus, TbCheck, TbExternalLink, TbThumbUp, TbThumbDown, TbFilter, TbMathFunction } from 'react-icons/tb';
import { WIDGET_TYPES } from '../Widgets';
import ExportableVisual from './ExportableVisual';
import RememberCard from './RememberCard';
import { VisualPreview } from '../AiPanel/ProposalCard';
import { describeShaping, proposedVisuals, withMeasureFormats } from '../../utils/aiProposal';

const SINGLE_HEIGHT = 320;
const TILE_HEIGHT = 240;
const SMALL_HEIGHT = 110;
// Nothing a table view would add to: already a table, or a single figure.
const TABLE_TYPES = new Set(['table', 'pivotTable', 'scorecard', 'gauge', 'filter', 'customVisual']);
const SMALL_TYPES = new Set(['scorecard', 'filter']);
// A table beside a chart had half the width: its text columns broke letter by letter.
const WIDE_TYPES = new Set(['table', 'pivotTable']);
const wideTile = { gridColumn: '1 / -1' };
// Whether visual i takes the whole row: a table always; a chart left alone on
// its row by a table (or the end of the answer) too — a scatter sat at half
// the width beside nothing, above its table (credit recipe).
function spansRow(visuals, i) {
  if (WIDE_TYPES.has(visuals[i].type)) return true;
  let start = i;
  while (start > 0 && !WIDE_TYPES.has(visuals[start - 1].type)) start -= 1;
  let end = i;
  while (end < visuals.length - 1 && !WIDE_TYPES.has(visuals[end + 1].type)) end += 1;
  return (end - start + 1) % 2 === 1 && i === end;
}

const cardStyle = {
  display: 'flex', flexDirection: 'column', gap: 10, padding: 12, borderRadius: 12,
  background: 'var(--bg-app)', border: '1px solid var(--border-default)',
};
const noteStyle = { display: 'flex', alignItems: 'flex-start', gap: 5, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4, wordBreak: 'break-word' };
const noteIcon = { flexShrink: 0, marginTop: 1 };
// Wide enough in the conversation for two visuals side by side.
const tilesStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 };
const footerStyle = { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' };
const spacerStyle = { flex: 1 };
const segmentStyle = { display: 'inline-flex', padding: 2, gap: 2, borderRadius: 8, background: 'var(--bg-subtle)' };
const segmentBtn = (active) => ({
  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 8px', fontSize: 11.5, fontWeight: 600,
  border: 'none', borderRadius: 6, cursor: 'pointer',
  background: active ? 'var(--bg-panel)' : 'transparent',
  color: active ? 'var(--text-primary)' : 'var(--text-muted)',
  boxShadow: active ? '0 1px 2px rgba(15,23,42,0.10)' : 'none',
});
const rateBtn = (active) => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, padding: 0,
  border: 'none', borderRadius: 7, cursor: 'pointer',
  background: active ? 'var(--accent-primary-soft)' : 'transparent',
  color: active ? 'var(--accent-primary)' : 'var(--text-muted)',
});
const addBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 11px', fontSize: 12, fontWeight: 600,
  border: 'none', borderRadius: 8, cursor: 'pointer', color: '#fff', background: 'var(--accent-primary)',
  boxShadow: '0 1px 2px rgba(15,23,42,0.15)',
};
const addedStyle = { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--state-success)', fontWeight: 600 };
const openBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 9px', fontSize: 12, fontWeight: 600,
  border: '1px solid var(--accent-primary-border)', borderRadius: 8, cursor: 'pointer',
  color: 'var(--accent-primary)', background: 'var(--accent-primary-soft)',
};

/**
 * One answer of the assistant, in the conversation: the visual drawn on the
 * user's data (or, for code nobody has installed yet, in the no-network
 * sandbox on sample rows), and what can be done with it.
 */
export default function TalkAnswer({ proposal, model: baseModel, rating, added, onRate, onAdd, onOpen, modelId, remembered, onRemember }) {
  // The measures the assistant defined with this answer (a measure of the year
  // before, a variance): drawn with it, sent as the preview's extras.
  const made = proposal.measures;
  // With the formats and names the server gave the measures it shows
  // (dress.formatOverrides), merged into the model as the viewer does:
  // 36 800 300, not 36800300.
  const settings = useMemo(() => withMeasureFormats(made?.length ? { extraMeasures: made } : {}, proposal), [made, proposal]);
  const model = useMemo(() => {
    const over = settings.measureOverrides || {};
    const measures = [...(baseModel.measures || []).filter((m) => !made?.some((x) => x.name === m.name)), ...(made || [])];
    return { ...baseModel, measures: measures.map((m) => (over[m.name] ? { ...m, ...over[m.name] } : m)) };
  }, [baseModel, made, settings]);
  const [view, setView] = useState('chart');
  const visuals = useMemo(() => proposedVisuals(proposal), [proposal]);
  const single = visuals.length === 1 ? visuals[0] : null;
  const generated = proposal.kind === 'customVisual';
  const canToggle = !!single && !TABLE_TYPES.has(single.type);
  const shaping = single ? describeShaping(single.dataBinding, model) : '';

  return (
    <div style={cardStyle}>
      {/* A written visual brings its own heading, fields, reason and code.
          The others carry nothing above them (Jonathan: a title is "inutile",
          and a grey line over the chart read as one): the answer already says
          what is drawn — the title stays on the widget for the report it may
          be added to. What the chart cannot show goes UNDER it. */}
      {generated ? <VisualPreview proposal={proposal} model={model} /> : null}
      {!generated && single ? (
        <ExportableVisual widget={single} asTable={canToggle && view === 'table'} model={model} settings={settings} height={SMALL_TYPES.has(single.type) ? SMALL_HEIGHT : SINGLE_HEIGHT} />
      ) : null}
      {!generated && !single ? (
        <div style={tilesStyle}>
          {visuals.map((w, i) => (
            <div key={i} style={spansRow(visuals, i) ? wideTile : undefined}>
              <ExportableVisual widget={w} model={model} settings={settings} height={SMALL_TYPES.has(w.type) ? SMALL_HEIGHT : TILE_HEIGHT} />
            </div>
          ))}
        </div>
      ) : null}

      {!generated && (shaping || made?.length) ? (
        <div>
          {shaping ? <div style={noteStyle}><TbFilter size={12} style={noteIcon} aria-label="Filters" /><span>{shaping}</span></div> : null}
          {made?.length ? <div style={noteStyle}><TbMathFunction size={12} style={noteIcon} aria-label="New measures" /><span>New measure{made.length > 1 ? 's' : ''}: {made.map((m) => m.label).join(', ')} (saved with the report it is added to)</span></div> : null}
        </div>
      ) : null}
      {/* What the user taught about the fields, to keep for every later question. */}
      {proposal.remember?.length ? <RememberCard compact items={proposal.remember} modelId={modelId} outcome={remembered} onOutcome={onRemember} /> : null}
      <div style={footerStyle}>
        {canToggle && (
          <span style={segmentStyle} role="tablist" aria-label="View">
            <button role="tab" aria-selected={view === 'chart'} style={segmentBtn(view === 'chart')} onClick={() => setView('chart')}><TbChartBar size={13} /> Chart</button>
            <button role="tab" aria-selected={view === 'table'} style={segmentBtn(view === 'table')} onClick={() => setView('table')}><TbTable size={13} /> Table</button>
          </span>
        )}
        <button style={rateBtn(rating === 'up')} onClick={() => onRate('up')} title="Good answer" aria-label="Good answer" aria-pressed={rating === 'up'}><TbThumbUp size={15} /></button>
        <button style={rateBtn(rating === 'down')} onClick={() => onRate('down')} title="Bad answer" aria-label="Bad answer" aria-pressed={rating === 'down'}><TbThumbDown size={15} /></button>
        <span style={spacerStyle} />
        {added ? (
          <>
            <span style={addedStyle}><TbCheck size={14} /> {added.title}</span>
            <button style={openBtn} onClick={() => onOpen(added.reportId)}><TbExternalLink size={13} /> Open the report</button>
          </>
        ) : (
          <button style={addBtn} onClick={onAdd}>
            <TbPlus size={14} /> {generated ? 'Add to library & report' : 'Add to report'}
          </button>
        )}
      </div>
    </div>
  );
}
