// The look a visual made by the assistant gets when the proposal says nothing
// about it. A proposal carries a type, fields and a title; left alone, the
// widget lands in the editor's bare defaults — raw field names on the cards,
// six decimals in the tables, a legend for a single series, a list filter the
// height of a chart (seen on a real report). The Finance package reads well
// because each of its widgets is dressed by hand; this is that dressing,
// generalised, and only ever for keys the proposal left unset.

const { roleOf } = require('./domains');
const { colorOps, DEFAULT_BASE } = require('./colorScheme');
const { parseArithmetic } = require('../measureType/arithmetic');
const { readsDistinctRows } = require('../sqlBuilder/dimMeasure');

const LEGEND_TYPES = new Set(['bar', 'line', 'combo', 'scatter', 'pie']);
const ABBREVIATED = new Set(['bar', 'line', 'combo', 'waterfall']);
// Data labels only where they stay readable: a handful of bars.
const MAX_LABELLED_BARS = 12;

const fieldOf = (effective, name) => [...(effective.dimensions || []), ...(effective.measures || [])].find((f) => f.name === name) || null;
const labelOf = (effective, name) => { const f = fieldOf(effective, name); return (f && f.label) || name; };
// A period written as text (a calendar's YearMonth, a month name derived from
// a date) keeps its order too: sorted by value, a chart by month lost its months.
const PERIOD = /year|month|quarter|week|period|date|day|time|calendar|calendrier/i;
const periodLike = (d) => !!d.datePart || PERIOD.test(String(d.column || '')) || PERIOD.test(String(d.table || '').split('__').pop());
const isOrdered = (effective, name) => { const d = (effective.dimensions || []).find((x) => x.name === name); return !d || /date|time|int|num|float|double|decimal|real/i.test(String(d.type || '')) || periodLike(d); };

/**
 * Fill the look of one validated widget in place. `cardinality[dim]` is the
 * cache's count of a dimension's values ({ n, more }), when known.
 */
function dressWidget(widget, { effective, cardinality = {} }) {
  const { type, config, dataBinding: b } = widget;
  const set = (key, value) => { if (config[key] === undefined) config[key] = value; };
  const measures = b.selectedMeasures || [];
  const dims = b.selectedDimensions || [];
  const series = (b.groupBy || []).length > 0 || measures.length > 1;

  if (type === 'scorecard' && measures[0]) {
    // The card names the figure once: by its title when it has one, else by
    // the measure's label, never by the field's name (a title AND a label
    // said the same thing twice, seen on a page with no other card).
    // With a title, the widget would still print the measure's own label
    // under it ("qte_servie" under "Quantité servie", seen with Karim).
    if (!config.title) set('label', labelOf(effective, measures[0]));
    else if (!config.label) set('showLabel', false);
    if (b.compareDateDim) { set('showN1Percent', true); set('showN1Difference', false); set('showN1Value', false); }
  }
  if (ABBREVIATED.has(type)) set('valueAbbreviation', 'auto');
  if (LEGEND_TYPES.has(type)) {
    // One series needs no legend; several read best along the top.
    if (type === 'pie') set('showLegend', true); else config.showLegend = series;
    set('legendPosition', 'top');
  }
  if (type === 'bar' && dims[0] && !(b.groupBy || []).length) {
    // Categories by value, largest first; time and numbers keep their order.
    if (!isOrdered(effective, dims[0])) set('sortOrder', 'desc');
    const c = cardinality[dims[0]];
    if (c && !c.more && c.n <= MAX_LABELLED_BARS) set('showDataLabels', true);
  }
  if (type === 'treemap') { set('showDataLabels', true); set('dataLabelContent', 'name'); }
  if (type === 'filter') {
    // A dropdown sits in a strip; a list takes a chart's height.
    set('slicerStyle', 'dropdown');
    if (dims[0] && !config.title) config.title = labelOf(effective, dims[0]);
  }
  if ((type === 'table' || type === 'pivotTable') && measures.length) {
    // Amounts right-aligned, on one line.
    const columns = Object.fromEntries(measures.map((m) => [labelOf(effective, m), { header: { wordWrap: false }, values: { alignment: 'right', wordWrap: false } }]));
    // Column by column: a name the proposal gave keeps the alignment.
    const given = (config.tableConfig || {}).columns || {};
    for (const [key, col] of Object.entries(given)) columns[key] = { ...(columns[key] || {}), ...col };
    config.tableConfig = { ...(config.tableConfig || {}), columns };
  }
  return widget;
}

const dressWidgets = (widgets, ctx) => widgets.map((w) => dressWidget(w, ctx));

// What a new visual takes from the ones already on the page: never its
// words (title, axis titles, series names) nor the colours a series carries
// by name — the rest of the look of the first neighbour of its type.
const OWN_WORDS = new Set(['title', 'legendColors', 'xAxisTitle', 'yAxisTitle', 'totalLabel']);

