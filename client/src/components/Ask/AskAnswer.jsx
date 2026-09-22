import { useMemo, useState } from 'react';
import { TbChartBar, TbTable, TbPlus, TbCheck, TbExternalLink, TbThumbUp, TbThumbDown } from 'react-icons/tb';
import { WIDGET_TYPES } from '../Widgets';
import WidgetPreview from '../AiPanel/WidgetPreview';
import { VisualPreview } from '../AiPanel/ProposalCard';
import { describeShaping, proposedVisuals } from '../../utils/aiProposal';

const NO_SETTINGS = {};
const SINGLE_HEIGHT = 260;
const TILE_HEIGHT = 200;
const SMALL_HEIGHT = 110;
// Nothing a table view would add to: already a table, or a single figure.
const TABLE_TYPES = new Set(['table', 'pivotTable', 'scorecard', 'gauge', 'filter', 'customVisual']);
const SMALL_TYPES = new Set(['scorecard', 'filter']);

const cardStyle = {
  display: 'flex', flexDirection: 'column', gap: 10, padding: 12, borderRadius: 12,
  background: 'var(--bg-app)', border: '1px solid var(--border-default)',
};
const titleStyle = { fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.35, wordBreak: 'break-word' };
const subStyle = { fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.4, marginTop: 2, wordBreak: 'break-word' };
const tileTitleStyle = { fontSize: 11.5, fontWeight: 600, color: 'var(--text-secondary)', margin: '0 0 4px' };
const tilesStyle = { display: 'flex', flexDirection: 'column', gap: 10 };
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

// The same fields, as a plain table: the numbers behind the chart.
function asTable(widget) {
  const b = widget.dataBinding || {};
  return {
    type: 'table',
    dataBinding: {
      selectedDimensions: [...new Set([...(b.selectedDimensions || []), ...(b.groupBy || []), ...(b.columnDimensions || [])])],
      selectedMeasures: b.selectedMeasures || [],
      // The same rows: a top 5 shown as a table is still five rows.
      ...(b.widgetFilters ? { widgetFilters: b.widgetFilters } : {}),
      ...(b.timePeriod ? { timePeriod: b.timePeriod } : {}),
    },
    config: { title: widget.config?.title || '', ...(widget.config?.sortOrder ? { sortOrder: widget.config.sortOrder } : {}) },
  };
}

/**
 * One answer of the assistant, in the conversation: the visual drawn on the
 * user's data (or, for code nobody has installed yet, in the no-network
 * sandbox on sample rows), and what can be done with it.
 */
export default function AskAnswer({ proposal, model, rating, added, onRate, onAdd, onOpen }) {
  const [view, setView] = useState('chart');
  const visuals = useMemo(() => proposedVisuals(proposal), [proposal]);
  const single = visuals.length === 1 ? visuals[0] : null;
  const table = useMemo(() => (single ? asTable(single) : null), [single]);
  const generated = proposal.kind === 'customVisual';
  const canToggle = !!single && !TABLE_TYPES.has(single.type);
  const shaping = single ? describeShaping(single.dataBinding, model) : '';

  return (
    <div style={cardStyle}>
      {/* A written visual brings its own heading, fields, reason and code. */}
      {generated ? <VisualPreview proposal={proposal} model={model} /> : (
        <div>
          <div style={titleStyle}>{single ? (single.config?.title || WIDGET_TYPES[single.type]?.label) : `${visuals.length} visuals`}</div>
          {shaping ? <div style={subStyle}>{shaping}</div> : null}
          {single?.rationale ? <div style={subStyle}>{single.rationale}</div> : null}
        </div>
      )}
      {!generated && single ? (
        <WidgetPreview key={view} widget={canToggle && view === 'table' ? table : single} model={model} settings={NO_SETTINGS} height={SMALL_TYPES.has(single.type) ? SMALL_HEIGHT : SINGLE_HEIGHT} />
      ) : null}
      {!generated && !single ? (
        <div style={tilesStyle}>
          {visuals.map((w, i) => (
            <div key={i}>
              <div style={tileTitleStyle}>{w.config?.title || WIDGET_TYPES[w.type]?.label}</div>
              <WidgetPreview widget={w} model={model} settings={NO_SETTINGS} height={SMALL_TYPES.has(w.type) ? SMALL_HEIGHT : TILE_HEIGHT} />
            </div>
          ))}
        </div>
      ) : null}

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
            <button style={openBtn} onClick={() => onOpen(added.reportId)}><TbExternalLink size={13} /> Open in editor</button>
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
