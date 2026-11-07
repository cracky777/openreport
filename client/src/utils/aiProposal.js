/**
 * Turning an assistant proposal into editor state. Pure, so the one rule that
 * matters is testable: a proposal is applied whole, in a single state
 * transition, or not at all.
 *
 * The server already validated the proposal against the SAVED report. The
 * editor may have moved on since (a field renamed, an extra measure removed),
 * so field names are checked again here against the model the editor holds.
 */
import { v4 as uuidv4 } from 'uuid';
import { clampPos, findFreeSlot } from './pageBounds';
import { applyContainerToGroup, pickContainer } from './mergeContainer';
import { describeModelProposal } from './modelProposal';
import { describePageNav, withPageNav } from './pageNav';
import { withFilterSync, syncDecisionLine as filterSyncLine } from './syncedSlicers';

const GRID = 20;

function namesOf(binding) {
  const b = binding || {};
  const sm = b.scatterMeasures || {};
  const rules = Array.isArray(b.widgetFilters) ? b.widgetFilters : [];
  return {
    dims: [
      ...(b.selectedDimensions || []), ...(b.groupBy || []), ...(b.columnDimensions || []), b.compareDateDim, b.timePeriod?.dim,
      ...rules.filter((r) => !r.isMeasure).map((r) => r.field),
    ].filter(Boolean),
    measures: [
      ...(b.selectedMeasures || []), ...(b.comboBarMeasures || []), ...(b.comboLineMeasures || []),
      sm.x, sm.y, sm.size, b.gaugeMaxMeasure, b.gaugeThresholdMeasure,
      ...rules.filter((r) => r.isMeasure).map((r) => r.field),
    ].filter(Boolean),
  };
}

const RULE_WORDS = {
  in: 'is', not_in: 'is not', contains: 'contains', not_contains: 'does not contain', starts_with: 'starts with',
  ends_with: 'ends with', is_empty: 'is empty', is_not_empty: 'is not empty', gt: '>', gte: '≥', lt: '<', lte: '≤', between: 'between',
};

/** What an answer will add, as widgets: a written visual counts as one; a design proposal adds none. */
export function proposedVisuals(proposal) {
  if (!proposal) return [];
  if (proposal.kind === 'customVisual') return [{ type: 'customVisual', config: { title: proposal.manifest.name }, dataBinding: proposal.dataBinding }];
  return proposal.kind === 'widgets' ? proposal.widgets || [] : [];
}

/**
 * What the assistant understood of an open request, in one line the user can
 * check: "Understood: E-commerce · Acquisition and conversion · Acquisition source = UTM".
 */
export function describeUnderstood(understood, model) {
  if (!understood) return '';
  const label = (name) => [...(model?.dimensions || []), ...(model?.measures || [])].find((f) => f.name === name)?.label || name;
  const parts = [
    understood.domain?.label,
    understood.objective?.label,
    ...(understood.roles || []).map((r) => `${r.label} = ${label(r.field)}`),
  ].filter(Boolean);
  return parts.length ? `Understood: ${parts.join(' · ')}` : '';
}

/**
 * The report settings with the formats a proposal brings for measures the
 * model leaves bare (server utils/ai/dress.js). The report's own overrides win.
 */
export function withMeasureFormats(settings, proposal) {
  const added = proposal?.measureOverrides;
  if (!added || !Object.keys(added).length) return settings;
  const current = settings?.measureOverrides || {};
  const merged = { ...current };
  // What the user asked the assistant for (`chosen`: decimals) wins over them.
  for (const [name, { chosen, ...patch }] of Object.entries(added)) merged[name] = { ...patch, ...(current[name] || {}), ...(chosen || {}) };
  return { ...(settings || {}), measureOverrides: merged };
}

/** What a proposed visual keeps of the data, in words: "Top 5 by Amount · Label contains fr · Last 12 months". */
export function describeShaping(dataBinding, model) {
  const label = (name) => [...(model?.dimensions || []), ...(model?.measures || [])].find((f) => f.name === name)?.label || name;
  const b = dataBinding || {};
  const parts = (b.widgetFilters || []).map((r) => {
    if (r.op === 'top_n' || r.op === 'bottom_n') return `${r.op === 'top_n' ? 'Top' : 'Bottom'} ${r.value} by ${label(r.field)}`;
    const values = r.op === 'between' ? r.values.join(' – ') : (r.values?.length ? r.values.join(', ') : r.value);
    return [label(r.field), RULE_WORDS[r.op] || r.op, values].filter((x) => x !== '' && x != null).join(' ');
  });
  if (b.timePeriod?.preset) parts.push(b.timePeriod.preset.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()));
  return parts.join(' · ');
}

/** Field names of a proposed widget that the editor's model does not know. */
export function unknownFields(widget, effectiveModel) {
  const dims = new Set((effectiveModel?.dimensions || []).map((d) => d.name));
  const measures = new Set((effectiveModel?.measures || []).map((m) => m.name));
  const used = namesOf(widget.dataBinding);
  return [...used.dims.filter((n) => !dims.has(n)), ...used.measures.filter((n) => !measures.has(n))];
}

