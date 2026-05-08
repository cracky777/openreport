/**
 * Server-side mirror of `client/src/utils/comparePeriod.js`.
 *
 * The N-1 (year-1) comparison the scorecard fires at runtime ends up
 * with a different `widgetFilters` array (year shifted) than the main
 * query — and therefore a different pre-agg cache key. To make N-1
 * cache hits work, the warmer needs to fire that second variant too,
 * which means it needs to know HOW to shift the year on the same
 * filter shapes the client uses.
 *
 * Keep these in sync with the client copy. They're pure functions and
 * the cost of duplication is low compared to wiring shared code across
 * the client/server bundle boundary.
 */

function shiftYearISO(s) {
  const m = String(s).match(/^(-?\d{1,6})(.*)$/);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  if (!Number.isFinite(year)) return null;
  return `${year - 1}${m[2]}`;
}

function shiftYearInt(v) {
  const n = parseInt(String(v), 10);
  if (!Number.isFinite(n)) return null;
  return String(n - 1);
}

function findDim(name, dimensions) {
  return (dimensions || []).find((d) => d && d.name === name);
}

function isYearLikeDim(dimDef) {
  if (!dimDef) return false;
  if (dimDef.datePart === 'num_year') return true;
  if (dimDef.type === 'integer' || dimDef.type === 'number') {
    const hay = `${dimDef.label || ''} ${dimDef.name || ''} ${dimDef.column || ''}`.toLowerCase();
    if (/(^|[^a-z])(year|annee|année|anio|anno|yr|jahr)([^a-z]|$)/.test(hay)) return true;
  }
  return false;
}

function isFullDateDim(dimDef) {
  if (!dimDef) return false;
  return dimDef.type === 'date' || dimDef.datePart === 'full_date';
}

function shiftValue(value, dimDef) {
  if (value == null || value === '') return null;
  if (isYearLikeDim(dimDef)) return shiftYearInt(value);
  if (isFullDateDim(dimDef)) return shiftYearISO(value);
  return null;
}

function shiftFiltersForN1(filters, dimensions) {
  if (!filters || typeof filters !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(filters)) {
    const dimDef = findDim(k, dimensions);
    if (Array.isArray(v) && v.length > 0 && (isYearLikeDim(dimDef) || isFullDateDim(dimDef))) {
      out[k] = v.map((x) => {
        const s = shiftValue(x, dimDef);
        return s == null ? x : s;
      });
    } else {
      out[k] = v;
    }
  }
  return out;
}

function shiftWidgetFiltersForN1(widgetFilters, dimensions) {
  if (!Array.isArray(widgetFilters) || widgetFilters.length === 0) return widgetFilters;
  return widgetFilters.map((f) => {
    if (!f) return f;
    const dimDef = findDim(f.field, dimensions);
    if (!isYearLikeDim(dimDef) && !isFullDateDim(dimDef)) return f;
    if (Array.isArray(f.values)) {
      const nextValues = f.values.map((v) => {
        const s = shiftValue(v, dimDef);
        return s == null ? v : s;
      });
      return { ...f, values: nextValues };
    }
    if (f.value != null) {
      const s = shiftValue(f.value, dimDef);
      if (s == null) return f;
      return { ...f, value: s };
    }
    return f;
  });
}

function hasShiftableFilterForN1(mergedFilters, widgetFilters, dimensions) {
  if (mergedFilters && typeof mergedFilters === 'object') {
    for (const [k, v] of Object.entries(mergedFilters)) {
      if (!Array.isArray(v) || v.length === 0) continue;
      const dimDef = findDim(k, dimensions);
      if (isYearLikeDim(dimDef) || isFullDateDim(dimDef)) return true;
    }
  }
  if (Array.isArray(widgetFilters)) {
    for (const f of widgetFilters) {
      if (!f) continue;
      const dimDef = findDim(f.field, dimensions);
      if (!isYearLikeDim(dimDef) && !isFullDateDim(dimDef)) continue;
      const samples = Array.isArray(f.values) ? f.values : (f.value != null ? [f.value] : []);
      if (samples.length > 0) return true;
    }
  }
  return false;
}

module.exports = {
  shiftFiltersForN1,
  shiftWidgetFiltersForN1,
  hasShiftableFilterForN1,
  isYearLikeDim,
  isFullDateDim,
};
