// Helpers for the scorecard "compare with N-1" feature.
//
// The user drops ANY date-related dim into the "Compare with" zone — it
// simply opts the widget into the comparison. The system then walks all
// the active filters (mergedFilters + widgetFilters) and shifts the year
// component of every date-shaped filter back by 1. Filters on month
// names, days, etc. stay untouched so we get "same period last year".

function shiftYearISO(s) {
  // Input "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM:SS..." — operate on the year
  // segment only so we don't fight time zones / DST.
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
  return (dimensions || []).find((d) => d?.name === name);
}

// "Year-like": dim that holds a 4-digit year. We recognise the canonical
// date-table flavour AND fall back to label/name keyword sniffing for
// raw integer columns named `year`/`annee`/`yr`/`anno` so out-of-the-box
// schemas don't need any datePart annotation to work.
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

// Computes the year-shifted value for a single filter value, returning
// null when no shift applies (the caller treats that as "leave as-is").
function shiftValue(value, dimDef) {
  if (value == null || value === '') return null;
  if (isYearLikeDim(dimDef)) return shiftYearInt(value);
  if (isFullDateDim(dimDef)) return shiftYearISO(value);
  return null;
}

// Build a new mergedFilters map with the year shifted on every entry
// whose dim is year-like or a full date. Entries on other dims (month
// names, etc.) are passed through unchanged so the N-1 query reads
// "same period, previous year".
export function shiftFiltersForN1(filters, dimensions) {
  if (!filters || typeof filters !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(filters)) {
    const dimDef = findDim(k, dimensions);
    if (Array.isArray(v) && v.length > 0 && (isYearLikeDim(dimDef) || isFullDateDim(dimDef))) {
      const next = v.map((x) => {
        const s = shiftValue(x, dimDef);
        return s == null ? x : s;
      });
      out[k] = next;
    } else {
      out[k] = v;
    }
  }
  return out;
}

// Same idea for the widgetFilters array shape (rich operators).
export function shiftWidgetFiltersForN1(widgetFilters, dimensions) {
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

// True when at least one filter (in mergedFilters or widgetFilters) is
// on a year-like or date dim. The N-1 query is meaningful only in that
// case; otherwise N-1 == N and we skip the parallel call.
export function hasShiftableFilterForN1(mergedFilters, widgetFilters, dimensions) {
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