function defaultSizeOf(widgetTypes, type) {
  const { w, h } = widgetTypes[type].defaultSize;
  // The registry counts in 20 px cells, except for sizes already in pixels.
  return { w: w > 100 ? w : w * GRID, h: h > 100 ? h : h * GRID };
}

/**
 * `widgetTypes` is the widget registry (components/Widgets). Passed in rather
 * than imported: it drags every chart component along, and this file has to
 * stay loadable without a DOM.
 *
 * @returns {{ layout, widgets, newIds } | { error: string }}
 */
// The page's dressing: no data, placed to the pixel where the proposal put it.
const DECOR_TYPES = new Set(['text', 'shape', 'image']);

export function applyWidgetsProposal(proposal, { layout, widgets, pageWidth, pageHeight, effectiveModel, widgetTypes }, makeId = uuidv4) {
  const list = proposal?.widgets || [];
  if (!list.length) return { error: 'Nothing to apply' };
  for (const w of list) {
    if (!widgetTypes[w.type]) return { error: `Unknown widget type: ${w.type}` };
    const unknown = unknownFields(w, effectiveModel);
    if (unknown.length) return { error: `Not in this report's model: ${unknown.join(', ')}` };
  }

  const nextLayout = [...layout];
  const nextWidgets = { ...widgets };
  const newIds = [];
  let z = layout.reduce((max, it) => Math.max(max, it.z || 0), 0);

  for (const w of list) {
    const id = makeId();
    const size = w.layout ? { w: w.layout.w, h: w.layout.h } : defaultSizeOf(widgetTypes, w.type);
    const wanted = w.layout
      ? { x: w.layout.x, y: w.layout.y }
      : { x: Math.max(0, Math.round((pageWidth - size.w) / 2)), y: Math.max(0, Math.round((pageHeight - size.h) / 2)) };
    const start = clampPos(wanted.x, wanted.y, size.w, size.h, pageWidth, pageHeight);
    // The page's dressing goes where its box says, a shape behind everything
    // (a band under a group of visuals), the rest in front; a data visual
    // takes the nearest free slot.
    const decor = DECOR_TYPES.has(w.type);
    const pos = decor && w.layout ? { x: start.x, y: start.y } : findFreeSlot(nextLayout, start.x, start.y, size.w, size.h, pageWidth, pageHeight);
    if (w.type !== 'shape') z += 1;
    nextLayout.push({ i: id, ...pos, ...size, z: w.type === 'shape' ? 0 : z });
    nextWidgets[id] = { type: w.type, data: w.data ? { ...w.data } : {}, dataBinding: { ...w.dataBinding }, config: { ...w.config } };
    newIds.push(id);
  }
  return { layout: nextLayout, widgets: nextWidgets, newIds };
}

// The frame a replaced visual keeps: how it sits on the page, not what it shows.
const FRAME_KEYS = ['backgroundColor', 'transparentBg', 'borderEnabled', 'borderColor', 'borderRadius', 'titleColor'];
const frameOf = (config) => Object.fromEntries(FRAME_KEYS.filter((k) => config?.[k] !== undefined).map((k) => [k, config[k]]));

/**
 * Apply a change of the report as a whole (kind 'reportChanges', server
 * utils/ai/reportChanges.js): page by page, visuals removed, replaced in
 * their slot (the frame kept), moved where the server laid them, added at
 * the place it gave them; pages added, renamed, removed. One new list of
 * pages, so the studio keeps it as one undo step. What no longer fits (a
 * widget or a page gone since) is skipped and counted. The last page is
 * never removed.
 * @returns {{ pages: object[], applied: number, skipped: number } | { error: string }}
 */
// A text widget that holds the report's title (the Finance package heads its
// pages with it) follows a rename.
const retitle = (page, from, to) => {
  if (!from || !to || from === to) return page;
  const widgets = { ...(page.widgets || {}) };
  let changed = false;
  for (const [id, w] of Object.entries(widgets)) {
    if (w && w.type === 'text' && String(w.data?.text || '').trim() === from) { widgets[id] = { ...w, data: { ...w.data, text: to } }; changed = true; }
  }
  return changed ? { ...page, widgets } : page;
};

