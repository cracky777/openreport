import { useState, useMemo } from 'react';
import { TbCheck, TbPlus, TbPalette, TbArrowsMove, TbStack2, TbBrush, TbArrowBackUp, TbPuzzle, TbBulb, TbEye } from 'react-icons/tb';
import { WIDGET_TYPES, CustomVisualWidget } from '../Widgets';
import { samplePreviewData, describeShaping } from '../../utils/aiProposal';
import WidgetPreview from './WidgetPreview';

const cardStyle = {
  border: '1px solid var(--border-default)', borderRadius: 8, background: 'var(--bg-panel)',
  padding: 10, display: 'flex', flexDirection: 'column', gap: 8,
};
const widgetBlockStyle = { display: 'flex', flexDirection: 'column', gap: 6 };
const rowStyle = { display: 'flex', gap: 8, alignItems: 'flex-start' };
const iconStyle = { flexShrink: 0, marginTop: 2, color: 'var(--accent-primary)' };
const titleStyle = { fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', wordBreak: 'break-word' };
const metaStyle = { fontSize: 11, color: 'var(--text-muted)', wordBreak: 'break-word' };
const rationaleStyle = { fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.4, marginTop: 2 };
// What the assistant cannot do for the author (remove a visual, split a page):
// set apart from the changes, since applying the card does none of it.
const adviceStyle = {
  display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 8px', fontSize: 11, lineHeight: 1.4,
  color: 'var(--text-secondary)', background: 'var(--bg-subtle)', borderLeft: '2px solid var(--accent-primary)', borderRadius: 4,
};
const adviceTitleStyle = { display: 'flex', alignItems: 'center', gap: 4, fontWeight: 600, color: 'var(--text-primary)' };
const actionsStyle = { display: 'flex', gap: 6, justifyContent: 'flex-end' };
const applyBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px', fontSize: 12, fontWeight: 600,
  border: 'none', borderRadius: 6, background: 'var(--accent-primary)', color: '#fff', cursor: 'pointer',
};
const quietBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px', fontSize: 12,
  border: '1px solid var(--border-default)', borderRadius: 6,
  background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
};
const doneStyle = { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 11, color: 'var(--text-muted)' };
const swatchStyle = (c) => ({
  display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: c,
  border: '1px solid var(--border-default)', marginRight: 3, verticalAlign: 'middle',
});

function fieldLabels(binding, model) {
  const label = (name) => {
    const f = model?.dimensions?.find((d) => d.name === name) || model?.measures?.find((m) => m.name === name);
    return f?.label || name;
  };
  const b = binding || {};
  const sm = b.scatterMeasures || {};
  const names = [
    ...(b.selectedDimensions || []), ...(b.groupBy || []), ...(b.columnDimensions || []),
    ...(b.selectedMeasures || []), sm.x, sm.y, sm.size,
  ].filter(Boolean);
  return [...new Set(names)].map(label).join(' · ');
}

const MAX_LISTED_MOVES = 2;
const OP_ICONS = { update_config: TbPalette, move: TbArrowsMove, z_order: TbStack2, report_settings: TbBrush };

function describeValue(key, v) {
  if (typeof v === 'string' && v.startsWith('#')) return <><span style={swatchStyle(v)} />{v}</>;
  if (key === 'palette' && Array.isArray(v)) return <>{v.map((c, i) => <span key={i} style={swatchStyle(c)} />)}</>;
  if (key === 'legendColors' && v && !Object.keys(v).length) return 'reset to the palette';
  if (key === 'tableConfig' && v && typeof v === 'object') {
    const colors = Object.values(v).flatMap((group) => Object.values(group)).filter((c) => typeof c === 'string');
    return <>{Object.keys(v).join(', ')} {colors.slice(0, 8).map((c, i) => <span key={i} style={swatchStyle(c)} />)}</>;
  }
  if (v && typeof v === 'object') return `${Object.keys(v).length} series`;
  return String(v);
}

function DesignOp({ op, titleOf }) {
  const Icon = OP_ICONS[op.op] || TbPalette;
  let what;
  if (op.op === 'move') what = `Move to ${op.x}, ${op.y} — ${op.w} × ${op.h}`;
  else if (op.op === 'z_order') what = op.to === 'front' ? 'Bring to front' : 'Send to back';
  else {
    what = Object.entries(op.set || {}).map(([k, v], i) => (
      <span key={k}>{i > 0 ? ' · ' : ''}{k}: {describeValue(k, v)}</span>
    ));
  }
  return (
    <div style={rowStyle}>
      <Icon size={15} style={iconStyle} />
      <div style={{ minWidth: 0 }}>
        <div style={titleStyle}>{op.op === 'report_settings' ? 'Report' : titleOf(op.widgetId)}</div>
        <div style={metaStyle}>{what}</div>
      </div>
    </div>
  );
}

