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
export function nextAggVariant(base, existing, defaultAgg) {
  const taken = new Set(
    (existing || [])
      .filter((n) => baseMeasureName(n) === base)
      .map((n) => parseAggVariant(n)?.agg || defaultAgg || 'sum')
  );
  const free = AGG_OPTIONS.map((o) => o.value).find((a) => !taken.has(a));
  // Every aggregation already used: repeat the last one rather than refuse
  // the drop — the user can change it on the chip.
  return makeAggVariant(base, free || AGG_OPTIONS[AGG_OPTIONS.length - 1].value);
}