export function applyReportChanges(proposal, { pages, currentIdx, pageWidth, pageHeight, effectiveModel, widgetTypes, title = '' }, makeId = uuidv4) {
  const entries = proposal?.pages || [];
  const unknown = entries.flatMap((p) => [...(p.add || []), ...(p.replace || []).map((r) => r.widget)]).flatMap((w) => unknownFields(w, effectiveModel));
  if (unknown.length) return { error: `Not in this report's model: ${[...new Set(unknown)].join(', ')}` };
  // The page may grow with what is laid out on it.
  const height = Math.max(pageHeight, Number(proposal.pageHeight) || 0);
  let list = pages.map((p) => ({ ...p }));
  const removedPages = new Set();
  // The ids the new pages get, in the payload's order: a sync names them "new:k".
  const newIds = [];
  let applied = 0;
  let skipped = 0;
  for (const entry of entries) {
    if (entry.isNew) {
      const made = applyWidgetsProposal({ widgets: entry.add || [] }, { layout: [], widgets: {}, pageWidth, pageHeight: height, effectiveModel, widgetTypes }, makeId);
      if (made.error) { skipped += 1; newIds.push(null); continue; }
      const id = `page-${makeId()}`;
      newIds.push(id);
      list.push({ id, name: entry.name || `Page ${list.length + 1}`, layout: made.layout, widgets: made.widgets });
      applied += 1;
      continue;
    }
    const idx = entry.shown ? currentIdx : list.findIndex((p) => p.id === entry.pageId);
    const page = list[idx];
    if (!page) { skipped += 1; continue; }
    if (entry.remove) { removedPages.add(page.id); applied += 1; continue; }
    let layout = [...(page.layout || [])];
    let widgets = { ...(page.widgets || {}) };
    for (const id of entry.removeWidgets || []) {
      if (!widgets[id]) { skipped += 1; continue; }
      delete widgets[id];
      layout = layout.filter((it) => it.i !== id);
      applied += 1;
    }
    for (const { widgetId, widget } of entry.replace || []) {
      const old = widgets[widgetId];
      if (!old) { skipped += 1; continue; }
      widgets[widgetId] = { type: widget.type, data: widget.data ? { ...widget.data } : {}, dataBinding: { ...widget.dataBinding }, config: { ...frameOf(old.config), ...widget.config } };
      applied += 1;
    }
    for (const op of entry.moves || []) {
      if (!layout.some((it) => it.i === op.widgetId)) { skipped += 1; continue; }
      const w = Math.min(op.w, pageWidth);
      const h = Math.min(op.h, height);
      const rect = { ...clampPos(op.x, op.y, w, h, pageWidth, height), w, h };
      layout = layout.map((it) => (it.i === op.widgetId ? { ...it, ...rect } : it));
      applied += 1;
    }
    if ((entry.add || []).length) {
      const made = applyWidgetsProposal({ widgets: entry.add }, { layout, widgets, pageWidth, pageHeight: height, effectiveModel, widgetTypes }, makeId);
      if (made.error) skipped += 1;
      else { layout = made.layout; widgets = made.widgets; applied += entry.add.length; }
    }
    const name = entry.rename || page.name;
    if (entry.rename) applied += 1;
    list[idx] = { ...page, name, layout, widgets };
  }
  if (removedPages.size && removedPages.size < list.length) list = list.filter((p) => !removedPages.has(p.id));
  else if (removedPages.size) { skipped += removedPages.size; applied -= removedPages.size; }
  // Filters synced across pages as the card says: page tokens are page ids,
  // "new:k" the k-th page added above, the page shown by its own id.
  if ((proposal.filterSync || []).length) {
    const idOf = (t) => {
      const m = /^new:(\d+)$/.exec(String(t));
      return m ? newIds[Number(m[1])] || null : t;
    };
    const decisions = proposal.filterSync.map((d) => ({ dim: d.dim, page: idOf(d.page), pages: (d.pages || []).map(idOf).filter(Boolean) })).filter((d) => d.page);
    const before = list;
    list = withFilterSync(list, decisions);
    applied += list.filter((p, i) => p !== before[i]).length;
  }
  if (proposal.title && title) list = list.map((p) => retitle(p, title, proposal.title));
  return { pages: list, applied, skipped };
}

/**
 * Put a visual the assistant wrote on the page, once it is in the library.
 * `visual` is what the server stored (its id may differ from the proposed one:
 * generated visuals are namespaced), `wsId` the workspace whose library it is in.
 *
 * @returns {{ layout, widgets, newIds } | { error: string }}
 */
export function applyVisualProposal(proposal, visual, wsId, ctx, makeId = uuidv4) {
  return applyWidgetsProposal({
    widgets: [{
      type: 'customVisual',
      dataBinding: proposal.dataBinding,
      layout: proposal.layout,
      config: {
        title: visual.name,
        visualId: visual.id,
        visualName: visual.name,
        bundleUrl: `/api/workspaces/${wsId}/visuals/${visual.id}/bundle.js`,
        manifest: visual.manifest,
      },
    }],
  }, ctx, makeId);
}

/**
 * Made-up rows in the shape a custom visual receives, for previewing code that
 * is not installed yet. Invented on purpose: a preview must not need the data
 * the admin has not yet decided to hand to this code.
 */