// What makes two visuals alike enough to share a look: the same type, and
// the same amount on them — one series or several (a legend or none), a
// figure with or without its comparison, a filter of the same style. A
// proposal that says nothing of its filter's style is like any filter.
function shapeOf(w) {
  const b = w.dataBinding || {};
  const c = { ...(w.config || {}), ...(w.shape || {}) };
  if (w.type === 'scorecard' || w.type === 'gauge') return b.compareDateDim ? 'compared' : 'plain';
  if (w.type === 'filter') return c.slicerStyle || '';
  if (LEGEND_TYPES.has(w.type)) {
    const measures = [b.selectedMeasures, b.comboBarMeasures, b.comboLineMeasures].reduce((n, l) => n + (Array.isArray(l) ? l.length : 0), 0);
    return measures > 1 || (b.groupBy || []).length > 0 ? 'series' : 'single';
  }
  return '';
}
const alike = (w, s) => s && s.type === w.type && (w.type === 'filter' && !shapeOf(w) ? true : shapeOf(s) === shapeOf(w));

/**
 * A new visual dressed like the neighbours it resembles on the page it
 * joins (`alike`), under the keys its proposal left unset: the same frame,
 * the same legend place, the same label sizes — a page keeps one look. A
 * scorecard beside scorecards that bear no title bar takes none either: the
 * title the model wrote becomes its label (the Finance package's figures
 * read so). With no neighbour like it, the proposal's own choices stand.
 * Asked by Jonathan: "look at how the other visuals were made" rather
 * than a rule per type — and only the ones that look like it, the model
 * decides the look of a visual unlike any on the page.
 * @param {object} widget    a validated proposal: { type, config, dataBinding }
 * @param {object[]} siblings  the page's widgets as the context describes them: { type, title, config, shape, dataBinding }
 */
// The report's house style: the frame and the fonts most of the page shares,
// whatever their type. A page made after the report was dressed came out
// plain — its table had no table to copy (seen with Karim). Only what at
// least two thirds of the visuals hold: a deliberate look, never one
// neighbour's whim (Jonathan 2026-10-14: "trop loin dans la recopie").
const HOUSE_KEYS = ['titleColor', 'titleFontFamily', 'titleFontSize', 'titleWeight', 'titleAlign', 'borderEnabled', 'borderColor', 'borderRadius', 'shadow', 'backgroundColor', 'gradientBg', 'transparentBg'];
const BODY_FONT_KEYS = ['labelFontFamily', 'legendFontFamily', 'dataLabelFontFamily', 'xAxisLabelFontFamily', 'yAxisLabelFontFamily', 'slicerFontFamily'];
const DECOR = new Set(['text', 'shape', 'image']);

function shared(values, of) {
  const counts = new Map();
  for (const v of values) { const k = JSON.stringify(v); counts.set(k, (counts.get(k) || 0) + 1); }
  const [best, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] || [];
  return best !== undefined && n >= 2 && n * 3 >= of * 2 ? JSON.parse(best) : undefined;
}

function houseStyle(widget, siblings) {
  const visuals = (siblings || []).filter((s) => !DECOR.has(s.type));
  if (DECOR.has(widget.type) || visuals.length < 2) return;
  const config = widget.config || (widget.config = {});
  for (const key of HOUSE_KEYS) {
    if (config[key] !== undefined) continue;
    const v = shared(visuals.map((s) => (s.config || {})[key]).filter((x) => x !== undefined), visuals.length);
    if (v !== undefined) config[key] = v;
  }
  // The text font: the one the visuals' labels, axes and legends share.
  const fonts = visuals.map((s) => BODY_FONT_KEYS.map((k) => (s.config || {})[k]).find((x) => x));
  const body = shared(fonts.filter(Boolean), visuals.length);
  if (!body) return;
  for (const key of BODY_FONT_KEYS) if (config[key] === undefined) config[key] = body;
  if (widget.type === 'table' || widget.type === 'pivotTable') {
    const tc = config.tableConfig || {};
    config.tableConfig = { ...tc, header: { fontFamily: body, ...(tc.header || {}) }, values: { fontFamily: body, ...(tc.values || {}) } };
  }
}

function matchNeighbours(widget, siblings) {
  houseStyle(widget, siblings);
  const like = (siblings || []).filter((s) => alike(widget, s));
  if (!like.length) return widget;
  const config = widget.config || {};
  const model = like[0].config || {};
  for (const [key, value] of Object.entries(model)) {
    if (OWN_WORDS.has(key) || value === undefined || config[key] !== undefined) continue;
    config[key] = value;
  }
  const titled = (s) => !!(s.title || (s.config && s.config.title));
  if ((widget.type === 'scorecard' || widget.type === 'gauge') && config.title && !like.some(titled)) {
    config.label = config.label || config.title;
    delete config.title;
  }
  widget.config = config;
  return widget;
}

// A measure name is raw when the model's author never gave it a label.
const rawLabel = (m) => !m.label || m.label === m.name || /[_.]/.test(m.label);

