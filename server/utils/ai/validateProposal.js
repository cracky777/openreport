// Whatever the model proposes is untrusted: it may have been steered by text
// sitting in a cached row. Nothing it emits reaches the editor unless it
// passes here — and the client runs the same checks again before applying.
//
// Field names are only ever looked up in the effective model. An unknown name
// rejects the widget; it is never repaired, guessed or passed along.

const { lintVisualCode } = require('./visualLint');
const { arrange, readableMin, minOf, READABLE_MIN } = require('./arrangeLayout');
const { HARMONIES, colorOps } = require('./colorScheme');
const { readabilityOps } = require('./readability');
const { shapeWidget, isRanked } = require('./widgetShaping');

const GRID = 20;
const MIN_W = 100;
const MIN_H = 60;
const MAX_WIDGETS = 6;

const SUB_TYPES = {
  bar: ['grouped', 'stacked', 'stacked100'],
  line: ['line', 'area', 'stackedArea', 'stackedArea100'],
  combo: ['stackedCombo', 'clusteredCombo'],
  gauge: ['arc', 'column'],
};

// Binding keys each type reads, and what each key holds: 'dims' / 'measures'
// are name lists, 'dim' / 'measure' a single name. Mirrors the zones of the
// editor's Fields section.
const BINDING_KEYS = {
  bar: { selectedDimensions: 'dims', groupBy: 'dims', selectedMeasures: 'measures' },
  line: { selectedDimensions: 'dims', groupBy: 'dims', selectedMeasures: 'measures' },
  combo: { selectedDimensions: 'dims', groupBy: 'dims', comboBarMeasures: 'measures', comboLineMeasures: 'measures' },
  scatter: { selectedDimensions: 'dims', groupBy: 'dims' },
  pie: { selectedDimensions: 'dims', selectedMeasures: 'measures' },
  treemap: { selectedDimensions: 'dims', selectedMeasures: 'measures' },
  table: { selectedDimensions: 'dims', selectedMeasures: 'measures' },
  pivotTable: { selectedDimensions: 'dims', columnDimensions: 'dims', selectedMeasures: 'measures' },
  scorecard: { selectedMeasures: 'measures', compareDateDim: 'dim' },
  gauge: { selectedMeasures: 'measures', gaugeMaxMeasure: 'measure', gaugeThresholdMeasure: 'measure' },
  filter: { selectedDimensions: 'dims' },
};
const SINGLE_MEASURE_TYPES = new Set(['pie', 'treemap', 'scorecard', 'gauge']);
const LEGEND_TYPES = new Set(['bar', 'line', 'pie', 'scatter', 'combo']);
const AXIS_TITLED_TYPES = new Set(['bar', 'line', 'combo']);
// Where several axis dimensions make a drill-down, with a legend to show a
// second one at once instead.
const HIERARCHY_TYPES = new Set(['bar', 'line', 'combo']);
// Beyond this many values a legend is confetti, and a pie a wheel of slivers.
const MAX_LEGEND = 12;
const MAX_PIE_SLICES = 8;

// How many values a dimension has, as measured in the cache (cardinality.js):
// Infinity for "at least the read limit", null when unknown — and unknown
// decides nothing.
function countOf(name, ctx) {
  const c = ctx.cardinality && ctx.cardinality[name];
  if (!c) return null;
  return c.more ? Infinity : c.n;
}
function isDateDim(name, ctx) {
  const d = ctx.effective.dimensions.find((x) => x.name === name);
  return !!d && /date|time/i.test(String(d.type || ''));
}
// Has an order a line can follow: a date, or a number (a year kept as an integer).
function isOrderedDim(name, ctx) {
  const d = ctx.effective.dimensions.find((x) => x.name === name);
  return !d || /date|time|int|num|float|double|decimal|real/i.test(String(d.type || ''));
}

// Which of two dimensions goes on the axis and which in the legend, decided
// from what they are rather than from the order the model wrote them in: time
// runs along the axis; otherwise the one with more values does, and the one
// with few colors the bars.
function placeAxisAndLegend(binding, ctx) {
  const [axis, ...moreAxis] = binding.selectedDimensions || [];
  const [legend, ...moreLegend] = binding.groupBy || [];
  if (!axis || !legend || moreAxis.length || moreLegend.length) return;
  const timeFirst = isDateDim(legend, ctx) && !isDateDim(axis, ctx);
  const [na, nl] = [countOf(axis, ctx), countOf(legend, ctx)];
  const fewerOnAxis = !isDateDim(axis, ctx) && na !== null && nl !== null && nl > MAX_LEGEND && na < nl;
  if (timeFirst || fewerOnAxis) {
    binding.selectedDimensions = [legend];
    binding.groupBy = [axis];
  }
}

