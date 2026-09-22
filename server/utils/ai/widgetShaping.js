// What shapes the DATA of a proposed visual beyond its fields: the filters of
// the visual (ranking included), a time period, the sort and the row limit —
// the same things an author sets in the panel's Filters and Data sections.
//
// As everywhere the assistant is involved, a field name is only ever looked up
// in the effective model. Values are data: scalars, capped, and they reach SQL
// through /query, which quotes them like any filter rule typed in the editor.

const MAX_FILTERS = 6;
const MAX_VALUES = 50;
const MAX_VALUE_CHARS = 200;
const MAX_RANK = 100;
const MAX_ROWS = 10000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Mirrors client/src/utils/timeIntelligence.js TIME_PRESETS.
const TIME_PRESETS = ['ytd', 'qtd', 'mtd', 'last_7_days', 'last_30_days', 'last_90_days', 'last_12_months', 'prev_month', 'prev_quarter', 'prev_year'];

// Mirrors FilterRulesEditor.opsForType: an op the editor cannot show is an op
// the author could not read back or change.
const OPS = {
  string: ['in', 'not_in', 'contains', 'not_contains', 'starts_with', 'ends_with', 'is_empty', 'is_not_empty'],
  date: ['between', 'gte', 'lte'],
  number: ['in', 'not_in', 'gt', 'gte', 'lt', 'lte', 'between'],
  measure: ['gt', 'gte', 'lt', 'lte', 'between', 'top_n', 'bottom_n'],
};
const ALL_OPS = [...new Set(Object.values(OPS).flat())];
const VALUELESS = new Set(['is_empty', 'is_not_empty']);
const LISTS = new Set(['in', 'not_in']);
const RANKS = new Set(['top_n', 'bottom_n']);
// Charts that draw their values in the order of `sortOrder`.
const SORTED_TYPES = new Set(['bar', 'pie', 'treemap', 'combo', 'line']);
const LIMITED_TYPES = new Set(['table', 'pivotTable']);
// Nothing to rank: a single figure, or a control.
const UNRANKED_TYPES = new Set(['scorecard', 'gauge', 'filter']);

const isDateType = (t) => /date|time/i.test(String(t || ''));
const isNumberType = (t) => /int|num|float|double|decimal|real/i.test(String(t || ''));

function kindOf(field, effective) {
  if (effective.measures.some((m) => m.name === field)) return 'measure';
  const dim = effective.dimensions.find((d) => d.name === field);
  if (!dim) return null;
  if (isDateType(dim.type)) return 'date';
  return isNumberType(dim.type) ? 'number' : 'string';
}

function cleanValue(v, kind) {
  if (kind === 'date') return typeof v === 'string' && ISO_DATE.test(v) ? v : undefined;
  if (kind === 'measure' || kind === 'number') return Number.isFinite(Number(v)) && v !== '' && v !== null ? Number(v) : undefined;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_VALUE_CHARS ? v : undefined;
}

// One rule, in the shape the editor saves: { field, isMeasure, op, value, values }.
function ruleOf(raw, effective) {
  const kind = raw && typeof raw.field === 'string' ? kindOf(raw.field, effective) : null;
  if (!kind) return { error: `unknown filter field ${JSON.stringify(String(raw && raw.field).slice(0, 80))}` };
  if (!OPS[kind].includes(raw.op)) return { error: `filter on ${raw.field}: operator must be one of ${OPS[kind].join(', ')}` };
  const base = { field: raw.field, isMeasure: kind === 'measure', op: raw.op };
  if (VALUELESS.has(raw.op)) return { rule: { ...base, value: '', values: [] } };

  // `values`, or a list written under `value`: the same intent either way.
  const list = Array.isArray(raw.values) && raw.values.length ? raw.values : raw.value;
  const given = (Array.isArray(list) ? list : [list]).filter((v) => v !== undefined && v !== null && v !== '').slice(0, MAX_VALUES);
  // Seen with a real model: asked "among these clients", it filtered on the
  // client names of the previous answer — which it had never read, so the
  // list came out empty. What it needed was the ranking itself.
  if (!given.length) {
    return { error: `filter on ${raw.field}: no value. Only filter on values you have read. To keep the members of a ranking ("among these top 5"), do not list them: set topN / bottomN again, with rankBy the measure they were ranked by` };
  }
  const values = given.map((v) => cleanValue(v, RANKS.has(raw.op) ? 'number' : kind));
  if (values.includes(undefined)) {
    const bad = given[values.indexOf(undefined)];
    return { error: `filter on ${raw.field}: ${JSON.stringify(bad).slice(0, 60)} is not a valid value${kind === 'date' ? ' (dates are YYYY-MM-DD)' : ''}${kind === 'measure' || kind === 'number' ? ' (a number is expected)' : ''}` };
  }
  if (RANKS.has(raw.op)) {
    const n = Math.floor(values[0]);
    if (n < 1) return { error: `filter on ${raw.field}: N must be at least 1` };
    return { rule: { ...base, value: Math.min(n, MAX_RANK), values: [] } };
  }
  if (raw.op === 'between') {
    if (values.length !== 2) return { error: `filter on ${raw.field}: between needs two values` };
    return { rule: { ...base, value: '', values } };
  }
  if (LISTS.has(raw.op)) return { rule: { ...base, value: '', values } };
  return { rule: { ...base, value: values[0], values: [] } };
}