/**
 * Report-level overrides for the measures these widgets show and the model
 * leaves unformatted: thousands separated, decimals by what the aggregation
 * yields (a sum or a count is whole, an average is not), and the role's
 * label where the field only has its raw name. The separators are not here:
 * they are the reader's, from the browser that opens the report. Merged into
 * settings.measureOverrides by whoever applies the proposal.
 */
function formatOverrides(widgets, effective) {
  const out = {};
  const used = new Set(widgets.flatMap((w) => {
    const b = w.dataBinding || {};
    return [...(b.selectedMeasures || []), ...(b.comboBarMeasures || []), ...(b.comboLineMeasures || []), ...Object.values(b.scatterMeasures || {})];
  }));
  // The names the model gave the measures a visual shows (validateProposal
  // `fieldNames`): their label everywhere in the report. Taken off the widget
  // here, which every caller of a proposal goes through: never saved on it.
  const given = {};
  const decimals = {};
  for (const w of widgets) {
    if (w.fieldLabels) Object.assign(given, w.fieldLabels);
    if (w.fieldDecimals) Object.assign(decimals, w.fieldDecimals);
    delete w.fieldLabels;
    delete w.fieldDecimals;
  }
  for (const name of used) {
    const m = (effective.measures || []).find((x) => x.name === name);
    if (!m) continue;
    const patch = {};
    if (!m.format || typeof m.format !== 'object') {
      patch.format = { decimals: decimalsOf(m, effective.measures || [], effective.joins || []), thousandSep: ' ', prefix: '', suffix: '' };
    }
    const role = roleOf(m.role);
    if (role && rawLabel(m)) patch.label = role.label;
    // A name or decimals the model gave: over the report's own override too
    // (`chosen`, read by whoever merges, never saved) — "Taux a l heure"
    // stayed in the headers when the user asked for it written properly.
    const chosen = {};
    if (given[name]) chosen.label = given[name];
    if (Number.isInteger(decimals[name])) {
      chosen.format = { ...(patch.format || (m.format && typeof m.format === 'object' ? m.format : { thousandSep: ' ', prefix: '', suffix: '' })), decimals: decimals[name] };
    }
    if (Object.keys(chosen).length) Object.assign(patch, chosen, { chosen });
    if (Object.keys(patch).length) out[name] = patch;
  }
  return out;
}

// Decimals of a measure with no format: none for a sum or a count, two for an
// average or a ratio. A sum or difference of measures keeps its parts'
// (ordered − served was a custom: "86 291.00" pallets, seen with Karim). The
// average of a whole-number column read once per item is whole: a product's
// reorder threshold showed "44.00". Over the rows of a fact it keeps one: a
// delay of 3.1 days against 3 promised showed "3" and "3" (recipe "Moreau").
const WHOLE = /int|integer|bigint|smallint|tinyint|hugeint/i;
function decimalsOf(m, measures, joins = [], seen = new Set()) {
  if (!m || seen.has(m.name)) return 2;
  seen.add(m.name);
  if (m.format && typeof m.format === 'object' && Number.isInteger(m.format.decimals)) return m.format.decimals;
  if (m.aggregation === 'avg') return !WHOLE.test(String(m.dataType || '')) ? 2 : readsDistinctRows(m, m.table, joins) ? 0 : 1;
  if (m.aggregation !== 'custom') return 0;
  const parts = parseArithmetic(m.expression);
  if (!parts || (parts.op !== 'add' && parts.op !== 'subtract')) return 2;
  const byName = (name) => measures.find((x) => x.name === name);
  return Math.max(decimalsOf(byName(parts.left), measures, joins, seen), decimalsOf(byName(parts.right), measures, joins, seen));
}


/**
 * Colors for a set of new widgets, from the page's theme: the same rule the
 * Design mode applies to a whole page (colorScheme.js) — one accent, distinct
 * hues for unordered categories, a ramp for ordered ones, soft table headers
 * — computed for the dark or the light surface, so a report made on the
 * user's dark theme does not land in light-theme blues. Only keys the
 * proposal left unset.
 */
function colorWidgets(widgets, { theme, effective }) {
  const pseudo = { theme: theme === 'dark' ? 'dark' : 'light', widgets: widgets.map((w, i) => ({ id: `n${i}`, type: w.type, config: w.config || {}, dataBinding: w.dataBinding || {} })) };
  for (const op of colorOps('categorical', DEFAULT_BASE, pseudo, effective.dimensions || []) || []) {
    const w = widgets[Number(op.widgetId.slice(1))];
    for (const [key, value] of Object.entries(op.set)) {
      if (key === 'tableConfig') w.config.tableConfig = { ...value, ...(w.config.tableConfig || {}) };
      else if (w.config[key] === undefined) w.config[key] = value;
    }
  }
  return widgets;
}

module.exports = { dressWidget, dressWidgets, matchNeighbours, colorWidgets, formatOverrides };