function text(v, max) {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

function snap(n) {
  return Math.round(n / GRID) * GRID;
}

function clampLayout(raw, page, min = { w: MIN_W, h: MIN_H }) {
  if (!raw || typeof raw !== 'object') return null;
  const nums = [raw.x, raw.y, raw.w, raw.h].map(Number);
  if (!nums.every(Number.isFinite)) return null;
  const w = Math.min(Math.max(snap(nums[2]), min.w), page.width);
  const h = Math.min(Math.max(snap(nums[3]), min.h), page.height);
  const x = Math.min(Math.max(snap(nums[0]), 0), page.width - w);
  const y = Math.min(Math.max(snap(nums[1]), 0), page.height - h);
  return { x, y, w, h };
}

function nameList(value, known, max) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) return null;
  return value.every((n) => typeof n === 'string' && known.has(n)) ? [...new Set(value)] : null;
}

function validateBinding(type, raw, names) {
  const spec = BINDING_KEYS[type];
  const src = raw && typeof raw === 'object' ? raw : {};
  const binding = {};
  for (const [key, kind] of Object.entries(spec)) {
    if (kind === 'dims' || kind === 'measures') {
      const list = nameList(src[key], kind === 'dims' ? names.dims : names.measures, 8);
      if (list === null) return { error: `${key} holds a field that is not in the model` };
      if (list.length) binding[key] = list;
    } else if (src[key] !== undefined && src[key] !== null && src[key] !== '') {
      const known = kind === 'dim' ? names.dims : names.measures;
      if (typeof src[key] !== 'string' || !known.has(src[key])) return { error: `${key} is not a field of the model` };
      binding[key] = src[key];
    }
  }

  if (type === 'scatter') {
    const sm = src.scatterMeasures && typeof src.scatterMeasures === 'object' ? src.scatterMeasures : {};
    const out = {};
    for (const axis of ['x', 'y', 'size']) {
      if (sm[axis] === undefined || sm[axis] === null || sm[axis] === '') continue;
      if (typeof sm[axis] !== 'string' || !names.measures.has(sm[axis])) return { error: `scatterMeasures.${axis} is not a measure of the model` };
      out[axis] = sm[axis];
    }
    if (!out.x || !out.y) return { error: 'A scatter chart needs an x and a y measure' };
    binding.scatterMeasures = out;
    binding.selectedMeasures = [out.x, out.y, out.size].filter(Boolean);
  }
  if (type === 'combo') {
    const bars = binding.comboBarMeasures || [];
    const lines = binding.comboLineMeasures || [];
    if (!bars.length || !lines.length) return { error: 'A combo chart needs at least one bar measure and one line measure' };
    binding.selectedMeasures = [...new Set([...bars, ...lines])];
  }

  if (type === 'filter') {
    if ((binding.selectedDimensions || []).length !== 1) return { error: 'A filter needs exactly one dimension' };
  } else if (!(binding.selectedMeasures || []).length) {
    return { error: 'The widget needs at least one measure' };
  }
  if (SINGLE_MEASURE_TYPES.has(type) && binding.selectedMeasures.length > 1) {
    binding.selectedMeasures = binding.selectedMeasures.slice(0, 1);
  }
  return { binding };
}

// A library visual declares its own roles; what it needs is fields that exist.
function libraryBinding(raw, names) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const dims = nameList(src.selectedDimensions, names.dims, 8);
  const measures = nameList(src.selectedMeasures, names.measures, 8);
  if (dims === null || measures === null) return { error: 'the binding holds a field that is not in the schema' };
  if (!dims.length && !measures.length) return { error: 'bind at least one field so the visual has data to draw' };
  return { binding: { selectedDimensions: dims, selectedMeasures: measures } };
}

/**
 * @param {object} args     raw `propose_widgets` arguments from the model
 * @param {object} ctx      { effective: {dimensions, measures}, page: {width, height}, library?: visualLibrary.libraryOf() }
 * @returns {{ widgets: object[], errors: string[] }}
 */