/**
 * @param {object} raw       one widget of `propose_widgets`, as the model wrote it
 * @param {object} binding   its validated binding
 * @param {object} ctx       { effective, rank?: {n, op, by?} from the model's reading of the request, keepRank?: {field, op, n} of the previous answer, alone: the only visual proposed }
 * @returns {{ binding: object, config: object } | { error: string }} what to merge into the widget
 */
function shapeWidget(raw, binding, ctx) {
  const { effective } = ctx;
  const config = {};
  const out = {};
  const rules = [];

  for (const f of (Array.isArray(raw.filters) ? raw.filters : []).slice(0, MAX_FILTERS)) {
    const { rule, error } = ruleOf(f || {}, effective);
    if (error) return { error };
    rules.push(rule);
  }

  // "top 5" / "bottom 5": sugar for a ranking rule, on the first measure or on
  // `rankBy` — which need not be on the visual: "among the 5 biggest clients by
  // calls, cancelled calls" ranks by calls and shows cancellations. The number
  // the USER wrote wins over the one the model copied; on a page of several
  // visuals, only those the model marked are ranked.
  const marked = raw.topN ? { n: raw.topN, op: 'top_n' } : (raw.bottomN ? { n: raw.bottomN, op: 'bottom_n' } : null);
  const asked = ctx.rank && (marked || ctx.alone) ? { ...(marked || {}), ...ctx.rank } : marked;
  const dims = ['selectedDimensions', 'groupBy', 'columnDimensions'].reduce((n, k) => n + (binding[k] || []).length, 0);
  if (raw.rankBy !== undefined && kindOf(raw.rankBy, effective) !== 'measure') {
    return { error: `rankBy must be a measure name of the schema, not ${JSON.stringify(String(raw.rankBy).slice(0, 80))}` };
  }
  if (asked && !rules.some((r) => RANKS.has(r.op))) {
    const rankable = !UNRANKED_TYPES.has(raw.type) && dims > 0 && (binding.selectedMeasures || []).length > 0;
    if (rankable) {
      const { rule, error } = ruleOf({ field: raw.rankBy || asked.by || binding.selectedMeasures[0], op: asked.op, values: [asked.n] }, effective);
      if (error) return { error };
      rules.push(rule);
    } else if (marked) {
      return { error: 'a top / bottom N needs a visual with a dimension and a measure (bar, table, pie…), not a single figure' };
    }
  }
  // The members of the previous answer's ranking, kept (see agent.previousRankIn).
  if (ctx.keepRank && ctx.alone && kindOf(ctx.keepRank.field, effective) === 'measure'
    && !UNRANKED_TYPES.has(raw.type) && dims > 0 && (binding.selectedMeasures || []).length > 0) {
    const kept = rules.filter((r) => !RANKS.has(r.op));
    const { rule } = ruleOf({ field: ctx.keepRank.field, op: ctx.keepRank.op, values: [ctx.keepRank.n] }, effective);
    rules.splice(0, rules.length, ...kept, rule);
  }
  if (rules.length) out.widgetFilters = rules;

  const tp = raw.timePeriod;
  if (tp && typeof tp === 'object') {
    if (kindOf(tp.dim, effective) !== 'date') return { error: 'timePeriod.dim must be a date dimension of the schema' };
    if (!TIME_PRESETS.includes(tp.preset)) return { error: `timePeriod.preset must be one of ${TIME_PRESETS.join(', ')}` };
    out.timePeriod = { dim: tp.dim, preset: tp.preset };
  }

  // A ranking reads in order: highest first for a top, lowest first for a bottom.
  const rank = rules.find((r) => RANKS.has(r.op));
  const sort = ['asc', 'desc'].includes(raw.sort) ? raw.sort : (rank ? (rank.op === 'top_n' ? 'desc' : 'asc') : null);
  if (sort && SORTED_TYPES.has(raw.type)) config.sortOrder = sort;

  const limit = Math.floor(Number(raw.limit));
  if (limit >= 1 && LIMITED_TYPES.has(raw.type)) config.dataLimit = Math.min(limit, MAX_ROWS);

  return { binding: out, config };
}

const isRanked = (widget) => ((widget.dataBinding && widget.dataBinding.widgetFilters) || []).some((r) => RANKS.has(r.op));

/** The saved shape back into tool arguments, for a widget that is validated again (POST /reports/:id/widgets). */
function shapingArgsOf(widget) {
  const b = (widget && widget.dataBinding) || {};
  const c = (widget && widget.config) || {};
  return {
    filters: (Array.isArray(b.widgetFilters) ? b.widgetFilters : []).map((r) => ({
      field: r && r.field,
      op: r && r.op,
      values: r && Array.isArray(r.values) && r.values.length ? r.values : [r && r.value],
    })),
    timePeriod: b.timePeriod,
    sort: c.sortOrder,
    limit: c.dataLimit,
  };
}

module.exports = { shapeWidget, shapingArgsOf, isRanked, TIME_PRESETS, ALL_OPS, MAX_RANK };