export function samplePreviewData(dataBinding, effectiveModel) {
  const find = (list, name) => (list || []).find((f) => f.name === name);
  const dims = (dataBinding?.selectedDimensions || []).map((n) => {
    const d = find(effectiveModel?.dimensions, n);
    return { name: d?.label || n, role: 'category', sourceName: n };
  });
  const measures = (dataBinding?.selectedMeasures || []).map((n) => {
    const m = find(effectiveModel?.measures, n);
    return { name: m?.label || n, role: 'value', sourceName: n, format: m?.format };
  });
  const rows = Array.from({ length: dims.length ? 6 : 1 }, (_, i) => {
    const row = {};
    dims.forEach((d) => { row[d.name] = `${d.name} ${String.fromCharCode(65 + i)}`; });
    measures.forEach((m, j) => { row[m.name] = 120 + ((i * 37 + j * 53) % 90) * 10; });
    return row;
  });
  return { rows, fields: { dimensions: dims, measures } };
}

/**
 * A proposal as one line of text, for the conversation sent back on the next
 * turn. The server is stateless and only text travels: without this the model
 * has no memory of what it proposed, and "make it a line chart instead" has
 * nothing to refer to. `outcome` is what the author did with the card.
 */
export function describeProposal(proposal, outcome) {
  // Applied in part: the model is told only what was kept.
  if (outcome && typeof outcome === 'object') return describeProposal(outcome.kept, 'partial');
  if (proposal.kind === 'model') return describeModelProposal(proposal, outcome);
  if (proposal.kind === 'shape') {
    const status = { applied: 'applied by the user: the file is reshaped and the model saved', dismissed: 'dismissed by the user' }[outcome] || 'not applied yet';
    return `[Proposed reshaping of ${proposal.table} — ${status}: ${proposal.lines.join('; ')}]`.slice(0, 1500);
  }
  if (proposal.kind === 'undo') {
    const status = { applied: 'the user took the change back', dismissed: 'the user kept the change' }[outcome] || 'not decided yet';
    return `[Offered to undo the change (${proposal.reason || 'no reason given'}) — ${status}]`.slice(0, 600);
  }
  // The answer is the user's next message: only the question is recorded.
  // The filter sync question is marked: the server reads the mark to know the
  // user was asked (server utils/ai/filterSync.js), never the user's words.
  if (proposal.kind === 'question' && proposal.about === 'filter_sync') return `[Asked the user about filter sync: ${JSON.stringify(proposal.question)} — options: ${proposal.options.map((o) => o.label).join(' | ')}]`.slice(0, 600);
  if (proposal.kind === 'question') return `[Asked the user: ${JSON.stringify(proposal.question)} — options: ${proposal.options.map((o) => o.label).join(' | ')}]`.slice(0, 600);
  if (proposal.kind === 'reportChanges') {
    const status = { applied: 'applied by the user', dismissed: 'dismissed by the user' }[outcome] || 'not applied yet';
    const pages = (proposal.pages || []).map((p) => {
      const what = p.remove ? ['removed'] : [
        p.rename && `renamed ${JSON.stringify(p.rename)}`,
        p.add.length && `added ${p.add.map((w) => JSON.stringify(w.config?.title || w.type)).join(', ')}`,
        p.replace.length && `replaced ${p.replace.length} by ${p.replace.map((r) => JSON.stringify(r.widget.config?.title || r.widget.type)).join(', ')}`,
        p.removeWidgets.length && `removed ${p.removeWidgets.length}`,
        p.laidOut ? 'laid out again' : p.moves.length && `${p.moves.length} moved to make room`,
      ].filter(Boolean);
      return `${p.isNew ? 'new page' : 'page'} ${JSON.stringify(p.name)}: ${what.join(', ')}`;
    });
    const extras = [
      ...(proposal.title ? [`report renamed ${JSON.stringify(proposal.title)}`] : []),
      ...(proposal.filterSync || []).map(filterSyncLine),
      ...((proposal.measures || []).length ? [`measures defined: ${proposal.measures.map((m) => `${m.name} (${m.label})`).join(', ')}`] : []),
    ];
    return `[Proposed changes to the report — ${status}: ${String(proposal.summary || '').slice(0, 200)} ${[...extras, ...pages].join('; ')}]`.slice(0, 1500);
  }
  if (proposal.kind === 'report') {
    const status = outcome === 'applied' ? 'created by the user' : outcome === 'dismissed' ? 'dismissed by the user' : 'not created yet';
    const synced = (proposal.filterSync || []).map(filterSyncLine);
    return `[Proposed report — ${status}: ${JSON.stringify(proposal.title)}, pages: ${proposal.pages.map((p) => `${p.name} (${p.widgets.length} visuals)`).join('; ')}${synced.length ? `; ${synced.join('; ')}` : ''}]`.slice(0, 1500);
  }
  const status = {
    applied: 'applied by the user', reverted: 'applied by the user', dismissed: 'dismissed by the user',
    partial: 'partly applied by the user — only what follows was kept, the rest turned down',
  }[outcome] || 'not applied yet';
  let what = '';
  if (proposal.kind === 'design') {
    what = `${proposal.ops.length} design change(s): ${String(proposal.summary || '').slice(0, 200)}`;
  } else if (proposal.kind === 'action') {
    what = proposal.cron ? `${proposal.action} (${proposal.cron})` : proposal.action;
  } else if (proposal.kind === 'customVisual') {
    what = `custom visual ${JSON.stringify(proposal.manifest?.name || '')} on ${JSON.stringify(proposal.dataBinding || {})}`;
  } else {
    what = (proposal.widgets || []).map((w) => (
      `${w.config?.subType ? `${w.type}/${w.config.subType}` : w.type} ${JSON.stringify(w.config?.title || '')} ${JSON.stringify(w.dataBinding || {})}`
    )).join(' ; ');
    // Defined in a conversation with no report (Let's Talk), they exist nowhere
    // else: a follow-up that uses them again declares them again.
    if ((proposal.measureArgs || []).length) what += ` ; measures defined with it (declare them again in measures to reuse them): ${JSON.stringify(proposal.measureArgs)}`;
  }
  return `[Proposed — ${status}: ${what}]`.slice(0, 1500);
}