function validateWidgetsProposal(args, ctx) {
  const names = {
    dims: new Set(ctx.effective.dimensions.map((d) => d.name)),
    measures: new Set(ctx.effective.measures.map((m) => m.name)),
  };
  const list = args && Array.isArray(args.widgets) ? args.widgets.slice(0, MAX_WIDGETS) : [];
  const widgets = [];
  const errors = [];
  if (!list.length) errors.push('No widget was proposed');

  const library = new Map((ctx.library || []).map((v) => [v.id, v]));
  const warnings = [];
  // What the user asked a ranking of applies to the visual when it is the only one.
  const shapeCtx = { ...ctx, alone: list.length === 1 };

  list.forEach((proposed, i) => {
    const label = `Widget ${i + 1}`;
    // A pie of many slices reads as nothing: the same data as bars. A line
    // joins points in an order — time, or a number such as a year or an age:
    // across regions or products the slope between two of them means nothing.
    const firstDim = proposed && proposed.binding ? (proposed.binding.selectedDimensions || [])[0] : null;
    const slices = proposed && proposed.type === 'pie' ? countOf(firstDim, ctx) : null;
    const unordered = proposed && proposed.type === 'line' && firstDim && !isOrderedDim(firstDim, ctx);
    const raw = (slices !== null && slices > MAX_PIE_SLICES) || unordered ? { ...proposed, type: 'bar', subType: undefined } : proposed;
    const installed = raw && raw.type === 'customVisual';
    if (!raw || (!BINDING_KEYS[raw.type] && !installed)) {
      errors.push(`${label}: unknown widget type`);
      return;
    }
    const visual = installed ? library.get(raw.visualId) : null;
    if (installed && !visual) {
      errors.push(`${label}: visualId must be one of the workspace library${library.size ? `: ${[...library.keys()].join(', ')}` : ', which is empty here'}`);
      return;
    }
    const result = installed ? libraryBinding(raw.binding, names) : validateBinding(raw.type, raw.binding, names);
    if (result.error) {
      errors.push(`${label}: ${result.error}`);
      return;
    }
    const subTypes = SUB_TYPES[raw.type];
    // Two dimensions on a chart's axis are a drill-down hierarchy: the reader
    // sees the first level only. Seen with a real model: asked which cities
    // share a region, it put the region under the city — and the answer was
    // one click away, invisible. Unless the model says the user asked to
    // drill, the second dimension becomes the legend, stacked: each bar takes
    // the color of its group, which is what "show both" means.
    const axis = result.binding.selectedDimensions || [];
    const splitDrill = HIERARCHY_TYPES.has(raw.type) && axis.length === 2 && !(result.binding.groupBy || []).length && raw.drill !== true;
    if (splitDrill) {
      result.binding.selectedDimensions = [axis[0]];
      result.binding.groupBy = [axis[1]];
    }
    if (HIERARCHY_TYPES.has(raw.type)) placeAxisAndLegend(result.binding, ctx);
    // A library visual is pointed at by the server, from the library row:
    // never by a URL or a manifest that came with the proposal.
    const config = installed
      ? { title: text(raw.title, 200) || visual.name, visualId: visual.id, visualName: visual.name, bundleUrl: visual.bundleUrl, manifest: visual.manifest }
      : { title: text(raw.title, 200) };
    if (subTypes && subTypes.includes(raw.subType)) config.subType = raw.subType;
    // A bar with a legend and no layout chosen: stacked. Grouped reserves a slot
    // per legend value in every bar — with a region per city, ten cities made
    // ten thin bars lost among empty slots. Stacked shows each bar whole, in
    // its group's color; grouped stays when the model asks for it.
    if (raw.type === 'bar' && (result.binding.groupBy || []).length && !config.subType) config.subType = 'stacked';
    if (LEGEND_TYPES.has(raw.type)) config.showLegend = true;
    // Filters, ranking, period, sort, row limit: see widgetShaping.
    const shaped = shapeWidget(raw, result.binding, shapeCtx);
    if (shaped.error) {
      errors.push(`${label}: ${shaped.error}`);
      return;
    }
    Object.assign(config, shaped.config);
    Object.assign(result.binding, shaped.binding);
    // The proposed title already names what is plotted against what ("Revenue
    // by category"): axis titles would say it a second time, at the cost of a
    // strip of plot on two sides. Not on a scatter, where the axes are two
    // measures and their titles are the only place that says which is which.
    if (AXIS_TITLED_TYPES.has(raw.type)) {
      config.showXAxisTitle = false;
      config.showYAxisTitle = false;
      if (raw.type === 'combo') config.showSecondaryYAxisTitle = false;
    }
    // The model says which kind of question the visual answers — reading the
    // question is its job, in any language — and the server holds the chart
    // to that reading. A mismatch goes back once; after that it is kept, with
    // the note, for the author to judge.
    // Change over time needs time. Asked to "analyse the population" on a
    // model with no date at all, a real model still offered its evolution —
    // a chart with nothing to evolve along. Not a matter of taste: dropped.
    if (raw.answers === 'trend' && !isDateDim((result.binding.selectedDimensions || [])[0], ctx)) {
      const hasDate = ctx.effective.dimensions.some((d) => isDateDim(d.name, ctx));
      errors.push(`${label}: ${hasDate ? 'a trend has the date dimension on its axis' : 'this model has no date dimension, so nothing can be shown over time: leave this visual out'}`);
      return;
    }
    const fit = kindFit(raw.answers, raw.type, result.binding, ctx);
    if (fit) warnings.push(`${label}: ${fit}`);
    widgets.push({
      type: raw.type,
      config,
      dataBinding: result.binding,
      layout: clampLayout(raw.layout, ctx.page, readableMin(raw.type)),
      rationale: text(raw.rationale, 500),
    });
  });

  // "Top 5 regions" answered by every region, sorted, is not a top 5.
  if (ctx.rank && widgets.length && !widgets.some(isRanked)) {
    const word = ctx.rank.op === 'top_n' ? 'top' : 'bottom';
    errors.push(`the question asks for a ${word} ${ctx.rank.n}: propose a visual with a dimension and a measure (bar, table…) and set ${word}N to ${ctx.rank.n}`);
  }

  // "Inhabitants BY REGION" is answered by a visual with the region on it. A
  // single figure with the advice to filter by region is not an answer, it is
  // homework — and it is what a model falls back to when the breakdown is not
  // in the cache. Said plainly, once: this is a wrong chart, which the model
  // can fix, unlike padding below, which it cannot be trusted to.
  for (const dim of ctx.breakdownBy || []) {
    if (widgets.length && !widgets.some((w) => shows(w, dim))) {
      errors.push(`your reading says the request asks for a measure by ${dim}: put ${dim} on a visual (its axis, legend or rows). A single figure, a gauge or a filter does not answer it, whether or not the combination is cached`);
    }
  }

  return { widgets, errors, warnings };
}

