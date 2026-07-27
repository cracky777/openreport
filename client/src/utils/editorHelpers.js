// Pure helpers extracted verbatim from pages/Editor.jsx (LOT 6.3). No React,
// no component state — widget-data type conversion + the snapshot serializer
// used for dirty-state detection.

export function convertData(data, fromType, toType) {
  if (!data || Object.keys(data).length === 0) return data;

  // Extract labels and values from any source format
  let labels = [];
  let values = [];

  if (data.labels && data.values) {
    // bar, line format
    labels = data.labels;
    values = data.values;
  } else if (data.items) {
    // pie format
    labels = data.items.map((item) => item.name);
    values = data.items.map((item) => item.value);
  } else if (data.columns && data.rows) {
    // table format
    labels = data.rows.map((r) => r[0]);
    values = data.rows.map((r) => parseFloat(r[r.length - 1]) || 0);
  } else if (data.rawRows || data.points || data.barSeries || data.lineSeries) {
    // pivotTable / scatter / combo format — clear data, will need refetch
    return {};
  } else if (data.value !== undefined) {
    // scorecard format - can't meaningfully convert
    return data;
  } else {
    return data;
  }

  // Convert to target format
  switch (toType) {
    case 'bar':
    case 'line':
      return { labels, values };
    case 'pie':
    case 'treemap':
      return { items: labels.map((name, i) => ({ name, value: values[i] || 0 })) };
    case 'table':
      return {
        columns: ['Label', 'Value'],
        rows: labels.map((l, i) => [String(l), String(values[i] || 0)]),
      };
    case 'scorecard':
    case 'gauge':
      return {
        value: values.reduce((a, b) => a + b, 0),
        label: 'Total',
      };
    case 'pivotTable':
    case 'scatter':
    case 'combo':
      // Needs specific data format — clear data to force a refetch
      return {};
    default:
      return data;
  }
}

// Canonical JSON serializer — keys sorted so object key ordering doesn't affect the output.
export function canonicalStringify(obj) {
  if (obj === null || obj === undefined) return 'null';
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonicalStringify).join(',') + ']';
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalStringify(obj[k])).join(',') + '}';
}

// Build a stable snapshot string used to detect real modifications against the last-saved state.
// Strips transient widget data/loading flags — only persisted config matters — and emits keys in
// canonical order so a difference means a real change, not a re-ordered object.
export function buildSnapshot(title, settings, pagesArr) {
  const cleanWidget = (w) => {
    if (!w) return {};
    // Only keep fields that represent the user-authored configuration of the widget.
    // Anything else (data, _loading, _error, transient cached state…) is runtime noise.
    const out = {
      type: w.type,
      config: w.config || {},
      dataBinding: w.dataBinding || {},
    };
    if (Array.isArray(w.drillPath) && w.drillPath.length > 0) out.drillPath = w.drillPath;
    return out;
  };
  const cleanPage = (p) => ({
    id: p.id, name: p.name,
    layout: p.layout || [],
    widgets: Object.fromEntries(Object.entries(p.widgets || {}).map(([k, w]) => [k, cleanWidget(w)])),
  });
  // Server nests pages inside settings for storage — strip that copy out; our `pagesArr` is the canonical one.
  const settingsSansPages = { ...(settings || {}) };
  delete settingsSansPages.pages;
  return canonicalStringify({ title: title || '', settings: settingsSansPages, pages: (pagesArr || []).map(cleanPage) });
}
