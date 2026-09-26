// Client side of period-shifted measures (`periodShift = { dim, unit, n }` on
// a model measure — see server/utils/sqlBuilder/periodShift.js).
//
// The server computes such a measure in the visual's own query: it widens the
// moved date filters to both periods and gives each measure a CASE WHEN on its
// own period. That works as long as no displayed dimension tells the two
// periods apart. When a date-derived dimension of the shift's table is on the
// axis (the date itself, a year), a row of last year cannot land on this
// year's axis value inside one GROUP BY. The widget then fires a second query
// for the shifted measures with the whole filter context moved and
// `ignorePeriodShift` set, and the rows come back realigned here: each moved
// axis value is shifted forward again and joined onto the main rows.
//
// Keep the value shifting in step with the server copy.

import { isYearLikeDim, isFullDateDim } from './comparePeriod';

export const PERIOD_UNITS = [
  { value: 'year', label: 'Previous year' },
  { value: 'quarter', label: 'Previous quarter' },
  { value: 'month', label: 'Previous month' },
  { value: 'day', label: 'Previous day' },
];
const UNIT_SET = new Set(PERIOD_UNITS.map((u) => u.value));

export function periodShiftOf(measure) {
  const ps = measure && measure.periodShift;
  if (!ps || typeof ps !== 'object') return null;
  if (typeof ps.dim !== 'string' || !ps.dim) return null;
  if (!UNIT_SET.has(ps.unit)) return null;
  const n = Number(ps.n);
  if (!Number.isInteger(n) || n === 0 || Math.abs(n) > 120) return null;
  return { dim: ps.dim, unit: ps.unit, n };
}

const pad = (v, w) => String(v).padStart(w, '0');

export function shiftIsoDate(value, unit, n) {
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

export function isShiftableDim(dimDef, shiftDimDef) {
  if (!dimDef || !shiftDimDef || !dimDef.table || dimDef.table !== shiftDimDef.table) return false;
  return isFullDateDim(dimDef) || isYearLikeDim(dimDef);
}

export function shiftDimValue(value, dimDef, unit, n) {
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

const shiftList = (list, dimDef, unit, n) => {
  const out = list.map((v) => shiftDimValue(v, dimDef, unit, n));
  return out.every((v) => v != null) ? out : null;
};

/**
 * Which requested measures need the second query: the shifted ones whose
 * shift dimension shares its table with a displayed date-derived dimension.
 * → { main: names for the visual's query, groups: [{ key, dim, unit, n, measures }] }
 */
export function splitPeriodMeasures(measureNames, dimNames, model) {
  const dims = model?.dimensions || [];
  const byName = new Map((model?.measures || []).map((m) => [m.name, m]));
  const dimDef = (name) => dims.find((d) => d && d.name === name);
  const main = [];
  const groups = new Map();
  for (const name of measureNames || []) {
    const ps = periodShiftOf(byName.get(name));
    const shiftDim = ps && dimDef(ps.dim);
    const onAxis = !!shiftDim && isFullDateDim(shiftDim)
      && (dimNames || []).some((dn) => isShiftableDim(dimDef(dn), shiftDim));
    if (!onAxis) { main.push(name); continue; }
    const key = `${ps.dim}|${ps.unit}|${ps.n}`;
    if (!groups.has(key)) groups.set(key, { key, dim: ps.dim, unit: ps.unit, n: ps.n, measures: [] });
    groups.get(key).measures.push(name);
  }
  return { main, groups: [...groups.values()] };
}

/** The filter context moved by one shift: the `filters` map (value lists and
 *  between ranges) and the widget rules on the shift table's date dims. */
export function shiftFilterContext(filters, widgetFilters, dimensions, shift) {
  const dims = dimensions || [];
  const shiftDim = dims.find((d) => d && d.name === shift.dim);
  const dimOf = (name) => dims.find((d) => d && d.name === name);
  const outFilters = {};
  for (const [k, raw] of Object.entries(filters || {})) {
    const d = dimOf(k);
    if (!d || !isShiftableDim(d, shiftDim)) { outFilters[k] = raw; continue; }
    if (Array.isArray(raw)) {
      outFilters[k] = (raw.length && shiftList(raw, d, shift.unit, shift.n)) || raw;
    } else if (raw && typeof raw === 'object' && raw.op === 'between' && Array.isArray(raw.value)) {
      const value = shiftList(raw.value, d, shift.unit, shift.n);
      outFilters[k] = value ? { ...raw, value } : raw;
    } else {
      outFilters[k] = raw;
    }
  }
  const outWidget = (Array.isArray(widgetFilters) ? widgetFilters : []).map((f) => {
    if (!f || f.isMeasure) return f;
    const d = dimOf(f.field);
    if (!d || !isShiftableDim(d, shiftDim)) return f;
    if (Array.isArray(f.values) && f.values.length > 0) {
      const values = shiftList(f.values, d, shift.unit, shift.n);
      if (!values) return f;
      return { ...f, values, ...(Array.isArray(f.value) ? { value: values } : {}) };
    }
    if (Array.isArray(f.value) && f.value.length > 0) {
      const value = shiftList(f.value, d, shift.unit, shift.n);
      return value ? { ...f, value, values: value } : f;
    }
    if (f.value != null && f.value !== '') {
      const value = shiftDimValue(f.value, d, shift.unit, shift.n);
      return value == null ? f : { ...f, value };
    }
    return f;
  });
  return { filters: outFilters, widgetFilters: outWidget };
}

/**
 * The main rows with the shifted measures filled from the moved queries'
 * rows: each moved row is realigned (its date-derived axis values shifted
 * forward again) and joined on every displayed dimension. A main row without
 * a counterpart gets null, so the column exists on every row.
 */
export function mergePeriodRows(rows, periodRes, meta, effectiveModel) {
  const groups = meta?.periodGroups;
  if (!Array.isArray(groups) || groups.length === 0 || !Array.isArray(rows) || rows.length === 0) return rows;
  const dims = effectiveModel?.dimensions || [];
  const measures = effectiveModel?.measures || [];
  const labelOf = (list, name) => {
    const x = list.find((e) => e && e.name === name);
    return x ? (x.label || x.name) : name;
  };
  const dimNames = meta.allDims || [];
  const dimLabels = dimNames.map((n) => labelOf(dims, n));
  const keyOf = (r) => JSON.stringify(dimLabels.map((l) => String(r[l] ?? '')));
  let out = rows;
  groups.forEach((g, i) => {
    const shifted = periodRes && periodRes[i] && periodRes[i].data && periodRes[i].data.rows;
    const measureLabels = g.measures.map((n) => labelOf(measures, n));
    if (!Array.isArray(shifted)) {
      out = out.map((r) => { const c = { ...r }; for (const l of measureLabels) c[l] = null; return c; });
      return;
    }
    const shiftDim = dims.find((d) => d && d.name === g.dim);
    const realign = (r) => {
      const c = { ...r };
      dimNames.forEach((n, j) => {
        const d = dims.find((x) => x && x.name === n);
        if (!d || !isShiftableDim(d, shiftDim)) return;
        const v = shiftDimValue(r[dimLabels[j]], d, g.unit, -g.n);
        if (v != null) c[dimLabels[j]] = v;
      });
      return c;
    };
    const byKey = new Map(shifted.map(realign).map((r) => [keyOf(r), r]));
    out = out.map((r) => {
      const s = byKey.get(keyOf(r));
      const c = { ...r };
      for (const l of measureLabels) c[l] = s && s[l] !== undefined ? s[l] : null;
      return c;
    });
  });
  return out;
}