// The kinds of question a visual answers, and the types that answer each.
// Condensed from the Financial Times Visual Vocabulary; the same table the
// prompt's chart guide walks through. A custom visual answers whatever it was
// written or installed for.
const QUESTION_KINDS = {
  figure: ['scorecard', 'gauge'],
  target: ['gauge', 'scorecard'],
  comparison: ['bar', 'table', 'pivotTable', 'treemap', 'combo'],
  ranking: ['bar', 'table'],
  trend: ['line', 'combo', 'bar'],
  share: ['pie', 'treemap', 'bar'],
  crossed: ['bar', 'pivotTable', 'table', 'treemap'],
  relationship: ['scatter'],
  distribution: ['bar', 'table'],
  detail: ['table', 'pivotTable'],
  control: ['filter'],
};
const TREND_BARS_MAX = 12;

/** Why this type does not answer that kind of question, or null when it does. */
function kindFit(kind, type, binding, ctx) {
  if (type === 'customVisual') return null;
  // Left out: nothing to hold the chart to. Not worth a round trip of its own.
  if (!kind) return null;
  const types = QUESTION_KINDS[kind];
  if (!types) return `answers must be one of ${Object.keys(QUESTION_KINDS).join(', ')}`;
  if (!types.includes(type)) return `a ${type} does not answer a ${kind} question; use ${types.join(' or ')}`;
  // Bars over time only for a handful of periods, compared one to one.
  if (kind === 'trend' && type === 'bar') {
    const n = countOf((binding.selectedDimensions || [])[0], ctx);
    if (n === null || n > TREND_BARS_MAX) return 'a trend over many periods is a line; bars only compare a handful of periods';
  }
  // Two dimensions read together: both must be on the visual.
  if (kind === 'crossed' && ['selectedDimensions', 'groupBy', 'columnDimensions'].reduce((n, k) => n + (binding[k] || []).length, 0) < 2) {
    return 'a crossed question shows two dimensions: one on the axis or rows, the other in groupBy or columnDimensions';
  }
  return null;
}

// A figure or a control, as opposed to a visual that shows a measure across
// the values of a dimension.
const SUMMARY_TYPES = new Set(['scorecard', 'gauge', 'filter']);

function shows(widget, dim) {
  if (SUMMARY_TYPES.has(widget.type)) return false;
  return ['selectedDimensions', 'groupBy', 'columnDimensions'].some((k) => (widget.dataBinding[k] || []).includes(dim));
}


// ─── Design changes ─────────────────────────────────────────────────
// The config keys the assistant may set, and what each may hold. A whitelist:
// a widget config also carries its identity (`visualId`, `bundleUrl`), its
// merge group and image data, none of which a restyle has any business
// touching. `dataBinding` is not reachable from here at all.
const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
const bool = (v) => (typeof v === 'boolean' ? v : undefined);
const color = (v) => (typeof v === 'string' && HEX.test(v) ? v : undefined);
const str = (max) => (v) => (typeof v === 'string' ? v.slice(0, max) : undefined);
const oneOf = (list) => (v) => (list.includes(v) ? v : undefined);
const num = (min, max) => (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(Math.max(v, min), max) : undefined);

// The series palette of one widget, in order (see client utils/chartPalette).
function hexList(v) {
  if (!Array.isArray(v) || v.length < 1 || v.length > 20) return undefined;
  return v.every((c) => color(c) !== undefined) ? v : undefined;
}

