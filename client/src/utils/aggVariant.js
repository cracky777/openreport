import { AGG_OPTIONS } from './aggregations';

// ── Per-MEASURE aggregation variants ────────────────────────────────────
// A measure zone can carry several entries for the SAME measure, told apart
// by the aggregation each one asks for: "<base>@@agg:<fn>". That is how a
// visual shows the sum and the average of one column side by side, which one
// entry per measure made impossible.
//
// The aggregation travels IN the name rather than in a map on the side,
// because it is what makes two entries different — a map keyed by measure
// name could only ever hold one value for both. The server resolves each
// variant into a copy of the base measure carrying that aggregation.

export const AGG_SEP = '@@agg:';

const VALID = new Set(AGG_OPTIONS.map((o) => o.value));

export function parseAggVariant(name) {
  if (typeof name !== 'string') return null;
  const at = name.indexOf(AGG_SEP);
  if (at <= 0) return null;
  const agg = name.slice(at + AGG_SEP.length);
  if (!VALID.has(agg)) return null;
  return { base: name.slice(0, at), agg };
}

export function makeAggVariant(base, agg) {
  return `${base}${AGG_SEP}${agg}`;
}

/** The base measure a name refers to — itself when it is not a variant. */
export function baseMeasureName(name) {
  const v = parseAggVariant(name);
  return v ? v.base : name;
}

/**
 * A name for one more instance of `base` in `existing`, with an aggregation
 * that is not already there — so dropping the same measure twice gives the
 * user two different things rather than a duplicate of the same.
 */
export function nextAggVariant(base, existing, defaultAgg, options = AGG_OPTIONS) {
  const taken = new Set(
    (existing || [])
      .filter((n) => baseMeasureName(n) === base)
      .map((n) => parseAggVariant(n)?.agg || defaultAgg || 'sum')
  );
  const free = options.map((o) => o.value).find((a) => !taken.has(a));
  // Every aggregation already used: repeat the last one rather than refuse
  // the drop — the user can change it on the chip.
  return makeAggVariant(base, free || options[options.length - 1].value);
}

// ── A DIMENSION dropped where a measure goes ─────────────────────────────
// A column is not refused for being a dimension: it is read as a measure of
// itself, "<dim>@@agg:<fn>", the way Power BI aggregates a column put in
// Values. The server resolves the name against the dimensions when no measure
// carries it. Max is the default reading; a text column cannot be summed or
// averaged, so those two are offered on numbers only.
const NUMERIC_TYPES = /int|num|dec|float|double|real/i;
const TEXT_SAFE = new Set(['count', 'count_distinct', 'min', 'max']);
export const DIMENSION_DEFAULT_AGG = 'max';

export function aggOptionsForType(type) {
  return NUMERIC_TYPES.test(String(type || '')) ? AGG_OPTIONS : AGG_OPTIONS.filter((o) => TEXT_SAFE.has(o.value));
}

export function dimensionAsMeasure(base, existing, type) {
  const options = aggOptionsForType(type);
  const preferred = [
    ...options.filter((o) => o.value === DIMENSION_DEFAULT_AGG),
    ...options.filter((o) => o.value !== DIMENSION_DEFAULT_AGG),
  ];
  return nextAggVariant(base, existing, DIMENSION_DEFAULT_AGG, preferred);
}
