// A measure evaluated over the report's date selection moved back in time
// (Power BI's SAMEPERIODLASTYEAR / DATEADD): `periodShift = { dim, unit, n }`
// on a measure, `dim` a full-date dimension of the model.
//
// The date filters of the query live in the WHERE, which already excludes
// the shifted period; a CASE WHEN on the measure alone would see nothing.
// The query handler therefore widens every moved date filter to the union of
// its readings — `(d BETWEEN this year OR d BETWEEN last year)` — and gives
// each measure a period rule: the shifted measures their moved reading, every
// other measure the original one, so a row counts only for the period it
// belongs to. This module holds the pure parts: what a shift is, which
// filters move, how their values move. Never served by the rollup cache.
//
// The client mirror (client/src/utils/periodShift.js) shifts the same filter
// shapes for the second query it fires when a date-derived dimension is on
// the axis (that case cannot align the two periods on one GROUP BY).

const { isYearLikeDim, isFullDateDim } = require('../comparePeriod');

const UNITS = ['year', 'quarter', 'month', 'day'];
const UNIT_SET = new Set(UNITS);

// The validated shift of a measure, or null. Only literal shapes pass: the
// dim is looked up by name in the model, the unit is an enum, n an integer.
function periodShiftOf(measure) {
  const ps = measure && measure.periodShift;
  if (!ps || typeof ps !== 'object') return null;
  if (typeof ps.dim !== 'string' || !ps.dim) return null;
  if (!UNIT_SET.has(ps.unit)) return null;
  const n = Number(ps.n);
  if (!Number.isInteger(n) || n === 0 || Math.abs(n) > 120) return null;
  return { dim: ps.dim, unit: ps.unit, n };
}

const pad = (v, w) => String(v).padStart(w, '0');

// "YYYY-MM-DD" with any suffix (time, zone) moved by n units; the suffix is
// kept as is. The day clamps to the target month (Jan 31 − 1 month = Feb 28,
// Feb 29 − 1 year = Feb 28). Null when the value is not an ISO date.
function shiftIsoDate(value, unit, n) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(.*)$/.exec(String(value == null ? '' : value));
  if (!m) return null;
  let y = Number(m[1]);
  let mo = Number(m[2]);
  let d = Number(m[3]);
  if (unit === 'day') {
    const dt = new Date(Date.UTC(y, mo - 1, d + n));
    y = dt.getUTCFullYear(); mo = dt.getUTCMonth() + 1; d = dt.getUTCDate();
  } else {
    const months = unit === 'year' ? 12 * n : unit === 'quarter' ? 3 * n : n;
    const total = y * 12 + (mo - 1) + months;
    y = Math.floor(total / 12);
    mo = total - y * 12 + 1;
    d = Math.min(d, new Date(Date.UTC(y, mo, 0)).getUTCDate());
  }
  return `${pad(y, 4)}-${pad(mo, 2)}-${pad(d, 2)}${m[4]}`;
}

// A filter on this dimension follows the shift: the shift dimension itself,
// or a date-shaped dimension of the same table (the year of a Date table, a
// year column next to the date). Other tables keep their filters — a year
// column on the fact is not the date context Power BI moves.
function isShiftableDim(dimDef, shiftDimDef) {
  if (!dimDef || !shiftDimDef || !dimDef.table || dimDef.table !== shiftDimDef.table) return false;
  return isFullDateDim(dimDef) || isYearLikeDim(dimDef);
}

// One filter value moved by the shift, or null when the dimension cannot
// carry that move (a year number moved by a month stays where it is).
function shiftDimValue(value, dimDef, unit, n) {
  if (value == null || value === '') return null;
  if (isFullDateDim(dimDef)) return shiftIsoDate(value, unit, n);
  if (isYearLikeDim(dimDef)) {
    if (unit !== 'year') return null;
    const y = parseInt(String(value), 10);
    if (!Number.isFinite(y)) return null;
    return typeof value === 'number' ? y + n : String(y + n);
  }
  return null;
}

const shiftAll = (list, dimDef, unit, n) => {
  const out = list.map((v) => shiftDimValue(v, dimDef, unit, n));
  return out.every((v) => v != null) ? out : null;
};