// The look keys the assistant may read and set. The server holds the same
// list with a type per key; here it guards what leaves the browser (a config
// also carries image data) and what a proposal may write.
export const DESIGN_KEYS = [
  'title', 'titleColor', 'titleFontFamily', 'titleFontSize', 'titleWeight', 'titleAlign', 'titlePosition', 'backgroundColor', 'transparentBg', 'gradientBg',
  'borderEnabled', 'borderColor', 'borderRadius', 'shadow', 'mergeSeparatorColor', 'color', 'legendColors',
  'palette', 'legendSymbols', 'valueGradient', 'heatmap', 'increaseColor', 'decreaseColor', 'totalColor',
  'showDataLabels', 'dataLabelContent', 'dataLabelPosition', 'dataLabelRotate', 'dataLabelFontSize',
  'dataLabelColor', 'dataLabelFontFamily', 'dataLabelBgColor', 'dataLabelBgOpacity', 'dataLabelAbbr',
  'valueAbbreviation', 'showColumnNames', 'axisLabelOverflow', 'showXAxis', 'showYAxis', 'showSecondaryAxis',
  'showXAxisTitle', 'showYAxisTitle', 'showSecondaryYAxisTitle', 'xAxisTitle', 'yAxisTitle',
  'secondaryYAxisTitle', 'xAxisLineColor', 'yAxisLineColor', 'secondaryYAxisLineColor', 'xAxisLabelRotate',
  'xAxisLabelFontSize', 'yAxisLabelFontSize', 'secondaryYAxisLabelFontSize', 'xAxisLabelColor',
  'yAxisLabelColor', 'secondaryYAxisLabelColor', 'xAxisLabelFontFamily', 'yAxisLabelFontFamily',
  'secondaryYAxisLabelFontFamily', 'headerFontSize', 'headerColor', 'headerFontFamily', 'headerBold',
  'gridLineStyle', 'gridLineWidth', 'gridLineColor', 'showLegend', 'legendPosition', 'legendFontFamily',
  'legendTextColor', 'barDirection', 'smooth', 'showArea', 'lineSymbol', 'lineSymbolSize', 'donut',
  'symbolSize', 'showItemBorder', 'itemBorderColor', 'itemBorderWidth', 'showTotal', 'totalLabel',
  'gaugeColor', 'gaugeTrackColor', 'gaugeThresholdColor', 'gaugeOverColor', 'gaugeConditionalColor',
  'gaugeDirection', 'gaugeArcWidth', 'gaugeArcSpan', 'gaugeArcRounded', 'gaugeShowValue', 'gaugeValueSize',
  'gaugeValueColor', 'gaugeValueFontFamily', 'gaugeShowLabel', 'gaugeLabelSize', 'gaugeLabelColor',
  'gaugeLabelFontFamily', 'gaugeShowMinMax', 'gaugeAxisSize', 'gaugeAxisColor', 'gaugeAxisOutset',
  'gaugeAxisCenterPull', 'dateLayout', 'orientation', 'showSearch', 'showSelectAll', 'searchPlaceholder',
  'slicerFontSize', 'slicerFontColor', 'slicerFontFamily', 'slicerSelectedColor', 'slicerSelectedBg',
  'labelPosition', 'showValue', 'valueSize', 'valueColor', 'valueFontFamily', 'valueWeight', 'showLabel',
  'labelSize', 'labelColor', 'labelFontFamily', 'showN1Value', 'showN1Difference', 'showN1Percent',
  'n1ValueStyle', 'n1DifferenceStyle', 'n1PercentStyle', 'padding', 'fontSize', 'fontFamily', 'bold', 'italic', 'textAlign', 'verticalAlign',
  'shapeFill', 'shapeStroke', 'shapeStrokeWidth', 'shapeOpacity', 'lineColor', 'lineThickness',
  'lineRotation', 'arrowDirection', 'fit', 'rotation', 'tableConfig',
  'highlight', 'scaleColor', 'scaleLowColor', 'showScale', 'cellGap', 'cellRadius', 'cellBorderColor', 'mapEmptyColor', 'mapBorderColor', 'mapBubbleMax',
];
const DESIGN_KEY_SET = new Set(DESIGN_KEYS);
// A text widget's config key → the run key that overrides it (utils/textRuns runStyle).
const TEXT_RUN_KEYS = { color: 'color', fontSize: 'fontSize', fontFamily: 'fontFamily', bold: 'bold', italic: 'italic' };
export const PAGE_LOOK_KEYS = ['gradientBg', 'surroundColor', 'showBorder', 'borderRadius', 'showShadow', 'transparentBg'];
const MERGED_OBJECTS = new Set(['gradientBg', 'shadow', 'valueGradient', 'n1ValueStyle', 'n1DifferenceStyle', 'n1PercentStyle']);
const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
const ASSET_URL = /^\/uploads\/images\/[A-Za-z0-9._-]+$/;
const BACKGROUND_SIZES = new Set(['cover', 'contain', 'repeat']);
const COLOR_KEYS_BY_NAME = new Set(['color', 'slicerSelectedBg', 'shapeFill', 'shapeStroke']);
// `gaugeConditionalColor` is the one "…Color" that is a switch, not a color.
const isColorKey = (k) => k !== 'gaugeConditionalColor'
  && (COLOR_KEYS_BY_NAME.has(k) || k.endsWith('Color') || /^stripeColor\d$/.test(k));

