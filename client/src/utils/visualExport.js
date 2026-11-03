// The numbers of one visual of Let's Talk, for its CSV / Excel export: what the
// chart draws (the year before, a combo's line, a variance included), as raw
// values — the table view (chartTable) formats them for the eye, a spreadsheet
// wants numbers it can sum.

/**
 * @param {object} data  a widget's built data (widgetDataBuilder)
 * @param {string} [dimName]  the name the answer gave the axis field
 * @returns {Array<Array<string|number|null>>|null}  header row then rows; null: nothing to export
 */
export function sheetOf(data, dimName) {
  if (!data || typeof data !== 'object') return null;
  const dim = dimName || data._dimLabel || 'Label';
  const measure = data._measureLabel || 'Value';
  const byLabel = (series) => [
    [dim, ...series.map((s) => s.name)],
    ...data.labels.map((l, i) => [l, ...series.map((s) => s.values[i] ?? null)]),
  ];

  if (Array.isArray(data.columns) && Array.isArray(data.rows)) return [data.columns, ...data.rows];
  if (Array.isArray(data.rawRows)) {
    // A pivot's rows also carry the SUM/COUNT atoms behind its average totals.
    const hidden = new Set(Object.values(data._totalComponents || {}).flatMap((c) => [c.sum, c.count]));
    const keys = Object.keys(data.rawRows[0] || {}).filter((k) => !hidden.has(k));
    return [keys, ...data.rawRows.map((r) => keys.map((k) => r[k] ?? null))];
  }
  if (Array.isArray(data.labels) && (data.barSeries || data.lineSeries)) return byLabel([...(data.barSeries || []), ...(data.lineSeries || [])]);
  if (Array.isArray(data.labels) && Array.isArray(data.series)) return byLabel(data.series);
  if (Array.isArray(data.labels) && Array.isArray(data.values)) return byLabel([{ name: measure, values: data.values }]);
  if (Array.isArray(data.items)) return [[dim, measure], ...data.items.map((it) => [it.name, it.value ?? null])];
  if (Array.isArray(data.xLabels) && Array.isArray(data.yLabels) && Array.isArray(data.cells)) {
    const at = new Map(data.cells.map(([x, y, v]) => [`${x}|${y}`, v]));
    return [['', ...data.xLabels], ...data.yLabels.map((y, yi) => [y, ...data.xLabels.map((_, xi) => at.get(`${xi}|${yi}`) ?? null)])];
  }
  if (Array.isArray(data.points)) {
    const named = data.points.some((p) => p.label);
    const size = data._hasSize ? [data._sizeLabel || 'Size'] : [];
    return [
      [...(named ? [dim] : []), data._xLabel || 'X', data._yLabel || 'Y', ...size],
      ...data.points.map((p) => [...(named ? [p.label || ''] : []), p.x, p.y, ...(data._hasSize ? [p.size] : [])]),
    ];
  }
  if (data._numValue !== undefined) {
    return data._n1Value !== undefined
      ? [[measure, `${measure} N-1`], [data._numValue, data._n1Value]]
      : [[measure], [data._numValue]];
  }
  return null;
}

const BOM = String.fromCharCode(0xfeff);
const csvCell = (v) => {
  if (v == null) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** RFC 4180, with a BOM so Excel reads the accents. */
export function toCsv(sheet) {
  return `${BOM}${sheet.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

/** A file name from a visual's title: what the reader sees, without the characters a file system refuses. */
export function fileNameOf(title, fallback = 'visual') {
  const s = String(title || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return s || fallback;
}