// The `filters` map entry (a value list, or `{ op: 'between', value: [a, b] }`)
// moved by the shift, or null when nothing moves.
function shiftRawFilter(raw, dimDef, unit, n) {
  if (Array.isArray(raw)) {
    if (raw.length === 0) return null;
    return shiftAll(raw, dimDef, unit, n);
  }
  if (raw && typeof raw === 'object' && raw.op === 'between' && Array.isArray(raw.value) && raw.value.length === 2) {
    const value = shiftAll(raw.value, dimDef, unit, n);
    return value ? { ...raw, value } : null;
  }
  return null;
}

// A widget filter rule moved by the shift, or null when nothing moves.
// `between` carries its pair in `value` and `values`: both move together.
function shiftRule(rule, dimDef, unit, n) {
  if (!rule || rule.isMeasure) return null;
  if (Array.isArray(rule.values) && rule.values.length > 0) {
    const values = shiftAll(rule.values, dimDef, unit, n);
    if (!values) return null;
    return { ...rule, values, ...(Array.isArray(rule.value) ? { value: values } : {}) };
  }
  if (Array.isArray(rule.value) && rule.value.length > 0) {
    const value = shiftAll(rule.value, dimDef, unit, n);
    return value ? { ...rule, value, values: value } : null;
  }
  if (rule.value != null && rule.value !== '') {
    const value = shiftDimValue(rule.value, dimDef, unit, n);
    return value == null ? null : { ...rule, value };
  }
  return null;
}

// The distinct shifts a query needs: those of the requested measures and of
// every measure they reference through `${…}`. Each shift is keyed by
// (dim, unit, n) and names the measures it applies to; shifts whose dim is
// not a full-date dimension of the model are ignored (the measure then
// reads as its base).
function reachablePeriodShifts(measureNames, allMeasures, allDimensions) {
  const byName = new Map((allMeasures || []).map((m) => [m && m.name, m]));
  const byLabel = new Map((allMeasures || []).map((m) => [m && m.label, m]));
  const shifts = new Map();
  const seen = new Set();
  const visit = (m) => {
    if (!m || seen.has(m.name)) return;
    seen.add(m.name);
    const ps = periodShiftOf(m);
    if (ps) {
      const dimDef = (allDimensions || []).find((d) => d && d.name === ps.dim);
      if (dimDef && isFullDateDim(dimDef)) {
        const key = `${ps.dim}|${ps.unit}|${ps.n}`;
        if (!shifts.has(key)) shifts.set(key, { key, ...ps, dimDef, measures: new Set() });
        shifts.get(key).measures.add(m.name);
      }
    }
    if (m.aggregation === 'custom' && typeof m.expression === 'string') {
      for (const ref of m.expression.matchAll(/\$\{\s*([^}]+?)\s*\}/g)) {
        visit(byName.get(ref[1]) || byLabel.get(ref[1]));
      }
    }
  };
  for (const name of measureNames || []) visit(byName.get(name));
  return [...shifts.values()];
}

// Whether any active filter moves under one of the shifts — the query then
// carries two periods and cannot come from the rollup cache.
function hasMovingFilter(filters, widgetFilters, allDimensions, shifts) {
  if (!shifts || shifts.length === 0) return false;
  const dimOf = (name) => (allDimensions || []).find((d) => d && d.name === name);
  const moves = (dimDef, fn) => shifts.some((s) => isShiftableDim(dimDef, s.dimDef) && fn(s) != null);
  if (filters && typeof filters === 'object') {
    for (const [name, raw] of Object.entries(filters)) {
      const dimDef = dimOf(name);
      if (dimDef && moves(dimDef, (s) => shiftRawFilter(raw, dimDef, s.unit, s.n))) return true;
    }
  }
  for (const f of Array.isArray(widgetFilters) ? widgetFilters : []) {
    if (!f || f.isMeasure || !f.field) continue;
    const dimDef = dimOf(f.field);
    if (dimDef && moves(dimDef, (s) => shiftRule(f, dimDef, s.unit, s.n))) return true;
  }
  return false;
}

module.exports = {
  UNITS,
  periodShiftOf,
  shiftIsoDate,
  isShiftableDim,
  shiftDimValue,
  shiftRawFilter,
  shiftRule,
  reachablePeriodShifts,
  hasMovingFilter,
};