// The appearance groups of a table's `tableConfig`. `columns` (formats,
// widths, conditional formatting) and `freeze` are the author's: they neither
// leave the browser nor can a proposal write them.
const TABLE_LOOK = {
  header: ['show', 'fontSize', 'fontColor', 'fontFamily', 'fontBold', 'fontItalic', 'bgColor', 'alignment', 'verticalAlignment', 'wordWrap'],
  values: ['fontSize', 'fontColor', 'fontFamily', 'fontBold', 'fontItalic', 'bgColor', 'alignment', 'verticalAlignment', 'wordWrap'],
  rows: ['height', 'striped', 'stripeColor1', 'stripeColor2', 'bgColor', 'hoverHighlight', 'hoverColor'],
  grid: ['horizontalLines', 'horizontalColor', 'horizontalWidth', 'verticalLines', 'verticalColor', 'verticalWidth', 'outerBorder', 'outerBorderColor', 'outerBorderWidth', 'cellPadding'],
  totals: ['bgColor', 'fontColor', 'fontBold', 'borderTopColor'],
};

function pickTableLook(tableConfig) {
  const out = {};
  for (const [group, keys] of Object.entries(TABLE_LOOK)) {
    const picked = {};
    for (const k of keys) {
      const v = tableConfig?.[group]?.[k];
      // Typed by the server; here only plain values pass (never an object or image data).
      if (v === undefined || (isColorKey(k) ? !HEX.test(v) : (v !== null && !['boolean', 'number', 'string'].includes(typeof v)))) continue;
      picked[k] = v;
    }
    if (Object.keys(picked).length) out[group] = picked;
  }
  return Object.keys(out).length ? out : undefined;
}

