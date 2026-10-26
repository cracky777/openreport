// Whatever the model proposes is untrusted: it may have been steered by text
// sitting in a cached row. Nothing it emits reaches the editor unless it
// passes here — and the client runs the same checks again before applying.
//
// Field names are only ever looked up in the effective model. An unknown name
// rejects the widget; it is never repaired, guessed or passed along.

const { validatePageNavOp } = require('./pageNav');
const { lintVisualCode } = require('./visualLint');
const { arrange, placeWidget, readableMin, minOf, READABLE_MIN } = require('./arrangeLayout');
const { HARMONIES, colorOps } = require('./colorScheme');
const { readabilityOps } = require('./readability');
const { shapeWidget, isRanked } = require('./widgetShaping');
const { onDimensionSide } = require('./dimensionSide');
const { FONT_FAMILIES } = require('./fonts');

const GRID = 20;
const MIN_W = 100;
const MIN_H = 60;
const MAX_WIDGETS = 6;

const SUB_TYPES = {
  bar: ['grouped', 'stacked', 'stacked100'],
  line: ['line', 'area', 'stackedArea', 'stackedArea100'],
  combo: ['stackedCombo', 'clusteredCombo'],
  gauge: ['arc', 'column'],
  // A pie, a donut, a rose (slices sized by value too), a funnel (stages that lose volume).
  pie: ['pie', 'donut', 'rose', 'funnel'],
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
  // Columns × rows (the legend well), one value per crossing.
  heatmap: { selectedDimensions: 'dims', groupBy: 'dims', selectedMeasures: 'measures' },
  // One place column — countries, regions, départements or towns, by name.
  map: { selectedDimensions: 'dims', selectedMeasures: 'measures' },
  waterfall: { selectedDimensions: 'dims', selectedMeasures: 'measures' },
  table: { selectedDimensions: 'dims', selectedMeasures: 'measures' },
  pivotTable: { selectedDimensions: 'dims', columnDimensions: 'dims', selectedMeasures: 'measures' },
  scorecard: { selectedMeasures: 'measures', compareDateDim: 'dim' },
  gauge: { selectedMeasures: 'measures', gaugeMaxMeasure: 'measure', gaugeThresholdMeasure: 'measure' },
  filter: { selectedDimensions: 'dims' },
};
const SINGLE_MEASURE_TYPES = new Set(['pie', 'treemap', 'waterfall', 'scorecard', 'gauge', 'heatmap', 'map']);
// The page's dressing: no data, no title bar — a text, a shape, an image the
// user added. Asked by Jonathan: what makes a page look finished (a title
// band, section labels, a divider, a logo) is the model's to place.
const DECOR_TYPES = ['text', 'shape', 'image'];
const DECOR = new Set(DECOR_TYPES);
const DECOR_MIN = { w: 20, h: 20 };
const ASSET_URL = /^\/uploads\/images\/[A-Za-z0-9._-]+$/;

