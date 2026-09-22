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
    const pos = findFreeSlot(nextLayout, start.x, start.y, size.w, size.h, pageWidth, pageHeight);
    z += 1;
    nextLayout.push({ i: id, ...pos, ...size, z });
    nextWidgets[id] = { type: w.type, data: {}, dataBinding: { ...w.dataBinding }, config: { ...w.config } };
    newIds.push(id);
  }
  return { layout: nextLayout, widgets: nextWidgets, newIds };
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
  if (proposal.kind === 'model') return describeModelProposal(proposal, outcome);
  const status = { applied: 'applied by the user', reverted: 'applied by the user', dismissed: 'dismissed by the user' }[outcome] || 'not applied yet';
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
  }
  return `[Proposed — ${status}: ${what}]`.slice(0, 1500);
}

// The look keys the assistant may read and set. The server holds the same
// list with a type per key; here it guards what leaves the browser (a config
// also carries image data) and what a proposal may write.
export const DESIGN_KEYS = [
  'title', 'showLegend', 'legendPosition', 'color', 'legendColors', 'showDataLabels', 'dataLabelColor',
  'dataLabelFontSize', 'valueColor', 'valueSize', 'labelColor', 'labelSize', 'showXAxis', 'showXAxisTitle',
  'xAxisTitle', 'showYAxis', 'showYAxisTitle', 'yAxisTitle', 'smooth', 'donut', 'backgroundColor',
  'transparentBg', 'borderEnabled', 'borderColor', 'borderRadius',
  'xAxisLabelColor', 'yAxisLabelColor', 'secondaryYAxisLabelColor', 'headerColor', 'dataLabelBgColor',
  'dataLabelBgOpacity', 'gridLineStyle', 'gridLineWidth', 'gaugeColor', 'gaugeTrackColor', 'gaugeThresholdColor',
  'gaugeOverColor', 'gaugeConditionalColor', 'gaugeValueColor', 'gaugeLabelColor', 'gaugeAxisColor',
  'slicerFontColor', 'slicerSelectedColor', 'slicerSelectedBg', 'shapeFill', 'shapeStroke', 'lineColor',
  'mergeSeparatorColor', 'tableConfig', 'palette', 'legendTextColor',
];
const DESIGN_KEY_SET = new Set(DESIGN_KEYS);
const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
const COLOR_KEYS_BY_NAME = new Set(['color', 'slicerSelectedBg', 'shapeFill', 'shapeStroke']);
// `gaugeConditionalColor` is the one "…Color" that is a switch, not a color.
const isColorKey = (k) => k !== 'gaugeConditionalColor'
  && (COLOR_KEYS_BY_NAME.has(k) || k.endsWith('Color') || /^stripeColor\d$/.test(k));

// The appearance groups of a table's `tableConfig`. `columns` (formats,
// widths, conditional formatting) and `freeze` are the author's: they neither
// leave the browser nor can a proposal write them.
const TABLE_LOOK = {
  header: ['fontColor', 'bgColor', 'fontBold'],
  values: ['fontColor', 'bgColor'],
  rows: ['striped', 'stripeColor1', 'stripeColor2', 'bgColor', 'hoverColor'],
  grid: ['horizontalLines', 'horizontalColor', 'verticalLines', 'verticalColor', 'outerBorder', 'outerBorderColor'],
  totals: ['bgColor', 'fontColor', 'borderTopColor'],
};

function pickTableLook(tableConfig) {
  const out = {};
  for (const [group, keys] of Object.entries(TABLE_LOOK)) {
    const picked = {};
    for (const k of keys) {
      const v = tableConfig?.[group]?.[k];
      if (v === undefined || (isColorKey(k) ? !HEX.test(v) : typeof v !== 'boolean')) continue;
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

  for (const op of proposal?.ops || []) {
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
        set[k] = v;
      }
      if (!Object.keys(set).length) { skipped += 1; continue; }
      const updated = { ...widget, config: { ...(widget.config || {}), ...set } };
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
      const h = Math.min(op.h, pageHeight);
      const rect = { ...clampPos(op.x, op.y, w, h, pageWidth, pageHeight), w, h };
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
 * What the assistant is told about the page being edited: bindings, geometry
 * and the current look. Fetched rows (`widget.data`) stay in the browser.
 */
export function buildPageContext({ layout, widgets, pageWidth, pageHeight, settings, themes, palette }) {
  return {
    pageWidth,
    pageHeight,
    themes: Object.keys(themes || {}),
    theme: settings?.theme?.key || null,
    pageBackground: settings?.backgroundColor || null,
    palette: palette || [],
    widgets: layout.filter((it) => widgets[it.i]).map((it) => {
      const w = widgets[it.i];
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
      };
    }),
  };
}
