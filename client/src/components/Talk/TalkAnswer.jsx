import { useMemo, useState } from 'react';
import { TbChartBar, TbTable, TbPlus, TbCheck, TbExternalLink, TbThumbUp, TbThumbDown, TbFilter, TbMathFunction } from 'react-icons/tb';
import { WIDGET_TYPES } from '../Widgets';
import ExportableVisual from './ExportableVisual';
import RememberCard from './RememberCard';
import AssistantText from '../AiPanel/AssistantText';
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

// An answer in parts: each paragraph, then the visuals that show it.
const partsStyle = { display: 'flex', flexDirection: 'column', gap: 12 };

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
export default function TalkAnswer({ proposal, model: baseModel, rating, added, addedVisuals, onRate, onAdd, onOpen, modelId, remembered, onRemember, textStyle }) {
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
  const visuals = useMemo(() => proposedVisuals(proposal), [proposal]);
  const generated = proposal.kind === 'customVisual';
  // The answer written in parts (server agent.answerParts): its text is drawn
  // here, each visual after the paragraph it shows — not one chart at the end.
  const parts = !generated && Array.isArray(proposal.answer) && proposal.answer.length ? proposal.answer : null;
  // Each visual is its own card: its view, its filters, its way into a report
  // (Jonathan: one "Add to report" under the whole text added everything).
  // An answer added whole before visuals had their own button stays added.
  const card = (i, height) => (
    <VisualCard widget={visuals[i]} model={model} settings={settings} made={made} height={height}
      added={addedVisuals?.[i] || added} onAdd={() => onAdd([i])} onOpen={onOpen} />
  );
  const grid = (indexes) => (indexes.length === 1 ? card(indexes[0], SMALL_TYPES.has(visuals[indexes[0]].type) ? SMALL_HEIGHT : SINGLE_HEIGHT) : (
    <div style={tilesStyle}>
      {indexes.map((i, k) => (
        <div key={i} style={spansRow(indexes.map((j) => visuals[j]), k) ? wideTile : undefined}>
          {card(i, SMALL_TYPES.has(visuals[i].type) ? SMALL_HEIGHT : TILE_HEIGHT)}
        </div>
      ))}
    </div>
  ));
  const rateButtons = (
    <>
      <button style={rateBtn(rating === 'up')} onClick={() => onRate('up')} title="Good answer" aria-label="Good answer" aria-pressed={rating === 'up'}><TbThumbUp size={15} /></button>
      <button style={rateBtn(rating === 'down')} onClick={() => onRate('down')} title="Bad answer" aria-label="Bad answer" aria-pressed={rating === 'down'}><TbThumbDown size={15} /></button>
    </>
  );

  // A written visual brings its own heading, fields, reason and code, and goes
  // to the library and a report as one.
  if (generated) {
    return (
      <div style={cardStyle}>
        <VisualPreview proposal={proposal} model={model} settings={settings} />
        <div style={footerStyle}>
          {rateButtons}
          <span style={spacerStyle} />
          <AddButton added={added} label="Add to library & report" onAdd={() => onAdd(null)} onOpen={onOpen} />
        </div>
      </div>
    );
  }

  return (
    <div style={partsStyle}>
      {parts ? parts.map((p, k) => {
        const indexes = (p.visuals || []).filter((i) => visuals[i]);
        return (
          <div key={k} style={partsStyle}>
            <AssistantText style={textStyle} text={p.text} />
            {indexes.length ? grid(indexes) : null}
          </div>
        );
      }) : grid(visuals.map((_, i) => i))}
      {/* What the user taught about the fields, to keep for every later question. */}
      {proposal.remember?.length ? <RememberCard compact items={proposal.remember} modelId={modelId} outcome={remembered} onOutcome={onRemember} /> : null}
      <div style={footerStyle}>{rateButtons}</div>
    </div>
  );
}

/**
 * One visual of an answer: drawn on the user's data, as a chart or as its
 * table, with what the chart cannot show under it (its filters, the measures
 * made for it) and its own way into a report. No title above it (Jonathan: a
 * title is "inutile", the answer already says what is drawn — it stays on the
 * widget for the report it may be added to).
 */
function VisualCard({ widget, model, settings, made, height, added, onAdd, onOpen }) {
  const [view, setView] = useState('chart');
  const canToggle = !TABLE_TYPES.has(widget.type);
  const shaping = describeShaping(widget.dataBinding, model);
  const shown = new Set(widget.dataBinding?.selectedMeasures || []);
  const own = (made || []).filter((m) => shown.has(m.name));
  return (
    <div style={cardStyle}>
      <ExportableVisual widget={widget} asTable={canToggle && view === 'table'} model={model} settings={settings} height={height} />
      {shaping || own.length ? (
        <div>
          {shaping ? <div style={noteStyle}><TbFilter size={12} style={noteIcon} aria-label="Filters" /><span>{shaping}</span></div> : null}
          {own.length ? <div style={noteStyle}><TbMathFunction size={12} style={noteIcon} aria-label="New measures" /><span>New measure{own.length > 1 ? 's' : ''}: {own.map((m) => m.label).join(', ')} (saved with the report it is added to)</span></div> : null}
        </div>
      ) : null}
      <div style={footerStyle}>
        {canToggle && (
          <span style={segmentStyle} role="tablist" aria-label="View">
            <button role="tab" aria-selected={view === 'chart'} style={segmentBtn(view === 'chart')} onClick={() => setView('chart')}><TbChartBar size={13} /> Chart</button>
            <button role="tab" aria-selected={view === 'table'} style={segmentBtn(view === 'table')} onClick={() => setView('table')}><TbTable size={13} /> Table</button>
          </span>
        )}
        <span style={spacerStyle} />
        <AddButton added={added} label="Add to report" onAdd={onAdd} onOpen={onOpen} />
      </div>
    </div>
  );
}

function AddButton({ added, label, onAdd, onOpen }) {
  return added ? (
    <>
      <span style={addedStyle}><TbCheck size={14} /> {added.title}</span>
      <button style={openBtn} onClick={() => onOpen(added.reportId)}><TbExternalLink size={13} /> Open the report</button>
    </>
  ) : (
    <button style={addBtn} onClick={onAdd}><TbPlus size={14} /> {label}</button>
  );
}