const previewStyle = { height: 180, border: '1px solid var(--border-default)', borderRadius: 6, background: '#fff', overflow: 'hidden' };
const codeStyle = {
  maxHeight: 220, overflow: 'auto', margin: 0, padding: 8, fontSize: 10.5, lineHeight: 1.45,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', whiteSpace: 'pre',
  color: 'var(--text-secondary)', background: 'var(--bg-subtle)', border: '1px solid var(--border-default)', borderRadius: 6,
};
const linkBtn = { background: 'none', border: 'none', padding: 0, fontSize: 11, color: 'var(--accent-primary)', cursor: 'pointer', textAlign: 'left' };

function configDefaults(manifest) {
  const out = {};
  for (const c of manifest?.configSchema || []) if (c.default !== undefined) out[c.key] = c.default;
  return out;
}

// Code the assistant wrote, shown to the one person who may install it: what
// it looks like (running in the no-network sandbox, on made-up rows — it has
// not earned real data yet) and what it says, so adding it is a decision.
export function VisualPreview({ proposal, model }) {
  const [showCode, setShowCode] = useState(false);
  const data = useMemo(() => samplePreviewData(proposal.dataBinding, model), [proposal.dataBinding, model]);
  const config = useMemo(() => configDefaults(proposal.manifest), [proposal.manifest]);
  return (
    <>
      <div style={rowStyle}>
        <TbPuzzle size={16} style={iconStyle} />
        <div style={{ minWidth: 0 }}>
          <div style={titleStyle}>{proposal.manifest.name}</div>
          <div style={metaStyle}>New custom visual · {fieldLabels(proposal.dataBinding, model)}</div>
          {proposal.rationale ? <div style={rationaleStyle}>{proposal.rationale}</div> : null}
        </div>
      </div>
      <div style={previewStyle}>
        <CustomVisualWidget inlineBundle={proposal.visualJs} data={data} config={config} chartWidth={260} chartHeight={180} />
      </div>
      <div style={metaStyle}>Preview on sample data. The visual runs sandboxed, with no network access.</div>
      <button style={linkBtn} onClick={() => setShowCode((v) => !v)}>{showCode ? 'Hide the code' : 'Review the code'}</button>
      {showCode && <pre style={codeStyle}>{proposal.visualJs}</pre>}
    </>
  );
}

