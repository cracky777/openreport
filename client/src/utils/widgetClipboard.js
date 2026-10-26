import { clampPos } from './pageBounds';

// Copy a visual in one report, paste it in another — the way Power BI does.
//
// The clipboard lives in localStorage, not in the editor's state: the editor
// is a new page for every report, and the other report is often open in
// another tab. What a visual needs from its report travels with it — the
// report's own measures and dimensions it reads (`_calc.*`, the Date table's
// `_date.*`) and the formats set on its fields — and is added to the report it
// lands in when that report does not have them yet.

const KEY = 'openreport.widgetClipboard';
const DECOR = new Set(['text', 'shape', 'image']);

// A field a visual names, without the variant it reads ("x@@agg:max" → "x").
const baseName = (s) => String(s).split('@@')[0];

// Every string the widget holds: bindings, filters, sorts, colour rules all
// name fields in their own places, and a field not listed here would be lost.
function stringsIn(value, out = new Set()) {
  if (typeof value === 'string') out.add(value);
  else if (Array.isArray(value)) value.forEach((v) => stringsIn(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => stringsIn(v, out));
  return out;
}

// The fields of `model` the widget reads, as base names.
export function fieldsOf(widget, model) {
  const names = new Set([...(model?.dimensions || []), ...(model?.measures || [])].map((f) => f.name));
  const out = new Set();
  for (const s of stringsIn({ binding: widget?.dataBinding, config: widget?.config })) {
    const base = baseName(s);
    if (names.has(base)) out.add(base);
  }
  return [...out];
}

/**
 * The clipboard entry for one widget of a report. Rows are not copied: on
 * another model they would be another model's numbers, and the visual asks
 * for its own as soon as it lands. A text keeps its words.
 */
export function copyEntry({ widget, layoutItem, settings, model, reportId, pageId }) {
  const fields = fieldsOf(widget, model);
  const used = new Set(fields);
  const pick = (over) => Object.fromEntries(Object.entries(over || {}).filter(([k]) => used.has(k)));
  const copy = JSON.parse(JSON.stringify(widget));
  copy.data = widget.type === 'text'
    ? { text: widget.data?.text, runs: widget.data?.runs }
    : DECOR.has(widget.type) ? { ...(widget.data || {}) } : {};
  delete copy._loading;
  const all = [...(model?.dimensions || []), ...(model?.measures || [])];
  const labels = Object.fromEntries(fields.map((f) => [f, all.find((x) => x.name === f)?.label || f]));
  return {
    widget: copy,
    layout: { ...layoutItem },
    from: { reportId, pageId, modelId: model?.id || null },
    fields,
    labels,
    extraMeasures: (settings?.extraMeasures || []).filter((m) => used.has(m.name)),
    extraDimensions: (settings?.extraDimensions || []).filter((d) => used.has(d.name)),
    measureOverrides: pick(settings?.measureOverrides),
    dimensionOverrides: pick(settings?.dimensionOverrides),
  };
}

export function writeClipboard(entry) {
  try { localStorage.setItem(KEY, JSON.stringify(entry)); return true; } catch { return false; /* full or blocked: the copy did not happen */ }
}

export function readClipboard() {
  try {
    const entry = JSON.parse(localStorage.getItem(KEY) || 'null');
    return entry && entry.widget && entry.layout ? entry : null;
  } catch { return null; /* blocked or not ours: nothing to paste */ }
}

/**
 * What pasting `entry` does to a report: the widget under `newId`, where it
 * lands, the settings it brings, and the fields this report's model does not
 * have (the visual is pasted all the same, as Power BI does, and says so).
 *
 * Same page: one step down and right of the original, so the copy is seen.
 * Anywhere else: the original's place, kept on the page.
 */
export function pasteEntry(entry, { newId, reportId, pageId, settings, model, pageWidth = 1140, pageHeight = 800 }) {
  const samePage = entry.from?.reportId === reportId && entry.from?.pageId === pageId;
  const sameReport = entry.from?.reportId === reportId;
  const l = entry.layout;
  const x = (l.x || 0) + (samePage ? 20 : 0);
  const y = (l.y || 0) + (samePage ? 20 : 0);
  const layoutItem = { ...l, i: newId, ...clampPos(x, y, l.w || 0, l.h || 0, pageWidth, pageHeight) };

  const widget = JSON.parse(JSON.stringify(entry.widget));
  // Interactions name the source report's widgets: none of them is here.
  if (!sameReport && widget.config) delete widget.config.crossFilterExclusions;

  // The report's own fields come along when this report has none of that name;
  // one it already has is its own and wins.
  const has = (list, name) => (list || []).some((f) => f.name === name);
  // On another model, a field reading a table that model does not have
  // (the Date table of the other database) is not brought: it is missing.
  const tables = new Set([...(model?.dimensions || []), ...(model?.measures || [])].map((f) => f.table).filter(Boolean));
  const reaches = (f) => entry.from?.modelId === model?.id || !f.table || tables.has(f.table);
  const addMeasures = (entry.extraMeasures || []).filter((m) => !has(settings?.extraMeasures, m.name) && !has(model?.measures, m.name) && reaches(m));
  const addDimensions = (entry.extraDimensions || []).filter((d) => !has(settings?.extraDimensions, d.name) && !has(model?.dimensions, d.name) && reaches(d));
  const fill = (mine, theirs) => ({ ...(theirs || {}), ...(mine || {}) });
  const settingsPatch = sameReport ? null : (s) => ({
    ...s,
    extraMeasures: [...(s.extraMeasures || []), ...addMeasures],
    extraDimensions: [...(s.extraDimensions || []), ...addDimensions],
    measureOverrides: fill(s.measureOverrides, entry.measureOverrides),
    dimensionOverrides: fill(s.dimensionOverrides, entry.dimensionOverrides),
  });

  const known = new Set([
    ...(model?.dimensions || []), ...(model?.measures || []), ...addMeasures, ...addDimensions,
  ].map((f) => f.name));
  const missing = (entry.fields || []).filter((f) => !known.has(f)).map((f) => entry.labels?.[f] || f);
  return { widget, layoutItem, settingsPatch, missing };
}