// A text, a shape or an image as the proposal describes it, checked field by
// field: an image only by the name of one the user added (never a URL of the
// model's), colors as hex, sizes bounded. `data` travels with the widget: the
// text's content is data, as the editor stores it.
function decorWidget(raw, ctx) {
  const config = {};
  let data = {};
  if (raw.type === 'text') {
    const content = text(raw.text, 500).trim();
    if (!content) return { error: 'a text needs `text`' };
    const style = raw.style && typeof raw.style === 'object' ? raw.style : {};
    // The style goes on the widget, never on pieces of the text: the runs win
    // over the config, and a title made in navy stayed navy under a later card
    // that set it light (asked by Jonathan: the assistant styles the whole, as
    // the config panel does; pieces are the author's, by hand).
    const size = Math.floor(Number(style.fontSize));
    if (size >= 8 && size <= 72) config.fontSize = size;
    if (style.bold === true) config.bold = true;
    if (color(style.color) !== undefined) config.color = style.color;
    data = { text: content, runs: [{ text: content }] };
    if (['left', 'center', 'right'].includes(style.align)) config.textAlign = style.align;
  } else if (raw.type === 'shape') {
    if (raw.shape !== 'rectangle' && raw.shape !== 'line') return { error: 'a shape is a rectangle or a line' };
    const opacity = Math.floor(Number(raw.opacity));
    if (raw.shape === 'line') {
      config.shape = 'line';
      if (color(raw.fill) !== undefined) config.lineColor = raw.fill;
      const thickness = Math.floor(Number(raw.thickness));
      config.lineThickness = thickness >= 1 && thickness <= 12 ? thickness : 2;
    } else {
      config.shape = 'square';
      if (color(raw.fill) !== undefined) config.shapeFill = raw.fill;
      if (color(raw.stroke) !== undefined) { config.shapeStroke = raw.stroke; config.shapeStrokeWidth = 1; } else config.shapeStrokeWidth = 0;
      if (opacity >= 0 && opacity <= 100) config.shapeOpacity = opacity;
    }
  } else {
    const asset = (ctx.assets || []).find((a) => a.name === raw.image);
    if (!asset || !ASSET_URL.test(asset.url)) return { error: `an image is one the user added, by name${(ctx.assets || []).length ? `: ${ctx.assets.map((a) => a.name).join(', ')}` : ' — none was added to this conversation'}` };
    config.url = asset.url;
    config.fit = raw.fit === 'cover' ? 'cover' : 'contain';
    config.alt = text(raw.title, 200) || asset.name;
  }
  return { widget: { type: raw.type, config, data, dataBinding: {}, layout: clampLayout(raw.layout, ctx.page, DECOR_MIN), rationale: text(raw.rationale, 500) } };
}
const { dressWidget, matchNeighbours } = require('./dress');
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
// A period written as text — a calendar's YearMonth, a Quarter, a month name
// derived from a date — is time too: the Finance package plots its months
// that way, and a trend on them was refused for want of a DATE type.
const PERIOD = /year|month|quarter|week|period|date|day|time|calendar|calendrier/i;
const periodLike = (d) => !!d.datePart || PERIOD.test(String(d.column || '')) || PERIOD.test(String(d.table || '').split('__').pop());
function isDateDim(name, ctx) {
  const d = ctx.effective.dimensions.find((x) => x.name === name);
  return !!d && (/date|time/i.test(String(d.type || '')) || periodLike(d));
}
// Has an order a line can follow: a date, a period, or a number (a year kept as an integer).
function isOrderedDim(name, ctx) {
  const d = ctx.effective.dimensions.find((x) => x.name === name);
  return !d || /date|time|int|num|float|double|decimal|real/i.test(String(d.type || '')) || periodLike(d);
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

  if (type === 'heatmap' && ((binding.selectedDimensions || []).length !== 1 || (binding.groupBy || []).length !== 1)) {
    return { error: 'A heatmap needs one dimension in selectedDimensions (its columns) and one in groupBy (its rows)' };
  }
  if (type === 'map' && (binding.selectedDimensions || []).length !== 1) return { error: 'A map needs exactly one dimension: the place' };
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
  // Which proposals the widgets came from: a caller that attached something
  // to a proposal (where it goes on the page) finds it again past a refusal.
  const accepted = [];
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
    let raw = (slices !== null && slices > MAX_PIE_SLICES) || unordered ? { ...proposed, type: 'bar', subType: undefined } : proposed;
    const installed = raw && raw.type === 'customVisual';
    if (raw && DECOR.has(raw.type)) {
      const made = decorWidget(raw, ctx);
      if (made.error) { errors.push(`${label}: ${made.error}`); return; }
      accepted.push(i);
      // Like its neighbours of its kind (a section label like the other
      // labels); the data visuals' defaults do not apply to it.
      widgets.push(matchNeighbours(made.widget, ctx.siblings || (ctx.pageContext && ctx.pageContext.widgets) || []));
      return;
    }
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
    // The reading the question calls for, when the proposal left it out: a
    // conversion is a funnel, a ranking reads down horizontal bars.
    if (raw.answers === 'conversion' && raw.type === 'pie') config.subType = 'funnel';
    if (raw.answers === 'ranking' && raw.type === 'bar' && !(raw.style && raw.style.barDirection)) config.barDirection = 'horizontal';
    // Filters, ranking, period, sort, row limit: see widgetShaping.
    const shaped = shapeWidget(raw, result.binding, shapeCtx);
    if (shaped.error) {
      errors.push(`${label}: ${shaped.error}`);
      return;
    }
    Object.assign(config, shaped.config);
    Object.assign(result.binding, shaped.binding);
    // A fact's copy of a dimension key reads its dimension table instead.
    if (ctx.effective.joins) ({ binding: result.binding, raw } = onDimensionSide(result.binding, raw, ctx.effective));
    // Fields shown under their raw name — "qte_commandee" in a French legend
    // or a table header (seen with Karim). The model names them in the user's
    // words: a table's column takes the name, a measure takes it as its label
    // in the whole report (dress.formatOverrides). Looked up among the fields
    // this visual shows, never a new column. One left raw goes back once.
    const named = raw.fieldNames && typeof raw.fieldNames === 'object' && !Array.isArray(raw.fieldNames) ? raw.fieldNames : {};
    const b = result.binding;
    const shownMeasures = [...(b.selectedMeasures || []), ...(b.comboBarMeasures || []), ...(b.comboLineMeasures || [])];
    const shownDims = [...(b.selectedDimensions || []), ...(b.groupBy || []), ...(b.columnDimensions || [])];
    const isTable = raw.type === 'table' || raw.type === 'pivotTable';
    const fieldOf = (n) => ctx.effective.dimensions.find((x) => x.name === n) || ctx.effective.measures.find((x) => x.name === n);
    const columns = {};
    const labels = {};
    for (const [field, name] of Object.entries(named)) {
      const f = [...shownMeasures, ...shownDims].includes(field) && fieldOf(field);
      const given = text(name, 60);
      if (!f || !given) continue;
      if (isTable) columns[f.label || f.name] = { displayName: given };
      if (shownMeasures.includes(field)) labels[field] = given;
    }
    if (Object.keys(columns).length) config.tableConfig = { ...(config.tableConfig || {}), columns };
    // Decimals asked for a measure it shows: its display in the whole report,
    // like its name (dress.formatOverrides). Without it the AI sent the user
    // to the model editor ("3 days" against "3 days" promised, recipe Moreau).
    const decimals = {};
    const askedDecimals = raw.fieldDecimals && typeof raw.fieldDecimals === 'object' && !Array.isArray(raw.fieldDecimals) ? raw.fieldDecimals : {};
    for (const [field, n] of Object.entries(askedDecimals)) {
      if (shownMeasures.includes(field) && Number.isInteger(n) && n >= 0 && n <= 3) decimals[field] = n;
    }
    const onShow = isTable ? [...shownDims, ...shownMeasures] : shownMeasures.length > 1 ? shownMeasures : [];
    const leftRaw = onShow.filter((n) => !named[n] && fieldOf(n) && RAW_LABEL.test(fieldOf(n).label || fieldOf(n).name));
    if (leftRaw.length) warnings.push(`${label}: name in fieldNames, in the user's language, the fields it shows under a raw name: ${leftRaw.join(', ')}`);
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
    // What the proposal left unsaid about the look: first like its neighbours
    // of the same type on the page it joins, then the defaults (dress.js).
    accepted.push(i);
    const dressed = dressWidget(matchNeighbours({
      type: raw.type,
      config,
      dataBinding: result.binding,
      layout: clampLayout(raw.layout, ctx.page, readableMin(raw.type)),
      rationale: text(raw.rationale, 500),
    }, ctx.siblings || (ctx.pageContext && ctx.pageContext.widgets) || []), ctx);
    // Read and taken off by dress.formatOverrides, which every proposal goes through.
    widgets.push({ ...dressed, ...(Object.keys(labels).length ? { fieldLabels: labels } : {}), ...(Object.keys(decimals).length ? { fieldDecimals: decimals } : {}) });
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

  return { widgets, accepted, errors, warnings };
}