function colorMap(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const entries = Object.entries(v);
  // Empty is a value: it clears the per-series overrides so a palette shows.
  if (entries.length > 30) return undefined;
  const out = {};
  for (const [name, c] of entries) {
    if (name.length > 100 || color(c) === undefined) return undefined;
    out[name] = c;
  }
  return out;
}

// The look of table and pivotTable lives one level down, in `tableConfig`.
// Only its appearance groups: `columns` (per-column formats, widths,
// conditional formatting) and `freeze` are the author's and stay out of reach.
// The editor MERGES what passes here into the existing tableConfig.
const TABLE_LOOK = {
  header: { fontColor: color, bgColor: color, fontBold: bool },
  values: { fontColor: color, bgColor: color },
  rows: { striped: bool, stripeColor1: color, stripeColor2: color, bgColor: color, hoverColor: color },
  grid: {
    horizontalLines: bool, horizontalColor: color, verticalLines: bool, verticalColor: color,
    outerBorder: bool, outerBorderColor: color,
  },
  totals: { bgColor: color, fontColor: color, borderTopColor: color },
};

function tableLook(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out = {};
  for (const [group, keys] of Object.entries(TABLE_LOOK)) {
    const src = v[group];
    if (!src || typeof src !== 'object' || Array.isArray(src)) continue;
    const picked = {};
    for (const [key, check] of Object.entries(keys)) {
      const val = check(src[key]);
      if (val !== undefined) picked[key] = val;
    }
    if (Object.keys(picked).length) out[group] = picked;
  }
  return Object.keys(out).length ? out : undefined;
}

const DESIGN_CONFIG = {
  title: str(200),
  showLegend: bool,
  legendPosition: oneOf(['top', 'bottom', 'left', 'right']),
  color,
  legendColors: colorMap,
  palette: hexList,
  showDataLabels: bool,
  dataLabelColor: color,
  dataLabelFontSize: num(8, 32),
  valueColor: color,
  valueSize: num(10, 120),
  labelColor: color,
  labelSize: num(8, 48),
  showXAxis: bool,
  showXAxisTitle: bool,
  xAxisTitle: str(200),
  showYAxis: bool,
  showYAxisTitle: bool,
  yAxisTitle: str(200),
  smooth: bool,
  donut: bool,
  backgroundColor: color,
  transparentBg: bool,
  borderEnabled: bool,
  borderColor: color,
  borderRadius: num(0, 40),
  // A recolor that stops at the series leaves axis labels, tables and gauges
  // in the old palette: every color a renderer actually reads is settable.
  // Names checked against the widgets — a key no renderer reads is not here.
  legendTextColor: color,
  xAxisLabelColor: color,
  yAxisLabelColor: color,
  secondaryYAxisLabelColor: color,
  headerColor: color,
  dataLabelBgColor: color,
  // A percentage here, but models think of opacity as 0–1: 0.7 meant 70 %,
  // and taken literally it is an invisible background.
  dataLabelBgOpacity: (v) => num(0, 100)(typeof v === 'number' && v > 0 && v <= 1 ? v * 100 : v),
  gridLineStyle: oneOf(['solid', 'dashed', 'dotted']),
  gridLineWidth: num(0, 5),
  gaugeColor: color,
  gaugeTrackColor: color,
  gaugeThresholdColor: color,
  gaugeOverColor: color,
  gaugeConditionalColor: bool,
  gaugeValueColor: color,
  gaugeLabelColor: color,
  gaugeAxisColor: color,
  slicerFontColor: color,
  slicerSelectedColor: color,
  slicerSelectedBg: color,
  shapeFill: color,
  shapeStroke: color,
  lineColor: color,
  mergeSeparatorColor: color,
  tableConfig: tableLook,
};

