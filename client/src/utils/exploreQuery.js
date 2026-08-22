// Ad-hoc exploration: pure helpers between the Explore page's picks and
// the /query wire format (and back out to CSV). No React, no axios.

/** Build the /query body for the current picks. */
export function buildExploreBody({ modelId, dims = [], measures = [], filters = [], limit = 1000 }) {
  const rules = (filters || []).filter((f) => f && f.field && f.op);
  return {
    dimensionNames: dims,
    measureNames: measures,
    limit: Math.min(10000, Math.max(1, Math.floor(Number(limit) || 1000))),
    filters: {},
    ...(rules.length > 0 ? { widgetFilters: rules } : {}),
    // Exploration is a read surface with no report context: no reportId,
    // normal cache behaviour (rollups welcome — same numbers, faster).
    _modelId: modelId,
  };
}

/** Column order = dims then measures, labelled from the model defs. */
export function exploreColumns({ dims = [], measures = [], model }) {
  const label = (name, list) => {
    const def = (list || []).find((x) => x.name === name);
    return def ? (def.label || def.name) : name;
  };
  return [
    ...dims.map((d) => ({ name: d, key: label(d, model?.dimensions), kind: 'dim' })),
    ...measures.map((m) => ({ name: m, key: label(m, model?.measures), kind: 'measure' })),
  ];
}

/** Client-side sort of the result rows on one response column. */
export function sortRows(rows, key, dir) {
  if (!key || !dir) return rows;
  const sign = dir === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    const va = a[key]; const vb = b[key];
    if (va == null && vb == null) return 0;
    if (va == null) return 1; // nulls last, either direction
    if (vb == null) return -1;
    const na = Number(va); const nb = Number(vb);
    if (Number.isFinite(na) && Number.isFinite(nb)) return (na - nb) * sign;
    return String(va).localeCompare(String(vb)) * sign;
  });
}

/** RFC-4180-ish CSV: quote when needed, double embedded quotes, CRLF. */
export function rowsToCsv(rows, columns) {
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const keys = columns.map((c) => c.key);
  const lines = [keys.map(esc).join(',')];
  for (const row of rows || []) {
    lines.push(keys.map((k) => esc(row[k])).join(','));
  }
  return lines.join('\r\n');
}