// The kinds of question a visual answers, and the types that answer each.
// Condensed from the Financial Times Visual Vocabulary; the same table the
// prompt's chart guide walks through. A custom visual answers whatever it was
// written or installed for.
const QUESTION_KINDS = {
  figure: ['scorecard', 'gauge'],
  target: ['gauge', 'scorecard', 'combo', 'bar'],
  // Stages that lose volume (contacted → answered → meeting): a funnel.
  conversion: ['pie', 'bar'],
  comparison: ['bar', 'table', 'pivotTable', 'treemap', 'combo'],
  ranking: ['bar', 'table'],
  trend: ['line', 'combo', 'bar'],
  share: ['pie', 'treemap', 'bar'],
  crossed: ['bar', 'pivotTable', 'table', 'treemap', 'heatmap'],
  // Where it happens: a measure by country, region, département or town.
  where: ['map', 'bar', 'table'],
  relationship: ['scatter'],
  distribution: ['bar', 'table'],
  bridge: ['waterfall'],
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

// A font of the bundled list (fonts.js), or null for the system font.
const font = (v) => (v === null ? null : FONT_FAMILIES.has(v) ? v : undefined);
const NUMFMT = ['none', 'auto', 'K', 'M', 'B'];
const SYMBOLS = ['circle', 'rect', 'roundRect', 'triangle', 'diamond', 'pin', 'arrow', 'star'];

// An object setting, key by key: what passes of it, or nothing.
const shapeOf = (spec) => (v) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out = {};
  for (const [key, check] of Object.entries(spec)) {
    const val = check(v[key]);
    if (val !== undefined) out[key] = val;
  }
  return Object.keys(out).length ? out : undefined;
};
const mapOf = (check, max = 30) => (v) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const entries = Object.entries(v);
  if (entries.length > max) return undefined;
  const out = {};
  for (const [name, val] of entries) {
    if (name.length > 100 || check(val) === undefined) return undefined;
    out[name] = check(val);
  }
  return out;
};

const gradient = shapeOf({ enabled: bool, angle: num(0, 360), color1: color, color2: color });
// The N-1 lines under a scorecard's figure (client PropertyPanel/controls.jsx).
const N1_COMMON = {
  position: oneOf(['bottom', 'left', 'right']), label: str(60), fontSize: num(8, 32), spacing: num(0, 64),
  iconEnabled: bool, iconPosition: oneOf(['left', 'right']), positiveIcon: str(4), negativeIcon: str(4),
  iconColorEnabled: bool, iconPositiveColor: color, iconNegativeColor: color,
};
const N1_SIGNED = { ...N1_COMMON, textColorEnabled: bool, positiveColor: color, negativeColor: color };