function pickDesign(config) {
  const out = {};
  for (const k of DESIGN_KEYS) {
    const v = k === 'tableConfig' ? pickTableLook(config?.tableConfig) : config?.[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

// Group by group, so a new header color keeps the zebra, the column formats
// and everything else the author set up.
function mergeTableLook(current, look) {
  const next = { ...(current || {}) };
  for (const [group, values] of Object.entries(look)) next[group] = { ...(next[group] || {}), ...values };
  return next;
}

/**
 * Apply a design proposal. Layout and widget changes come back as one state so
 * the editor can commit them in a single undo step; `settings` is returned
 * apart (null when untouched) because the report settings live outside the
 * undo stack and the caller has to offer its own way back.
 *
 * Operations that no longer fit the page — a widget deleted since the
 * question was asked — are skipped and counted rather than failing the rest.
 *
 * @returns {{ layout, widgets, settings, applied: number, skipped: number }}
 */
export function applyDesignProposal(proposal, { layout, widgets, settings, pageWidth, pageHeight, themes }) {
  let nextLayout = layout;
  let nextWidgets = widgets;
  let nextSettings = null;
  let applied = 0;
  let skipped = 0;
  // The boxes may run past the page: it grows to the height the server measured.
  const height = Math.max(pageHeight, Number(proposal?.pageHeight) || 0);
  if (height > pageHeight) nextSettings = { ...(settings || {}), pageHeight: height };

  for (const op of proposal?.ops || []) {
    // The page menu (utils/pageNav.js): its look and an icon per page.
    if (op.op === 'page_nav') {
      nextSettings = withPageNav(nextSettings || settings, op);
      applied += 1;
      continue;
    }
    if (op.op === 'report_settings') {
      // Only what actually changes: "switch to light" on a light report is not
      // a change, and would leave the card offering to revert nothing.
      const current = nextSettings || settings || {};
      const patch = {};
      if (op.set?.theme && themes?.[op.set.theme] && op.set.theme !== (current.theme?.key || 'light')) {
        patch.theme = { key: op.set.theme, ...themes[op.set.theme] };
      }
      const background = op.set?.pageBackground || '';
      if (HEX.test(background) && background.toLowerCase() !== String(current.backgroundColor || '').toLowerCase()) {
        patch.backgroundColor = background;
      }
      // An image behind the cards: an upload the user added (the server only
      // passes those), or null to take it off.
      if (op.set && 'backgroundImage' in op.set) {
        const image = op.set.backgroundImage;
        if (image === null ? current.backgroundImage : (typeof image === 'string' && ASSET_URL.test(image) && image !== current.backgroundImage)) patch.backgroundImage = image;
      }
      if (BACKGROUND_SIZES.has(op.set?.backgroundSize) && op.set.backgroundSize !== (current.backgroundSize || 'cover')) patch.backgroundSize = op.set.backgroundSize;
      // The rest of the page's look (server PAGE_LOOK, typed there).
      for (const k of PAGE_LOOK_KEYS) {
        const v = op.set?.[k];
        if (v === undefined) continue;
        if (k === 'gradientBg') { if (v && typeof v === 'object') patch.gradientBg = { ...(current.gradientBg || {}), ...v }; continue; }
        if (k === 'surroundColor' ? (v === null || HEX.test(v)) : ['boolean', 'number'].includes(typeof v)) patch[k] = v;
      }
      if (!Object.keys(patch).length) { skipped += 1; continue; }
      nextSettings = { ...(nextSettings || settings), ...patch };
      applied += 1;
      continue;
    }

    const widget = nextWidgets[op.widgetId];
    const item = nextLayout.find((it) => it.i === op.widgetId);
    if (!widget || !item) { skipped += 1; continue; }

    if (op.op === 'update_config') {
      const set = {};
      for (const [k, v] of Object.entries(op.set || {})) {
        if (!DESIGN_KEY_SET.has(k)) continue;
        if (k === 'tableConfig') {
          const look = pickTableLook(v);
          if (look) set.tableConfig = mergeTableLook(widget.config?.tableConfig, look);
          continue;
        }
        if (k === 'palette') {
          if (Array.isArray(v) && v.length > 0 && v.length <= 20 && v.every((c) => HEX.test(c))) set.palette = v;
          continue;
        }
        if (isColorKey(k) && !HEX.test(v)) continue;
        // A gradient, a shadow, a N-1 style: merged, so turning a shadow on
        // keeps the blur and color the author chose. legendColors / legendSymbols
        // are maps that replace (an empty one clears the overrides).
        if (MERGED_OBJECTS.has(k) && v && typeof v === 'object') { set[k] = { ...(widget.config?.[k] || {}), ...v }; continue; }
        set[k] = v;
      }
      if (!Object.keys(set).length) { skipped += 1; continue; }
      // A text's runs carry their own style, which wins over the widget's: a
      // title made in navy kept its navy under a design card that set it light
      // (the assistant saw `color` set and the text unchanged). Restyling a
      // text restyles all of it: the runs let go of what the card sets.
      const runKeys = widget.type === 'text' ? Object.keys(set).map((k) => TEXT_RUN_KEYS[k]).filter(Boolean) : [];
      const data = runKeys.length && Array.isArray(widget.data?.runs)
        ? { ...widget.data, runs: widget.data.runs.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !runKeys.includes(k)))) }
        : widget.data;
      const updated = { ...widget, ...(data !== widget.data ? { data } : {}), config: { ...(widget.config || {}), ...set } };
      nextWidgets = { ...nextWidgets, [op.widgetId]: updated };
      // Restyling one half of a merged block would split it back into two
      // cards: the container half of the edit follows the whole group.
      const gid = updated.config.mergeGroup;
      if (gid) nextWidgets = applyContainerToGroup(nextWidgets, gid, pickContainer(updated.config));
      applied += 1;
    } else if (op.op === 'move') {
      // A merged block travels as one piece.
      if (widget.config?.mergeGroup) { skipped += 1; continue; }
      // Size first, then position: the page edge moves the widget back in
      // rather than squeezing it, which is what a resize gesture would do.
      const w = Math.min(op.w, pageWidth);
      const h = Math.min(op.h, height);
      const rect = { ...clampPos(op.x, op.y, w, h, pageWidth, height), w, h };
      nextLayout = nextLayout.map((it) => (it.i === op.widgetId ? { ...it, ...rect } : it));
      applied += 1;
    } else if (op.op === 'z_order') {
      const zs = nextLayout.map((it) => it.z || 1);
      const z = op.to === 'front' ? Math.max(...zs) + 1 : Math.max(1, Math.min(...zs) - 1);
      nextLayout = nextLayout.map((it) => (it.i === op.widgetId ? { ...it, z } : it));
      applied += 1;
    } else {
      skipped += 1;
    }
  }
  return { layout: nextLayout, widgets: nextWidgets, settings: nextSettings, applied, skipped };
}

