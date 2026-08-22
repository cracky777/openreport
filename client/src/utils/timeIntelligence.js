// Time-intelligence presets: a widget binding can carry
// `timePeriod = { dim, preset }` (dim = a full-date dimension of the model).
// At fetch time the preset resolves to a concrete [from, to] window sent as
// a plain `between` widget filter — so the live SQL path and the rollup
// planner both handle it with machinery that already exists, and the window
// slides forward on its own as `now` advances (no stored dates to go stale).
//
// Comparison (scorecard N-1): calendar presets compare year-over-year (the
// same window shifted one year back — consistent with the existing N-1
// behaviour on year filters); rolling day-windows compare to the window
// immediately before them (same length), where a year shift would land on
// misaligned weekdays.

export const TIME_PRESETS = [
  { key: 'ytd', label: 'Year to date' },
  { key: 'qtd', label: 'Quarter to date' },
  { key: 'mtd', label: 'Month to date' },
  { key: 'last_7_days', label: 'Last 7 days' },
  { key: 'last_30_days', label: 'Last 30 days' },
  { key: 'last_90_days', label: 'Last 90 days' },
  { key: 'last_12_months', label: 'Last 12 months' },
  { key: 'prev_month', label: 'Previous month' },
  { key: 'prev_quarter', label: 'Previous quarter' },
  { key: 'prev_year', label: 'Previous year' },
];

const PRESET_KEYS = new Set(TIME_PRESETS.map((p) => p.key));

// Rolling windows counted in days — their comparable period is the window
// immediately preceding them, not a year shift.
const ROLLING_DAYS = { last_7_days: 7, last_30_days: 30, last_90_days: 90 };

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// Build a date from parts, clamping the day to the target month's length
// (Jan 31 − 1 month must be Feb 28/29, not an overflow into March).
const mkDate = (y, m, day) => {
  const lastDay = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(day, lastDay));
};
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const addYears = (d, n) => mkDate(d.getFullYear() + n, d.getMonth(), d.getDate());

/** Resolve a preset to its [fromISO, toISO] window, or null for unknown keys. */
export function presetRange(preset, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const y = today.getFullYear();
  const q0 = Math.floor(today.getMonth() / 3) * 3; // first month of current quarter
  switch (preset) {
    case 'ytd':
      return [iso(new Date(y, 0, 1)), iso(today)];
    case 'qtd':
      return [iso(new Date(y, q0, 1)), iso(today)];
    case 'mtd':
      return [iso(new Date(y, today.getMonth(), 1)), iso(today)];
    case 'last_7_days':
    case 'last_30_days':
    case 'last_90_days':
      return [iso(addDays(today, -(ROLLING_DAYS[preset] - 1))), iso(today)];
    case 'last_12_months':
      return [iso(addDays(addYears(today, -1), 1)), iso(today)];
    case 'prev_month': {
      const first = mkDate(y, today.getMonth() - 1, 1);
      return [iso(first), iso(new Date(first.getFullYear(), first.getMonth() + 1, 0))];
    }
    case 'prev_quarter': {
      const first = mkDate(y, q0 - 3, 1);
      return [iso(first), iso(new Date(first.getFullYear(), first.getMonth() + 3, 0))];
    }
    case 'prev_year':
      return [iso(new Date(y - 1, 0, 1)), iso(new Date(y - 1, 11, 31))];
    default:
      return null;
  }
}

/** The previous comparable window for a preset (see the header comment). */
export function comparableRange(preset, now = new Date()) {
  const range = presetRange(preset, now);
  if (!range) return null;
  const parse = (s) => {
    const [yy, mm, dd] = s.split('-').map(Number);
    return new Date(yy, mm - 1, dd);
  };
  const [from, to] = range.map(parse);
  const days = ROLLING_DAYS[preset];
  if (days) {
    return [iso(addDays(from, -days)), iso(addDays(from, -1))];
  }
  if (preset === 'last_12_months') {
    return [iso(addYears(from, -1)), iso(addDays(from, -1))];
  }
  return [iso(addYears(from, -1)), iso(addYears(to, -1))];
}

/** Validated {dim, preset} from a widget binding, or null. */
export function timePeriodOf(binding) {
  const tp = binding && binding.timePeriod;
  if (!tp || typeof tp !== 'object') return null;
  if (typeof tp.dim !== 'string' || !tp.dim) return null;
  if (!PRESET_KEYS.has(tp.preset)) return null;
  return { dim: tp.dim, preset: tp.preset };
}