/** The whitelisted, well-typed part of a config. Used on what comes IN too. */
function pickDesignConfig(config) {
  const out = {};
  if (!config || typeof config !== 'object') return out;
  for (const [key, check] of Object.entries(DESIGN_CONFIG)) {
    const v = check(config[key]);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

const MAX_OPS = 40;
// Widgets whose content is their own: a `title` there adds a title bar above
// a text that already is one.
const UNTITLED_TYPES = new Set(['text', 'shape', 'image']);

// A model asked for a palette still repaints by hand on top of it — a black
// filter, a grey table header — and the page is back to looking assembled
// from parts (seen on the first real run). Once a palette is chosen, the keys
// the rule set are the rule's. The one way left in is the documented
// exception: a named series through a non-empty `legendColors`.
function exceptRuled(set, ruledSet, type) {
  const out = { ...set };
  if (UNTITLED_TYPES.has(type)) delete out.title;
  if (!ruledSet) return out;
  for (const key of Object.keys(ruledSet)) {
    if (key === 'legendColors') { if (out.legendColors && !Object.keys(out.legendColors).length) delete out.legendColors; continue; }
    if (key !== 'tableConfig') { delete out[key]; continue; }
    if (!out.tableConfig) continue;
    const table = {};
    for (const [group, values] of Object.entries(out.tableConfig)) {
      const kept = Object.fromEntries(Object.entries(values).filter(([k]) => !(ruledSet.tableConfig[group] && k in ruledSet.tableConfig[group])));
      if (Object.keys(kept).length) table[group] = kept;
    }
    if (Object.keys(table).length) out.tableConfig = table; else delete out.tableConfig;
  }
  return out;
}

/**
 * @param {object} args  raw `propose_design_changes` arguments
 * @param {object} ctx   { pageContext, page: {width, height} }
 * @returns {{ summary: string, advice: string[], ops: object[], errors: string[], warnings: string[] }}
 */
function validateDesignProposal(args, ctx) {
  const byId = new Map(ctx.pageContext.widgets.map((w) => [w.id, w]));
  const themes = new Set(ctx.pageContext.themes || []);
  const list = args && Array.isArray(args.ops) ? args.ops.slice(0, MAX_OPS) : [];
  const ops = [];
  const errors = [];

  // Rows and weights in, `move` operations out: from here on an arrangement
  // is ordinary moves, which is all the editor ever has to know how to apply.
  const arranged = new Set();
  // What the color rule set on each widget: those keys are the rule's.
  const ruled = new Map();
  // Held to what the request is about (the model's reading, see agent.designReading). Out of scope, the
  // two sweeping instruments are dropped without a word: the model was not
  // even handed them, and there is nothing for it to repair.
  const scope = ctx.scope || { layout: true, scheme: true, theme: true };
  if (args && args.arrangement && scope.layout) {
    const laidOut = arrange(args.arrangement, byId, ctx.page);
    errors.push(...laidOut.errors);
    for (const move of laidOut.moves) {
      ops.push(move);
      arranged.add(move.widgetId);
    }
  }
  // A palette by name, turned into the restyle of every widget by one fixed
  // rule. First in the list, so a deliberate exception the model adds for one
  // widget (a warning red on a gauge) still lands on top of it.
  if (args && args.colorScheme !== undefined && scope.scheme) {
    const dimensions = (ctx.effective && ctx.effective.dimensions) || [];
    // Colored for the theme the page ENDS UP with: "a dark orange theme" switches
    // the theme in the same proposal, and tints computed for the white page it
    // is leaving came out as a pale header under light text.
    const switched = scope.theme && list.find((op) => op && op.op === 'report_settings' && op.set && themes.has(op.set.theme));
    const target = switched ? { ...ctx.pageContext, theme: switched.set.theme } : ctx.pageContext;
    const colored = colorOps(String(args.colorScheme), args.baseColor, target, dimensions);
    // Flagged so the card can say "palette X on N widgets" in one line.
    if (colored) {
      ops.push(...colored.map((op) => ({ ...op, fromScheme: true })));
      for (const op of colored) ruled.set(op.widgetId, op.set);
    }
    else errors.push(`colorScheme: unknown rule; use one of ${Object.keys(HARMONIES).join(', ')}`);
  }
  if (!list.length && !ops.length && !errors.length) errors.push('No change was proposed');

  list.forEach((raw, i) => {
    const label = `Change ${i + 1}`;
    if (!raw || typeof raw !== 'object') {
      errors.push(`${label}: not an operation`);
      return;
    }
    if (raw.op === 'report_settings') {
      if (!scope.theme) return;
      const set = {};
      const src = raw.set && typeof raw.set === 'object' ? raw.set : {};
      if (src.theme !== undefined) {
        if (!themes.has(src.theme)) { errors.push(`${label}: unknown theme`); return; }
        // "Switch to light" on a light report: dropped without a word, it is
        // not worth a repair round and must not count as a change on the card.
        if (src.theme !== (ctx.pageContext.theme || 'light')) set.theme = src.theme;
      }
      if (src.pageBackground !== undefined) {
        if (color(src.pageBackground) === undefined) { errors.push(`${label}: pageBackground must be a hex color`); return; }
        if (src.pageBackground.toLowerCase() !== String(ctx.pageContext.pageBackground || '').toLowerCase()) set.pageBackground = src.pageBackground;
      }
      if (src.theme === undefined && src.pageBackground === undefined) { errors.push(`${label}: nothing to set`); return; }
      if (!Object.keys(set).length) return;
      ops.push({ op: 'report_settings', set });
      return;
    }

    const target = byId.get(raw.widgetId);
    if (!target) {
      errors.push(`${label}: unknown widget`);
      return;
    }
    if (raw.op === 'update_config') {
      const picked = pickDesignConfig(raw.set);
      // Measured against what was valid, not against what the color rule then
      // set aside: a key the rule owns is dropped quietly, not worth a repair round.
      const refused = Object.keys(raw.set && typeof raw.set === 'object' ? raw.set : {}).filter((k) => !(k in picked));
      const set = exceptRuled(picked, ruled.get(target.id), target.type);
      // A treemap is read through its labels: without them it is anonymous
      // rectangles. A real model turned them off "to declutter".
      if (target.type === 'treemap' && set.showDataLabels === false) delete set.showDataLabels;
      // Restating what is already there is not a change, and pads the card.
      for (const key of Object.keys(set)) {
        if (JSON.stringify(set[key]) === JSON.stringify((target.config || {})[key])) delete set[key];
      }
      if (refused.length) errors.push(`${label}: ignored ${refused.slice(0, 5).map((k) => String(k).slice(0, 30)).join(', ')} (not settable or invalid value)`);
      if (Object.keys(set).length) ops.push({ op: 'update_config', widgetId: target.id, set });
    } else if (raw.op === 'move') {
      if (!scope.layout) return;
      // The arrangement already placed it, to the pixel; a second opinion in
      // hand-computed coordinates would only undo that.
      if (arranged.has(target.id)) return;
      // A merged block moves as one piece; moving a member would tear it.
      if (target.merged) { errors.push(`${label}: this widget is part of a merged block and cannot be moved alone`); return; }
      const rect = clampLayout(raw, ctx.page);
      if (!rect) { errors.push(`${label}: x, y, w and h must be numbers`); return; }
      // Refused rather than silently enlarged: a bigger box would land on its
      // neighbours, and only the model can re-plan the row around it.
      const min = minOf(target);
      if (rect.w < min.w || rect.h < min.h) {
        errors.push(`${label}: ${JSON.stringify(target.title || target.type)} is not readable under ${min.w} × ${min.h} px (asked ${rect.w} × ${rect.h}); give it more room or leave it where it is`);
        return;
      }
      ops.push({ op: 'move', widgetId: target.id, ...rect });
    } else if (raw.op === 'z_order') {
      if (raw.to !== 'front' && raw.to !== 'back') { errors.push(`${label}: z_order goes to "front" or "back"`); return; }
      ops.push({ op: 'z_order', widgetId: target.id, to: raw.to });
    } else {
      errors.push(`${label}: unknown operation`);
    }
  });
  // Advice is what the assistant cannot do for the author — remove a visual,
  // split a page. Plain strings, shown as text.
  const advice = (args && Array.isArray(args.advice) ? args.advice : [])
    .filter((a) => typeof a === 'string' && a.trim())
    .slice(0, 4)
    .map((a) => a.trim().slice(0, 240));
  // Last, on the state all of the above leaves the page in. A color the
  // proposal itself chose and that had to be adjusted is corrected WHERE it was
  // set, so the card shows the color the author will actually get; the rest
  // travels as operations of its own.
  for (const fix of readabilityOps(ctx.pageContext, ops)) {
    for (const key of Object.keys(fix.set)) {
      if (key === 'tableConfig') continue;
      const chosen = ops.filter((op) => op.op === 'update_config' && op.widgetId === fix.widgetId && !op.fromScheme && key in op.set).pop();
      if (!chosen) continue;
      chosen.set[key] = fix.set[key];
      delete fix.set[key];
    }
    if (Object.keys(fix.set).length) ops.push(fix);
  }
  const colorScheme = ops.some((op) => op.fromScheme) ? String(args.colorScheme) : null;
  return { summary: text(args && args.summary, 500), advice, colorScheme, ops, errors, warnings: newOverlaps(ctx.pageContext.widgets, ops) };
}

function rectOf(layout) {
  if (!layout) return null;
  const r = { x: Number(layout.x), y: Number(layout.y), w: Number(layout.w), h: Number(layout.h) };
  return Object.values(r).every(Number.isFinite) ? r : null;
}

const intersects = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// Data visuals the proposal would stack on one another. Only overlaps it
// CREATES: a pair already overlapping was the author's doing. Shapes, text and
// images are left out — sitting under or over a chart is what they are for.
// Reported apart from `errors`: dropping one move of a re-laid-out page would
// leave it worse than the overlap does.
function newOverlaps(pageWidgets, ops) {
  const moves = new Map(ops.filter((o) => o.op === 'move').map((o) => [o.widgetId, o]));
  if (!moves.size) return [];
  const visuals = pageWidgets
    .filter((w) => READABLE_MIN[w.type])
    .map((w) => ({ w, before: rectOf(w.layout), after: rectOf(moves.get(w.id) || w.layout) }))
    .filter((v) => v.after);
  const name = (w) => JSON.stringify(w.title || w.type);
  const out = [];
  for (let i = 0; i < visuals.length; i++) {
    for (let j = i + 1; j < visuals.length; j++) {
      const a = visuals[i];
      const b = visuals[j];
      if (!moves.has(a.w.id) && !moves.has(b.w.id)) continue;
      // Members of a merged block are laid out against each other on purpose.
      if (a.w.merged && b.w.merged) continue;
      if (!intersects(a.after, b.after)) continue;
      if (a.before && b.before && intersects(a.before, b.before)) continue;
      out.push(`${name(a.w)} and ${name(b.w)} would overlap`);
    }
  }
  return out.slice(0, 10);
}

// ─── Generated custom visual ────────────────────────────────────────
const MAX_VISUAL_CODE = 100 * 1024;
const CONFIG_TYPES = new Set(['boolean', 'number', 'color', 'string', 'select']);

function cleanSlots(raw, fallbackRole) {
  const list = Array.isArray(raw) ? raw.slice(0, 6) : [];
  return list
    .filter((s) => s && typeof s === 'object')
    .map((s) => ({ role: text(s.role, 40) || fallbackRole, label: text(s.label, 60) || fallbackRole }));
}

// Rebuilt key by key rather than passed through: the manifest is stored and
// later drives the options panel, so nothing the model invented rides along.
function cleanManifest(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = text(raw.name, 80).trim();
  if (!name) return null;
  const ds = raw.dataSchema && typeof raw.dataSchema === 'object' ? raw.dataSchema : {};
  const configSchema = (Array.isArray(raw.configSchema) ? raw.configSchema.slice(0, 12) : [])
    .filter((c) => c && typeof c.key === 'string' && /^[a-zA-Z][a-zA-Z0-9]{0,39}$/.test(c.key) && CONFIG_TYPES.has(c.type))
    .map((c) => {
      const out = { key: c.key, type: c.type, label: text(c.label, 60) || c.key };
      if (['boolean', 'number', 'string'].includes(typeof c.default)) out.default = c.default;
      if (c.type === 'number') for (const k of ['min', 'max', 'step']) if (Number.isFinite(c[k])) out[k] = c[k];
      if (c.type === 'select') {
        out.options = (Array.isArray(c.options) ? c.options.slice(0, 20) : [])
          .filter((o) => o && ['string', 'number'].includes(typeof o.value))
          .map((o) => ({ value: o.value, label: text(o.label, 60) || String(o.value) }));
      }
      return out;
    });
  return {
    id: text(raw.id, 60) || name,
    name,
    version: '1.0.0',
    description: text(raw.description, 300),
    dataSchema: { dimensions: cleanSlots(ds.dimensions, 'category'), measures: cleanSlots(ds.measures, 'value') },
    configSchema,
  };
}

/**
 * @param {object} args  raw `propose_custom_visual` arguments
 * @param {object} ctx   { effective }
 * @returns {{ visual: object|null, errors: string[] }}
 */
function validateVisualProposal(args, ctx) {
  const a = args && typeof args === 'object' ? args : {};
  const manifest = cleanManifest(a.manifest);
  if (!manifest) return { visual: null, errors: ['The manifest needs a name and a dataSchema'] };

  const code = typeof a.visualJs === 'string' ? a.visualJs : '';
  if (!code.trim()) return { visual: null, errors: ['visualJs is empty'] };
  if (Buffer.byteLength(code) > MAX_VISUAL_CODE) return { visual: null, errors: ['visualJs is too large (100 KB at most)'] };
  if (!/\bOpenReportRegisterVisual\s*\(/.test(code)) return { visual: null, errors: ['visualJs must call OpenReportRegisterVisual({ render })'] };
  const forbidden = lintVisualCode(code);
  if (forbidden.length) return { visual: null, errors: [`A generated visual runs with no network and may not use: ${forbidden.join(', ')}`] };

  const names = {
    dims: new Set(ctx.effective.dimensions.map((d) => d.name)),
    measures: new Set(ctx.effective.measures.map((m) => m.name)),
  };
  const src = a.binding && typeof a.binding === 'object' ? a.binding : {};
  const dims = nameList(src.selectedDimensions, names.dims, 8);
  const measures = nameList(src.selectedMeasures, names.measures, 8);
  if (dims === null || measures === null) return { visual: null, errors: ['The binding holds a field that is not in the model'] };
  if (!dims.length && !measures.length) return { visual: null, errors: ['Bind at least one field so the visual has data to draw'] };

  return {
    visual: {
      manifest,
      visualJs: code,
      dataBinding: { selectedDimensions: dims, selectedMeasures: measures },
      layout: clampLayout(a.layout, ctx.page, readableMin('customVisual')),
      rationale: text(a.rationale, 500),
    },
    errors: [],
  };
}

module.exports = {
  validateWidgetsProposal, validateDesignProposal, validateVisualProposal, pickDesignConfig, clampLayout,
  BINDING_KEYS, SUB_TYPES, DESIGN_CONFIG, TABLE_LOOK, READABLE_MIN, QUESTION_KINDS,
};