/**
 * A design proposal across the report: each operation lands on the page
 * that holds its widget (`pageId`, set by the server for the other pages;
 * none = the page shown), report settings with the page shown. One result
 * for the whole report, so the studio keeps it as one undo step.
 * @returns {{ pages: object[], settings: object|null, applied: number, skipped: number }}
 */
export function applyDesignToPages(proposal, { pages, currentIdx, settings, pageWidth, pageHeight, themes }) {
  const current = pages[currentIdx];
  const byPage = new Map();
  let skipped = 0;
  for (const op of proposal?.ops || []) {
    const id = op.pageId && op.pageId !== current?.id ? op.pageId : current?.id;
    // A page gone since the proposal: its change is dropped, not landed elsewhere.
    if (!pages.some((p) => p.id === id)) { skipped += 1; continue; }
    if (!byPage.has(id)) byPage.set(id, []);
    byPage.get(id).push(op);
  }
  let applied = 0;
  let nextSettings = null;
  const next = pages.map((p) => {
    const ops = byPage.get(p.id);
    if (!ops) return p;
    const r = applyDesignProposal({ ...proposal, ops }, { layout: p.layout || [], widgets: p.widgets || {}, settings, pageWidth, pageHeight, themes });
    applied += r.applied;
    skipped += r.skipped;
    if (r.settings) nextSettings = r.settings;
    return r.applied ? { ...p, layout: r.layout, widgets: r.widgets } : p;
  });
  return { pages: next, settings: nextSettings, applied, skipped };
}

// Past this many moves, a card shows a whole-page arrangement as one line.
export const MAX_LISTED_MOVES = 2;

/**
 * The line of a design card an operation belongs to, which the author may
 * untick: a palette, the readability fixes and a whole-page arrangement are
 * one decision each, any other operation is its own.
 */
export function designChoice(op, index, moveCount) {
  if (op.fromScheme) return 'scheme';
  if (op.fromReadability) return 'readability';
  if (op.op === 'move' && moveCount > MAX_LISTED_MOVES) return 'layout';
  return `op${index}`;
}

/** The proposal without the lines the author unticked (`dropped`, a Set of choice keys). */
export function keepChoices(proposal, dropped) {
  if (!dropped.size) return proposal;
  if (proposal.kind === 'design') {
    const moveCount = proposal.ops.filter((op) => op.op === 'move').length;
    return { ...proposal, ops: proposal.ops.filter((op, i) => !dropped.has(designChoice(op, i, moveCount))) };
  }
  if (proposal.kind === 'widgets') return { ...proposal, widgets: proposal.widgets.filter((_, i) => !dropped.has(`w${i}`)) };
  return proposal;
}

/**
 * What the assistant is told about the page being edited: bindings, geometry
 * and the current look. Fetched rows (`widget.data`) stay in the browser.
 */
export function buildPageContext({ layout, widgets, pageWidth, pageHeight, settings, themes, palette, otherPages = [], pageId = null, pageName = '' }) {
  return {
    pageWidth,
    pageHeight,
    // Which page is shown: a change of the report names its pages (the studio).
    pageId,
    pageName,
    themes: Object.keys(themes || {}),
    theme: settings?.theme?.key || null,
    pageBackground: settings?.backgroundColor || null,
    // Whether the page has an image behind its cards, never the image itself.
    pageImage: !!settings?.backgroundImage,
    // The page menu's look and icons, never an image.
    pageNav: describePageNav(settings?.pageNav),
    palette: palette || [],
    widgets: layout.filter((it) => widgets[it.i]).map((it) => describeWidget(it, widgets[it.i])),
    // The report's other pages, so a style or a size asked for the whole
    // report reaches them, and a visual added to one is set into it.
    otherPages: otherPages.map((p) => ({
      id: p.id,
      name: p.name || '',
      widgets: (p.layout || []).filter((it) => (p.widgets || {})[it.i]).map((it) => describeWidget(it, p.widgets[it.i])),
    })),
  };
}

function describeWidget(it, w) {
  return {
    id: it.i,
    type: w.type,
    title: w.config?.title || '',
    dataBinding: w.dataBinding || {},
    layout: { x: it.x, y: it.y, w: it.w, h: it.h },
    config: pickDesign(w.config),
    // Not look, but what decides how much room the widget needs: a
    // calendar filter and a dropdown filter are the same type.
    shape: { slicerStyle: w.config?.slicerStyle, orientation: w.config?.orientation, dateLayout: w.config?.dateLayout, subType: w.config?.subType },
    merged: !!w.config?.mergeGroup,
    // The pages a filter shares its selection with: the assistant keeps them, or asks.
    ...(w.type === 'filter' && Array.isArray(w.config?.syncPages) ? { syncPages: w.config.syncPages } : {}),
  };
}