/**
 * The synthetic widget filter carrying the preset's window. `value` AND
 * `values` both hold the pair: sanitizeWidgetFilters validates `values`
 * for `between`, while comparePeriod's N-1 shift and the server's scalar
 * clause read either.
 */
export function timePeriodFilter(binding, now = new Date()) {
  const tp = timePeriodOf(binding);
  if (!tp) return null;
  const range = presetRange(tp.preset, now);
  if (!range) return null;
  return { field: tp.dim, op: 'between', value: range, values: range, _timePeriod: true };
}

// ── Per-MEASURE time variants ───────────────────────────────────────────
// A measure zone can carry synthetic entries "<base>@@tp:<preset>" — the
// same base measure restricted to the preset's window, so "Sales" and
// "Sales (YTD)" sit side by side in one visual. The server receives the
// resolved window through the query body's `timeVariants` map and compiles
// the variant as a filtered measure (CASE WHEN window). The date dim is
// the model's business date column (Date table), falling back to the
// model's only date dim.

export const TP_SEP = '@@tp:';

export function parseTimeVariant(name) {
  if (typeof name !== 'string') return null;
  const at = name.indexOf(TP_SEP);
  if (at <= 0) return null;
  const preset = name.slice(at + TP_SEP.length);
  if (!PRESET_KEYS.has(preset)) return null;
  return { base: name.slice(0, at), preset };
}

export function makeTimeVariant(base, preset) {
  return `${base}${TP_SEP}${preset}`;
}

// Short suffixes for chip badges / column labels — the full preset label
// would drown a table header.
export const TP_SHORT = {
  ytd: 'YTD', qtd: 'QTD', mtd: 'MTD',
  last_7_days: '7d', last_30_days: '30d', last_90_days: '90d',
  last_12_months: '12m',
  prev_month: 'M-1', prev_quarter: 'Q-1', prev_year: 'Y-1',
};

export function variantLabel(baseLabel, preset) {
  return `${baseLabel} (${TP_SHORT[preset] || preset})`;
}

/** The date dim variants bind to: the model's date column, else its only
 *  date-typed dim, else null (variants unavailable). */
export function variantDateDim(model) {
  if (!model) return null;
  const effType = (d) => {
    const ov = model.column_types && model.column_types[`${d.table}.${d.column}`];
    return !ov ? d.type : (typeof ov === 'string' ? ov : ov.type);
  };
  const dims = (model.dimensions || []).filter((d) => d && effType(d) === 'date');
  if (model.dateColumn && dims.some((d) => d.name === model.dateColumn)) return model.dateColumn;
  return dims.length === 1 ? dims[0].name : null;
}

/** Synthesize the client-side defs for every variant name found in widget
 *  bindings — appended to effectiveModel.measures so field pickers, data
 *  builders and payloads resolve them like normal measures. */
export function variantDefsFor(names, measures) {
  const out = [];
  const byName = new Map((measures || []).map((m) => [m.name, m]));
  for (const n of names || []) {
    const v = parseTimeVariant(n);
    if (!v || byName.has(n)) continue;
    const base = byName.get(v.base);
    if (!base) continue;
    out.push({
      ...base,
      name: n,
      label: variantLabel(base.label || v.base, v.preset),
      _timeVariant: true,
    });
  }
  return out;
}

/**
 * Resolve the variant entries of a measure list into the query payload's
 * `timeVariants` map. Unresolvable variants (no usable date dim, unknown
 * base) are dropped from the returned names so the server never 400s on
 * a phantom measure.
 */
export function buildTimeVariants(measureNames, model, now = new Date()) {
  const variants = (measureNames || []).map(parseTimeVariant);
  if (!variants.some(Boolean)) return { names: measureNames, timeVariants: null };
  const dim = variantDateDim(model);
  const byName = new Map((model?.measures || []).map((m) => [m.name, m]));
  const names = [];
  const map = {};
  (measureNames || []).forEach((n, i) => {
    const v = variants[i];
    if (!v) { names.push(n); return; }
    const base = byName.get(v.base);
    const range = presetRange(v.preset, now);
    if (!dim || !base || !range) return; // dropped — unservable variant
    names.push(n);
    map[n] = { dim, range, label: variantLabel(base.label || v.base, v.preset) };
  });
  return { names, timeVariants: Object.keys(map).length > 0 ? map : null };
}