// A proposal is inert until the author applies it. Everything shown here came
// from a language model, so it is rendered as plain text, never as markup.
export default function ProposalCard({ proposal, model, widgets, reportId, settings, onApply, onOutcome }) {
  const [state, setCardState] = useState('open'); // open | applied | reverted | dismissed
  // The conversation remembers what became of the card: the next turn tells
  // the model whether its proposal was taken or turned down.
  const setState = (next) => { setCardState(next); onOutcome?.(next); };
  // What applying handed back: a note, and a way to undo the part Ctrl+Z
  // cannot reach (report settings live outside the undo stack).
  const [outcome, setOutcome] = useState(null);
  const [busy, setBusy] = useState(false);

  if (state === 'dismissed') return <div style={doneStyle}>Proposal dismissed</div>;

  const apply = async () => {
    setBusy(true);
    const result = await onApply(proposal);
    setBusy(false);
    if (!result) return;
    setOutcome(result);
    setState('applied');
  };
  const revertSettings = () => {
    outcome.revertSettings();
    setState('reverted');
  };

  const isDesign = proposal.kind === 'design';
  const isVisual = proposal.kind === 'customVisual';
  const titleOf = (id) => widgets?.[id]?.config?.title || WIDGET_TYPES[widgets?.[id]?.type]?.label || 'Widget';
  const count = isDesign ? proposal.ops.length : (proposal.widgets || []).length;
  // A whole-page arrangement is one decision, not twelve: past a few, the
  // moves read as a single line and the pixel detail stays out of the card.
  const moves = isDesign ? proposal.ops.filter((op) => op.op === 'move') : [];
  // Same for a palette: one rule applied to the page, shown as one line.
  const schemeOps = isDesign ? proposal.ops.filter((op) => op.fromScheme) : [];
  const schemeColors = schemeOps.find((op) => op.set?.palette)?.set.palette || [];
  // Colors the server put right so the result can be read (a theme switch
  // strands every hex fixed under the old theme): one line, not a list of hexes.
  const readabilityOps = isDesign ? proposal.ops.filter((op) => op.fromReadability) : [];
  const listedOps = (proposal.ops || []).filter((op) => !op.fromScheme && !op.fromReadability && !(op.op === 'move' && moves.length > MAX_LISTED_MOVES));
  let applyLabel = count > 1 ? `Add ${count} visuals` : 'Add visual';
  if (isDesign) applyLabel = `Apply ${count} change${count > 1 ? 's' : ''}`;
  if (isVisual) applyLabel = 'Add to library & insert';

  return (
    <div style={cardStyle}>
      {isDesign && proposal.summary ? <div style={rationaleStyle}>{proposal.summary}</div> : null}
      {isDesign && proposal.advice?.length ? (
        <div style={adviceStyle}>
          <div style={adviceTitleStyle}><TbBulb size={13} /> For you to decide</div>
          {proposal.advice.map((a, i) => <div key={i}>{a}</div>)}
        </div>
      ) : null}
      {isVisual && state === 'open' ? <VisualPreview proposal={proposal} model={model} /> : null}
      {isVisual && state !== 'open' ? <div style={titleStyle}>{proposal.manifest.name}</div> : null}
      {isDesign && moves.length > MAX_LISTED_MOVES ? (
        <div style={rowStyle}>
          <TbArrowsMove size={15} style={iconStyle} />
          <div style={{ minWidth: 0 }}>
            <div style={titleStyle}>New page layout</div>
            <div style={metaStyle}>Moves and resizes {moves.length} widgets: {moves.map((op) => titleOf(op.widgetId)).join(' · ')}</div>
          </div>
        </div>
      ) : null}
      {schemeOps.length > 0 ? (
        <div style={rowStyle}>
          <TbPalette size={15} style={iconStyle} />
          <div style={{ minWidth: 0 }}>
            <div style={titleStyle}>Color rule: {proposal.colorScheme}</div>
            <div style={metaStyle}>
              {schemeColors.slice(0, 10).map((c, i) => <span key={i} style={swatchStyle(c)} />)}
              {' '}on {schemeOps.length} widget{schemeOps.length > 1 ? 's' : ''} — one color per measure, a single hue for ordered series, distinct hues for categories
            </div>
          </div>
        </div>
      ) : null}
      {readabilityOps.length > 0 ? (
        <div style={rowStyle}>
          <TbEye size={15} style={iconStyle} />
          <div style={{ minWidth: 0 }}>
            <div style={titleStyle}>Readability</div>
            <div style={metaStyle}>Text and background colors adjusted on {readabilityOps.length} widget{readabilityOps.length > 1 ? 's' : ''} so everything stays readable</div>
          </div>
        </div>
      ) : null}
      {isDesign
        ? listedOps.map((op, i) => <DesignOp key={i} op={op} titleOf={titleOf} />)
        : (proposal.widgets || []).map((w, i) => {
          const Icon = WIDGET_TYPES[w.type]?.icon || TbPlus;
          return (
            <div key={i} style={widgetBlockStyle}>
              <div style={rowStyle}>
                <Icon size={16} style={iconStyle} />
                <div style={{ minWidth: 0 }}>
                  <div style={titleStyle}>{w.config?.title || WIDGET_TYPES[w.type]?.label || w.type}</div>
                  <div style={metaStyle}>{fieldLabels(w.dataBinding, model)}</div>
                  {describeShaping(w.dataBinding, model) ? <div style={metaStyle}>{describeShaping(w.dataBinding, model)}</div> : null}
                  {w.rationale ? <div style={rationaleStyle}>{w.rationale}</div> : null}
                </div>
              </div>
              {/* Once applied the visual is on the page: a second copy here
                  would only keep a query alive for nothing. */}
              {state === 'open' && WIDGET_TYPES[w.type] ? <WidgetPreview widget={w} model={model} reportId={reportId} settings={settings} /> : null}
            </div>
          );
        })}
      {state === 'open' ? (
        <div style={actionsStyle}>
          <button style={quietBtn} onClick={() => setState('dismissed')} disabled={busy}>Dismiss</button>
          <button style={{ ...applyBtn, opacity: busy ? 0.6 : 1 }} onClick={apply} disabled={busy}>
            {isDesign ? <TbCheck size={13} /> : <TbPlus size={13} />} {applyLabel}
          </button>
        </div>
      ) : (
        <div style={doneStyle}>
          <TbCheck size={13} />
          <span>{outcome?.note}</span>
          {state === 'applied' && outcome?.revertSettings && (
            <button style={quietBtn} onClick={revertSettings} title="Ctrl+Z does not cover report settings: this puts them back as they were before this proposal">
              <TbArrowBackUp size={13} /> Revert {outcome.revertWhat || 'theme'}
            </button>
          )}
          {state === 'reverted' && <span>The {outcome?.revertWhat || 'theme'} is back as it was. Ctrl+Z undoes the rest.</span>}
        </div>
      )}
    </div>
  );
}
