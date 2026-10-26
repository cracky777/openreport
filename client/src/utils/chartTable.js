// The numbers behind a chart, as the chart draws them (Let's Talk's Table
// view). It used to ask again for the visual's plain dimension and measures:
// whatever the answer added to the chart — the year before, a variance, the
// line of a combo, a second measure — was missing from the table (Jonathan).
// Built from the chart's own data (widgetDataBuilder), never a second query.

import formatNumber from './formatNumber';

/**
 * @param {object} data  a widget's built data
 * @param {string} [dimName]  the name the answer gave the axis field (its axis title), over the model's label
 * @returns {{ columns: { label: string, numeric: boolean }[], rows: string[][] }|null}  null: a shape this does not read
 */
export function chartTable(data, dimName) {
  if (!data || typeof data !== 'object') return null;
  const formats = data._measureFormats || {};
  const fmtOf = (name) => formats[name] || formats[data._measureLabel] || null;
  const cell = (v, name) => (v == null || Number.isNaN(v) ? '' : typeof v === 'number' ? formatNumber(v, fmtOf(name)) : String(v));
  const dim = dimName || data._dimLabel || '';

  if (Array.isArray(data.labels) && (data.barSeries || data.lineSeries)) {
    const series = [...(data.barSeries || []), ...(data.lineSeries || [])];
    return {
      columns: [{ label: dim, numeric: false }, ...series.map((s) => ({ label: s.name, numeric: true }))],
      rows: data.labels.map((l, i) => [l, ...series.map((s) => cell(s.values[i], s.name))]),
    };
  }
  if (Array.isArray(data.labels) && Array.isArray(data.series)) {
    return {
      columns: [{ label: dim, numeric: false }, ...data.series.map((s) => ({ label: s.name, numeric: true }))],
      rows: data.labels.map((l, i) => [l, ...data.series.map((s) => cell(s.values[i], s.name))]),
    };
  }
  if (Array.isArray(data.labels) && Array.isArray(data.values)) {
    const name = data._measureLabel || '';
    return {
      columns: [{ label: dim, numeric: false }, { label: name, numeric: true }],
      rows: data.labels.map((l, i) => [l, cell(data.values[i], name)]),
    };
  }
  if (Array.isArray(data.items)) {
    const name = data._measureLabel || '';
    return {
      columns: [{ label: dim, numeric: false }, { label: name, numeric: true }],
      rows: data.items.map((it) => [it.name, cell(it.value, name)]),
    };
  }
  if (Array.isArray(data.xLabels) && Array.isArray(data.yLabels) && Array.isArray(data.cells)) {
    const at = new Map(data.cells.map(([x, y, v]) => [`${x}|${y}`, v]));
    return {
      columns: [{ label: '', numeric: false }, ...data.xLabels.map((x) => ({ label: x, numeric: true }))],
      rows: data.yLabels.map((y, yi) => [y, ...data.xLabels.map((_, xi) => cell(at.get(`${xi}|${yi}`), data._measureLabel))]),
    };
  }
  if (Array.isArray(data.points)) {
    const named = data.points.some((p) => p.label);
    return {
      columns: [
        ...(named ? [{ label: dim, numeric: false }] : []),
        { label: data._xLabel || 'X', numeric: true },
        { label: data._yLabel || 'Y', numeric: true },
        ...(data._hasSize ? [{ label: data._sizeLabel || 'Size', numeric: true }] : []),
      ],
      rows: data.points.map((p) => [
        ...(named ? [p.label || ''] : []),
        cell(p.x, data._xLabel), cell(p.y, data._yLabel),
        ...(data._hasSize ? [cell(p.size, data._sizeLabel)] : []),
      ]),
    };
  }
  return null;
}
