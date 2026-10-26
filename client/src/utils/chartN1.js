// The previous year on a chart: a line or a bar whose binding names a
// `compareDateDim` (the scorecard's N-1, asked by Jonathan for "2025 compared
// with 2024": a curve of the year and one of the year before, on the same
// months — not the two years one after the other on a 24-month axis).
//
// The widget fires a second query with every year / date filter moved back a
// year (comparePeriod.shiftFiltersForN1, the scorecard's), then each of its
// rows is moved forward a year on the axis — a date, a year, a "YYYY-MM"
// month — and joined onto the row it sits beside: "2024-03" lands on
// "2025-03". Its measures come back as "<label> N-1" columns, which the bar /
// line build draws as series of their own. Without a legend only: a second
// dimension in colors would double every series.
//
// On a combo (Jonathan: "add columns with the change in %" to a curve of the
// year against the year before), each side keeps its measures: the lines get
// their year before beside them, dashed; the bars get theirs too, paler, or —
// with compareMode difference | change — become the variance / the change, on
// their own axis. Curve + its N-1 + bars of the change = one visual.
//
// `compareMode` says what is drawn: the year before beside this year
// ('series', the default), the variance this year − the year before
// ('difference') or the change in % ('change'), computed here from the aligned
// rows — a variance measure built on a shifted measure cannot be aligned by
// the server on a month axis (its year-before rows group under last year's months).

import { isYearLikeDim, isFullDateDim } from './comparePeriod';
import { shiftIsoDate } from './periodShift';

const CHART_TYPES = new Set(['line', 'bar', 'combo']);
const YEAR_MONTH = /^(\d{4})-(\d{2})$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

export const n1Label = (label) => `${label} N-1`;
export const COMPARE_MODES = ['series', 'difference', 'change'];
const CHANGE_FORMAT = { decimals: 1, thousandSep: ' ', prefix: '', suffix: ' %' };

/**
 * What the chart draws for each measure, from rows merged by mergeN1Rows.
 * @param {object[]} measures  the measures' definitions (label, format)
 * @returns {{ rows: object[], series: object[] }} series: the measure definitions to draw, in order
 */
export function comparedSeries(rows, measures, mode = 'series') {
  if (mode !== 'difference' && mode !== 'change') {
    return { rows, series: [...measures, ...measures.map((m) => ({ ...m, label: n1Label(m.label), _n1Of: m.label }))] };
  }
  // A rate set against the year before moves by points, not by its own unit.
  const isRate = (m) => /%/.test(String(m.format?.suffix || ''));
  const series = measures.map((m) => ({
    ...m,
    label: mode === 'change' ? `${m.label} % vs N-1` : `${m.label} vs N-1`,
    ...(mode === 'change' ? { format: CHANGE_FORMAT } : isRate(m) ? { format: { ...m.format, suffix: ' pts' } } : {}),
  }));
  const value = (now, before) => {
    if (now == null || before == null || !Number.isFinite(Number(now)) || !Number.isFinite(Number(before))) return null;
    if (mode === 'difference') return Number(now) - Number(before);
    return Number(before) === 0 ? null : (100 * (Number(now) - Number(before))) / Math.abs(Number(before));
  };
  const out = rows.map((r) => {
    const c = { ...r };
    measures.forEach((m, i) => {
      c[series[i].label] = value(r[m.label], r[n1Label(m.label)]);
      delete c[m.label];
      delete c[n1Label(m.label)];
    });
    return c;
  });
  return { rows: out, series };
}

/**
 * A combo's two sides, from rows merged by mergeN1Rows: the lines with their
 * year before, the bars with theirs or as the variance / change (compareMode).
 * Columns are added, never removed: a measure may sit on both sides.
 * @returns {{ rows: object[], bars: object[], lines: object[] }} the measure definitions each side draws
 */
export function comboN1(rows, bars, lines, mode = 'series') {
  const lineSide = comparedSeries([], lines).series;
  if (mode !== 'difference' && mode !== 'change') return { rows, bars: comparedSeries([], bars).series, lines: lineSide };
  const compared = comparedSeries(rows, bars, mode);
  const out = rows.map((r, i) => {
    const c = { ...r };
    for (const m of compared.series) c[m.label] = compared.rows[i][m.label];
    return c;
  });
  return { rows: out, bars: compared.series, lines: lineSide };
}

export function chartN1Applies(widget) {
  const b = widget?.dataBinding || {};
  return CHART_TYPES.has(widget?.type) && !!b.compareDateDim && !(b.groupBy || []).length;
}

// How a column's values move forward a year: by its definition, or — for a
// text column — by the shape of every value it holds ("2024-03", "2024-03-15").
function forwardOf(def, values) {
  if (isYearLikeDim(def)) {
    return (v) => {
      const y = parseInt(String(v), 10);
      return Number.isFinite(y) ? (typeof v === 'number' ? y + 1 : String(y + 1)) : v;
    };
  }
  const filled = values.filter((v) => v != null && v !== '').map(String);
  const all = (re) => filled.length > 0 && filled.every((v) => re.test(v));
  if (isFullDateDim(def) || all(ISO_DATE)) return (v) => (v == null || v === '' ? v : shiftIsoDate(v, 'year', 1) ?? v);
  if (def?.datePart === 'year_month' || all(YEAR_MONTH)) {
    return (v) => {
      const m = YEAR_MONTH.exec(String(v ?? ''));
      return m ? `${Number(m[1]) + 1}-${m[2]}` : v;
    };
  }
  return null;
}

/**
 * The rows with a "<label> N-1" column per measure, from the year before.
 * @param {object[]} rows      this period's rows, keyed by label
 * @param {object[]} n1Rows    the same query on the year before
 * @param {{label: string, def: object}[]} dims  the displayed dimensions
 * @param {string[]} measureLabels
 */
export function mergeN1Rows(rows, n1Rows, dims, measureLabels) {
  if (!Array.isArray(rows) || !rows.length) return rows;
  const moves = dims.map(({ label, def }) => forwardOf(def, (n1Rows || []).map((r) => r[label])));
  const keyOf = (r, moved) => JSON.stringify(dims.map(({ label }, i) => {
    const v = r[label];
    return String((moved && moves[i] ? moves[i](v) : v) ?? '');
  }));
  const before = new Map((n1Rows || []).map((r) => [keyOf(r, true), r]));
  return rows.map((r) => {
    const prev = before.get(keyOf(r, false));
    const out = { ...r };
    for (const l of measureLabels) out[n1Label(l)] = prev && prev[l] !== undefined ? prev[l] : null;
    return out;
  });
}