// The look of table and pivotTable lives one level down, in `tableConfig`.
// Only its appearance groups: `columns` (per-column formats, widths,
// conditional formatting), `freeze`, `pagination` and the totals' functions
// are the author's and stay out of reach. The editor MERGES what passes here
// into the existing tableConfig.
const ALIGN = oneOf(['left', 'center', 'right']);
const VALIGN = oneOf(['top', 'middle', 'bottom']);
const TABLE_LOOK = {
  header: {
    show: bool, fontSize: num(8, 24), fontColor: color, fontFamily: font, fontBold: bool, fontItalic: bool,
    bgColor: color, alignment: ALIGN, verticalAlignment: VALIGN, wordWrap: bool,
  },
  values: {
    fontSize: num(8, 24), fontColor: color, fontFamily: font, fontBold: bool, fontItalic: bool, bgColor: color,
    alignment: oneOf(['auto', 'left', 'center', 'right']), verticalAlignment: VALIGN, wordWrap: bool,
  },
  rows: {
    height: oneOf(['compact', 'normal', 'large']), striped: bool, stripeColor1: color, stripeColor2: color,
    bgColor: color, hoverHighlight: bool, hoverColor: color,
  },
  grid: {
    horizontalLines: bool, horizontalColor: color, horizontalWidth: num(0, 3), verticalLines: bool, verticalColor: color,
    verticalWidth: num(0, 3), outerBorder: bool, outerBorderColor: color, outerBorderWidth: num(0, 3), cellPadding: num(2, 16),
  },
  totals: { bgColor: color, fontColor: color, fontBold: bool, borderTopColor: color },
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

// Every appearance setting the property panel writes, with the panel's own
// ranges and choices (asked by Jonathan: the assistant may change anything a
// visual's options offer — fonts, labels, frames, gradients). Behaviour stays
// out: sorting, top N, dates, an image's url, colors by rule on a measure (the highlight of bars is a look: it stays in).
const DESIGN_CONFIG = {
  // Title and frame
  title: str(200),
  titleColor: color,
  titleFontFamily: font,
  // The title bar: its size, weight, alignment, and above or under the visual
  // (a figure card captioned under its number).
  titleFontSize: num(10, 28),
  titleWeight: oneOf([400, 500, 600, 700]),
  titleAlign: oneOf(['left', 'center', 'right']),
  titlePosition: oneOf(['top', 'bottom']),
  backgroundColor: color,
  transparentBg: bool,
  gradientBg: gradient,
  borderEnabled: bool,
  borderColor: color,
  borderRadius: num(0, 64),
  shadow: shapeOf({ enabled: bool, type: oneOf(['outer', 'inner']), angle: num(0, 360), blur: num(0, 40), spread: num(0, 20), color }),
  mergeSeparatorColor: color,
  // Colors
  color,
  legendColors: colorMap,
  palette: hexList,
  legendSymbols: mapOf(oneOf(SYMBOLS)),
  valueGradient: shapeOf({ enabled: bool, minColor: color, maxColor: color }),
  // A pivot's cells tinted by their value (PivotTableWidget): a heatmap.
  // `true` alone turns it on in the theme's color (the model wrote it so, and the card lost it).
  heatmap: (v) => (v === true ? { enabled: true } : v === false ? { enabled: false } : shapeOf({ enabled: bool, color })(v)),
  // Bars that stand out (bar, combo): by a rule relative to the bars shown
  // — the n largest or smallest, those above the average by a share — or by
  // naming categories; `label` prints their value alone (client utils/highlight).
  highlight: (v) => {
    if (v === false) return { enabled: false };
    const out = shapeOf({
      enabled: bool, mode: oneOf(['top', 'bottom', 'above', 'values']), n: num(1, 10), above: num(5, 500), color, label: bool,
      values: (list) => (Array.isArray(list) ? list.filter((x) => typeof x === 'string' || typeof x === 'number').slice(0, 20).map((x) => String(x).slice(0, 80)) : undefined),
    })(v);
    return out ? { enabled: true, ...out } : undefined;
  },
  // The scale of a heatmap or a map: high values in scaleColor, low ones in
  // scaleLowColor (a pale tint of it when unset).
  scaleColor: color,
  scaleLowColor: color,
  showScale: bool,
  cellGap: num(0, 8),
  cellRadius: num(0, 12),
  cellBorderColor: color,
  mapEmptyColor: color,
  mapBorderColor: color,
  mapBubbleMax: num(8, 60),
  increaseColor: color,
  decreaseColor: color,
  totalColor: color,
  // Data labels
  showDataLabels: bool,
  dataLabelContent: oneOf(['value', 'name', 'percent', 'nameValue']),
  // On bars: auto (outside the end, inside when there is no room), top (outside the end), insideTop, inside, insideBottom — along the bar whatever its direction.
  dataLabelPosition: oneOf(['auto', 'outside', 'inside', 'top', 'insideTop', 'insideBottom']),
  dataLabelRotate: num(-90, 90),
  dataLabelFontSize: num(6, 36),
  dataLabelColor: color,
  dataLabelFontFamily: font,
  dataLabelBgColor: color,
  // A percentage here, but models think of opacity as 0–1: 0.7 meant 70 %,
  // and taken literally it is an invisible background.
  dataLabelBgOpacity: (v) => num(0, 100)(typeof v === 'number' && v > 0 && v <= 1 ? v * 100 : v),
  dataLabelAbbr: oneOf(NUMFMT),
  valueAbbreviation: oneOf(NUMFMT),
  showColumnNames: bool,
  // Axes and grid
  axisLabelOverflow: oneOf(['truncate', 'full']),
  showXAxis: bool,
  showYAxis: bool,
  showSecondaryAxis: bool,
  showXAxisTitle: bool,
  showYAxisTitle: bool,
  showSecondaryYAxisTitle: bool,
  xAxisTitle: str(200),
  yAxisTitle: str(200),
  secondaryYAxisTitle: str(200),
  xAxisLineColor: color,
  yAxisLineColor: color,
  secondaryYAxisLineColor: color,
  xAxisLabelRotate: (v) => (v === null ? null : num(-90, 90)(v)),
  xAxisLabelFontSize: num(6, 24),
  yAxisLabelFontSize: num(6, 24),
  secondaryYAxisLabelFontSize: num(6, 24),
  xAxisLabelColor: color,
  yAxisLabelColor: color,
  secondaryYAxisLabelColor: color,
  xAxisLabelFontFamily: font,
  yAxisLabelFontFamily: font,
  secondaryYAxisLabelFontFamily: font,
  // A scatter's axis titles
  headerFontSize: num(8, 24),
  headerColor: color,
  headerFontFamily: font,
  headerBold: bool,
  gridLineStyle: oneOf(['solid', 'dashed', 'dotted']),
  gridLineWidth: num(0, 5),
  gridLineColor: color,
  // Legend
  showLegend: bool,
  legendPosition: oneOf(['top', 'bottom', 'left', 'right']),
  legendFontFamily: font,
  legendTextColor: color,
  // The chart itself
  barDirection: oneOf(['vertical', 'verticalInverse', 'horizontal', 'horizontalInverse']),
  smooth: bool,
  showArea: bool,
  lineSymbol: oneOf(['circle', 'emptyCircle', 'rect', 'roundRect', 'triangle', 'diamond', 'pin', 'arrow', 'none']),
  lineSymbolSize: num(2, 20),
  donut: bool,
  symbolSize: num(2, 30),
  showItemBorder: bool,
  itemBorderColor: color,
  itemBorderWidth: num(0, 8),
  showTotal: bool,
  totalLabel: str(100),
  // Gauge
  gaugeColor: color,
  gaugeTrackColor: color,
  gaugeThresholdColor: color,
  gaugeOverColor: color,
  gaugeConditionalColor: bool,
  gaugeDirection: oneOf(['up', 'down', 'right', 'left']),
  gaugeArcWidth: num(4, 120),
  gaugeArcSpan: num(90, 360),
  gaugeArcRounded: bool,
  gaugeShowValue: bool,
  gaugeValueSize: num(10, 60),
  gaugeValueColor: color,
  gaugeValueFontFamily: font,
  gaugeShowLabel: bool,
  gaugeLabelSize: num(8, 30),
  gaugeLabelColor: color,
  gaugeLabelFontFamily: font,
  gaugeShowMinMax: bool,
  gaugeAxisSize: num(8, 24),
  gaugeAxisColor: color,
  gaugeAxisOutset: num(-20, 80),
  gaugeAxisCenterPull: num(0, 200),
  // Filter
  dateLayout: oneOf(['vertical', 'horizontal']),
  orientation: oneOf(['vertical', 'horizontal']),
  showSearch: bool,
  showSelectAll: bool,
  searchPlaceholder: str(80),
  slicerFontSize: num(8, 24),
  slicerFontColor: color,
  slicerFontFamily: font,
  slicerSelectedColor: color,
  slicerSelectedBg: color,
  // Scorecard
  labelPosition: oneOf(['above', 'below']),
  showValue: bool,
  valueSize: num(16, 72),
  valueColor: color,
  valueFontFamily: font,
  valueWeight: oneOf([300, 400, 600, 700]),
  showLabel: bool,
  labelSize: num(8, 32),
  labelColor: color,
  labelFontFamily: font,
  showN1Value: bool,
  showN1Difference: bool,
  showN1Percent: bool,
  n1ValueStyle: shapeOf(N1_COMMON),
  n1DifferenceStyle: shapeOf(N1_SIGNED),
  n1PercentStyle: shapeOf(N1_SIGNED),
  // The page's dressing (ShapeWidget, TextWidget, ImageWidget): restyled like
  // any widget — never an image's url, which only comes from what the user added.
  padding: num(0, 64),
  // A text's own font (the canvas toolbar); its runs let go of what is set here (client aiProposal).
  fontSize: num(8, 96),
  fontFamily: font,
  bold: bool,
  italic: bool,
  textAlign: oneOf(['left', 'center', 'right', 'flex-start', 'flex-end']),
  verticalAlign: oneOf(['flex-start', 'center', 'flex-end']),
  shapeFill: color,
  shapeStroke: color,
  shapeStrokeWidth: num(0, 20),
  shapeOpacity: num(0, 100),
  lineColor: color,
  lineThickness: num(1, 20),
  lineRotation: num(0, 360),
  arrowDirection: oneOf(['right', 'down', 'left', 'up']),
  fit: oneOf(['contain', 'cover', 'fill', 'none']),
  rotation: num(0, 360),
  tableConfig: tableLook,
};

// The page's look beyond its theme and color (report settings, SettingsPanel):
// a gradient under the cards (an uploaded image still covers it), the color
// around the page, its border, corners and shadow.
const PAGE_LOOK = {
  gradientBg: gradient,
  surroundColor: (v) => (v === null ? null : color(v)),
  showBorder: bool,
  borderRadius: num(0, 24),
  showShadow: bool,
  transparentBg: bool,
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
// A label that is a column's own name: snake_case, a dotted path.
const RAW_LABEL = /^[a-z0-9]+([_.][a-z0-9]+)*$/;
// What colorScheme `frame` sets on a widget (colorScheme.js).
const FRAME_KEYS = new Set(['titleColor', 'borderEnabled', 'borderColor']);
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
  // The page shown, and the report's other pages: their widgets are restyled
  // AND laid out from here (Jonathan: "all the scorecards of the report at
  // 220 × 120" was sent back page by page). `arrangement` stays the page
  // shown's: rows are a rework of one page.
  const elsewhere = new Map();
  for (const p of ctx.pageContext.otherPages || []) for (const w of p.widgets || []) elsewhere.set(w.id, { ...w, pageId: p.id, page: p.name });
  const byId = new Map([...elsewhere, ...ctx.pageContext.widgets.map((w) => [w.id, w])]);
  const everywhere = { ...ctx.pageContext, widgets: [...ctx.pageContext.widgets, ...elsewhere.values()] };
  // An operation on another page's widget carries its page, and the widget's title for the card.
  const placed = (op) => { const w = elsewhere.get(op.widgetId); return w ? { ...op, pageId: w.pageId, page: w.page, title: w.title || '' } : op; };
  const themes = new Set(ctx.pageContext.themes || []);
  const list = args && Array.isArray(args.ops) ? args.ops.slice(0, MAX_OPS) : [];
  const ops = [];
  const errors = [];

  // Rows and weights in, `move` operations out: from here on an arrangement
  // is ordinary moves, which is all the editor ever has to know how to apply.
  const arranged = new Set();
  // Each page as the placements of this proposal leave it, one after the other.
  const lives = new Map([[null, new Map(ctx.pageContext.widgets.map((w) => [w.id, w]))]]);
  for (const p of ctx.pageContext.otherPages || []) lives.set(p.id, new Map((p.widgets || []).map((w) => [w.id, w])));
  // Boxes the model chose under a widget's readable floor: said on the card.
  const sized = [];
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
    const target = switched ? { ...everywhere, theme: switched.set.theme } : everywhere;
    const colored = colorOps(String(args.colorScheme), args.baseColor, target, dimensions, { accentHex: args.accentColor, frame: args.frame === true });
    // Flagged so the card can say "palette X on N widgets" in one line.
    if (colored) {
      ops.push(...colored.map((op) => placed({ ...op, fromScheme: true })));
      // The frame the rule dresses (titles, borders) stays the model's to adjust
      // per visual — no border on a figure that reads better without one.
      for (const op of colored) if (op.widgetId) ruled.set(op.widgetId, Object.fromEntries(Object.entries(op.set).filter(([k]) => !FRAME_KEYS.has(k))));
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
      // The rest of the page's look, as the report settings panel offers it.
      for (const [key, check] of Object.entries(PAGE_LOOK)) {
        if (src[key] === undefined) continue;
        const v = check(src[key]);
        if (v === undefined) { errors.push(`${label}: ${key} is not a valid value`); return; }
        set[key] = v;
      }
      if (src.theme === undefined && src.pageBackground === undefined && !Object.keys(PAGE_LOOK).some((k) => src[k] !== undefined)) { errors.push(`${label}: nothing to set`); return; }
      if (!Object.keys(set).length) return;
      ops.push({ op: 'report_settings', set });
      return;
    }
    // The page menu: its look and an icon per page (pageNav.js).
    // Never held to the reading's theme: asked about the menu, the model read
    // "colors" and the whole op vanished, card and all.
    if (raw.op === 'page_nav') {
      const checked = validatePageNavOp(raw, ctx.pageContext, font, ctx.assets || []);
      if (checked.error) { errors.push(`${label}: ${checked.error}`); return; }
      ops.push(checked.op);
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
      // The panel's corners: 24 on a card, 64 on an image only.
      if (target.type !== 'image' && set.borderRadius > 24) set.borderRadius = 24;
      // Restating what is already there is not a change, and pads the card.
      for (const key of Object.keys(set)) {
        if (JSON.stringify(set[key]) === JSON.stringify((target.config || {})[key])) delete set[key];
      }
      if (refused.length) errors.push(`${label}: ignored ${refused.slice(0, 5).map((k) => String(k).slice(0, 30)).join(', ')} (not settable or invalid value)`);
      if (Object.keys(set).length) ops.push(placed({ op: 'update_config', widgetId: target.id, set }));
    } else if (raw.op === 'place') {
      // One widget set next to, under or over another; the page otherwise
      // untouched (Jonathan: stacking two filters re-laid nine widgets).
      if (!scope.layout) return;
      if (arranged.has(target.id)) return;
      if (target.merged) { errors.push(`${label}: this widget is part of a merged block and cannot be moved alone`); return; }
      if (!['right', 'left', 'below', 'above'].includes(raw.side)) { errors.push(`${label}: place needs \`side\` right, left, below or above`); return; }
      const near = byId.get(raw.near);
      if (!near || (near.pageId || null) !== (target.pageId || null) || near.id === target.id) { errors.push(`${label}: place needs \`near\`, another widget of the same page`); return; }
      const live = lives.get(target.pageId || null);
      const set = placeWidget(live, target.id, { near: near.id, side: raw.side }, ctx.page, ctx.effective);
      if (set.error) { errors.push(`${label}: ${set.error}`); return; }
      // Each placement starts from the page the ones before it left; a widget
      // moved twice keeps its last place.
      for (const move of set.moves) {
        live.set(move.widgetId, { ...live.get(move.widgetId), layout: { x: move.x, y: move.y, w: move.w, h: move.h } });
        const at = ops.findIndex((o) => o.op === 'move' && o.widgetId === move.widgetId);
        if (at >= 0) ops[at] = placed(move); else ops.push(placed(move));
        arranged.add(move.widgetId);
      }
    } else if (raw.op === 'move' || raw.op === 'z_order') {
      if (raw.op === 'z_order') {
        if (raw.to !== 'front' && raw.to !== 'back') { errors.push(`${label}: z_order goes to "front" or "back"`); return; }
        ops.push(placed({ op: 'z_order', widgetId: target.id, to: raw.to }));
        return;
      }
      if (!scope.layout) return;
      // The arrangement already placed it, to the pixel; a second opinion in
      // hand-computed coordinates would only undo that.
      if (arranged.has(target.id)) return;
      // A merged block moves as one piece; moving a member would tear it.
      if (target.merged) { errors.push(`${label}: this widget is part of a merged block and cannot be moved alone`); return; }
      const rect = freeBox(raw, ctx.page);
      if (!rect) { errors.push(`${label}: x, y, w and h must be numbers`); return; }
      // The size is the model's call (asked by Jonathan: it decides): under
      // the readable floor it is said on the card, never refused.
      const min = minOf(target);
      // Data visuals only: a shape or a text has no readable floor to speak of.
      if (READABLE_MIN[target.type] && (rect.w < min.w || rect.h < min.h)) sized.push(`${JSON.stringify(target.title || target.type)} is under its readable size (${rect.w} × ${rect.h}, reads from ${min.w} × ${min.h})`);
      ops.push(placed({ op: 'move', widgetId: target.id, ...rect }));
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
  for (const fix of readabilityOps(everywhere, ops)) {
    for (const key of Object.keys(fix.set)) {
      if (key === 'tableConfig') continue;
      const chosen = ops.filter((op) => op.op === 'update_config' && op.widgetId === fix.widgetId && !op.fromScheme && key in op.set).pop();
      if (!chosen) continue;
      chosen.set[key] = fix.set[key];
      delete fix.set[key];
    }
    if (Object.keys(fix.set).length) ops.push(placed(fix));
  }
  const colorScheme = ops.some((op) => op.fromScheme) ? String(args.colorScheme) : null;
  // Free boxes settled: what would overlap is pushed down, and the page grows
  // when the boxes run past it — the model places, the editor tidies.
  // Not for rows: a widget an arrangement leaves out is the model's choice,
  // named in `advice` for the author to remove, not to be slid about.
  // Each page settled on its own; the page height is the report's, so the
  // tallest page sets it.
  const shown = arranged.size && args.arrangement ? { notes: [], pageHeight: ctx.page.height } : settleMoves(ctx.pageContext.widgets, ops, ctx.page);
  const settled = [shown, ...(ctx.pageContext.otherPages || []).map((p) => settleMoves(p.widgets || [], ops, ctx.page, p.id, placed))];
  const overlaps = [newOverlaps(ctx.pageContext.widgets, ops), ...(ctx.pageContext.otherPages || []).map((p) => newOverlaps(p.widgets || [], ops, p.id))].flat();
  // `notes`: what the editor did on its own (a widget slid down); for the
  // card, never a reason for a repair round — that tidying is the design.
  return {
    summary: text(args && args.summary, 500), advice, colorScheme, ops, errors, pageHeight: Math.max(...settled.map((s) => s.pageHeight)),
    warnings: [...sized, ...overlaps, ...menuLeftOut(ops, colorScheme, ctx.pageContext), ...noDirection(ops, colorScheme, ctx)],
    notes: settled.flatMap((s) => s.notes).slice(0, 10),
  };
}

// The look of a report of several pages and its page menu go together (asked
// by Jonathan: "il doit être de paire"): a proposal that restyles the report
// — a color rule, the report's settings, the other pages — while the menu has
// no look of its own yet leaves it out, and goes back once to add page_nav.
// A whole look names its direction (prompt DESIGNER_GUIDE): without one, the
// same recipe came back for an insurer and a bistro.
const STYLES = new Set(['editorial', 'corporate', 'control-room', 'minimal', 'bold', 'soft']);
function noDirection(ops, colorScheme, ctx) {
  const whole = colorScheme && ops.some((op) => op.op === 'report_settings' || op.op === 'page_nav' || (op.pageId && op.pageId !== ctx.pageContext.pageId));
  return whole && !STYLES.has(ctx.style) ? ['a look for the whole report declares its direction in reading.style (editorial, corporate, control-room, minimal, bold, soft) and follows it in every font, frame, the page and the menu'] : [];
}

const NAV_STYLE = ['bgColor', 'textColor', 'activeBgColor', 'activeTextColor', 'fontFamily'];
function menuLeftOut(ops, colorScheme, pageContext) {
  if (!(pageContext.otherPages || []).length || ops.some((op) => op.op === 'page_nav')) return [];
  if (NAV_STYLE.some((k) => (pageContext.pageNav || {})[k])) return [];
  const restyled = colorScheme || ops.some((op) => op.op === 'report_settings' || (op.pageId && op.pageId !== pageContext.pageId));
  return restyled ? ['the report has several pages and its page menu has no look yet: add a page_nav op to this proposal, in the same look (its place, colors, font, the page open standing out, an icon per page)'] : [];
}

// A box as the model wrote it, snapped to the grid and kept within the page
// width; below the page it may go — the page grows (settleMoves). No floor
// but the grid step: the size is the model's to decide.
function freeBox(raw, page) {
  if (!raw || typeof raw !== 'object') return null;
  const nums = [raw.x, raw.y, raw.w, raw.h].map(Number);
  if (!nums.every(Number.isFinite)) return null;
  const w = Math.min(Math.max(snap(nums[2]), GRID), page.width);
  const h = Math.max(snap(nums[3]), GRID);
  const x = Math.min(Math.max(snap(nums[0]), 0), page.width - w);
  const y = Math.max(snap(nums[1]), 0);
  return { x, y, w, h };
}

const SETTLE_GUTTER = 20;
const SETTLE_PASSES = 20;

/**
 * Data visuals that would sit on one another after the moves: the lower one
 * (in reading order) slides down under the other, and a widget pushed that
 * the proposal did not move gets a move of its own. An overlap the page
 * already had between two untouched widgets is the author's and stays. The
 * page height the boxes then need travels with the proposal.
 * @returns {{ notes: string[], pageHeight: number }}
 */
function settleMoves(pageWidgets, ops, page, pageId = null, tag = (op) => op) {
  const moves = new Map(ops.filter((o) => o.op === 'move' && (o.pageId || null) === pageId).map((o) => [o.widgetId, o]));
  if (!moves.size) return { notes: [], pageHeight: page.height };
  const boxes = pageWidgets
    .filter((w) => READABLE_MIN[w.type] && !w.merged)
    .map((w) => ({ w, before: rectOf(w.layout), at: rectOf(moves.get(w.id) || w.layout), placed: moves.has(w.id), moved: moves.has(w.id) }))
    .filter((b) => b.at);
  const name = (w) => JSON.stringify(w.title || w.type);
  const notes = [];
  for (let pass = 0; pass < SETTLE_PASSES; pass++) {
    boxes.sort((a, b) => a.at.y - b.at.y || a.at.x - b.at.x);
    let changed = false;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        if (!intersects(boxes[i].at, boxes[j].at)) continue;
        if (!boxes[i].moved && !boxes[j].moved && boxes[i].before && boxes[j].before && intersects(boxes[i].before, boxes[j].before)) continue;
        // The box the proposal placed keeps its place; what it landed on
        // slides. Two placed boxes: the lower in reading order slides.
        const [stay, go] = !boxes[i].placed && boxes[j].placed ? [boxes[j], boxes[i]] : [boxes[i], boxes[j]];
        go.at = { ...go.at, y: stay.at.y + stay.at.h + SETTLE_GUTTER };
        if (!go.moved) notes.push(`${name(go.w)} moved down under ${name(stay.w)} to make room`);
        go.moved = true;
        changed = true;
      }
    }
    if (!changed) break;
  }
  for (const b of boxes) {
    if (!b.moved) continue;
    const existing = moves.get(b.w.id);
    if (existing) Object.assign(existing, { x: b.at.x, y: b.at.y, w: b.at.w, h: b.at.h });
    else ops.push(tag({ op: 'move', widgetId: b.w.id, ...b.at }));
  }
  const bottom = boxes.reduce((max, b) => Math.max(max, b.at.y + b.at.h), 0);
  return { notes: [...new Set(notes)].slice(0, 10), pageHeight: Math.max(page.height, bottom + SETTLE_GUTTER) };
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
function newOverlaps(pageWidgets, ops, pageId = null) {
  const moves = new Map(ops.filter((o) => o.op === 'move' && (o.pageId || null) === pageId).map((o) => [o.widgetId, o]));
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
  BINDING_KEYS, DECOR_TYPES, SUB_TYPES, DESIGN_CONFIG, TABLE_LOOK, PAGE_LOOK, READABLE_MIN, QUESTION_KINDS,
};
