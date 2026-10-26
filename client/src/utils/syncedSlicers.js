// Slicers synced across pages (Power BI's "Sync slicers"). A filter visual
// lists, in `config.syncPages`, the ids of the other pages it shares its
// selection with. Pages are keyed by id, never by position: pages get
// reordered and deleted, and an id that no longer names a page is ignored.
//
// Sync is a link between pages on ONE field, and it goes both ways: page A
// listing page B puts A and B in the same group for that field, whichever
// page lists the other, and links chain (A–B and B–C make one group). Every
// page of a group reads the same selection, a page outside it keeps its own.
//
// The shared selections are a plain object keyed by group (`shared[key]`),
// a cleared selection kept as `[]` so that it still wins over an older one.

const SEP = '\u0000';

const dimOf = (w) => w?.dataBinding?.selectedDimensions?.[0];

function sameValues(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function* slicersOf(widgets) {
  for (const w of Object.values(widgets || {})) {
    const dim = w?.type === 'filter' ? dimOf(w) : null;
    if (dim) yield [w, dim];
  }
}

/**
 * Which group each page belongs to, field by field.
 * @param {{ id: string, widgets: object }[]} pages  the report's pages
 * @returns {{ [pageId]: { [dim]: string } }}  a group key per synced field
 */
export function syncGroups(pages) {
  const ids = new Set((pages || []).map((p) => p?.id).filter(Boolean));
  const parent = new Map();
  const find = (n) => {
    while (parent.get(n) !== n) n = parent.get(n);
    return n;
  };
  const node = (dim, pageId) => {
    const n = dim + SEP + pageId;
    if (!parent.has(n)) parent.set(n, n);
    return n;
  };
  for (const page of pages || []) {
    if (!page?.id) continue;
    for (const [w, dim] of slicersOf(page.widgets)) {
      const list = w.config?.syncPages;
      if (!Array.isArray(list)) continue;
      for (const other of list) {
        if (other === page.id || !ids.has(other)) continue;
        parent.set(find(node(dim, page.id)), find(node(dim, other)));
      }
    }
  }
  const members = new Map();
  for (const n of parent.keys()) {
    const root = find(n);
    if (!members.has(root)) members.set(root, []);
    members.get(root).push(n);
  }
  const groups = {};
  for (const nodes of members.values()) {
    const dim = nodes[0].split(SEP)[0];
    const pageIds = nodes.map((n) => n.slice(dim.length + 1)).sort();
    const key = [dim, ...pageIds].join(SEP);
    for (const pageId of pageIds) {
      groups[pageId] = { ...(groups[pageId] || {}), [dim]: key };
    }
  }
  return groups;
}

/**
 * The shared selections as the pages' slicers hold them (`selectedValues`).
 * The page named by `preferPageId` decides for its groups, a cleared slicer
 * included (in the editor it is the page being edited); elsewhere the first
 * slicer with a selection, in page order, does.
 */
export function sharedSelections(groups, pages, preferPageId = null) {
  const shared = {};
  const ordered = [...(pages || [])].sort((a, b) => (b?.id === preferPageId) - (a?.id === preferPageId));
  for (const page of ordered) {
    const dims = groups[page?.id];
    if (!dims) continue;
    for (const [w, dim] of slicersOf(page.widgets)) {
      const key = dims[dim];
      if (!key || key in shared) continue;
      const vals = w.config?.selectedValues;
      if (Array.isArray(vals) && vals.length > 0) shared[key] = vals;
      else if (page.id === preferPageId) shared[key] = [];
    }
  }
  return shared;
}

/** `shared` once the slicer on `dim` of page `pageId` picked `values`. */
export function withSelection(shared, groups, pageId, dim, values) {
  const key = groups[pageId]?.[dim];
  if (!key) return shared;
  return { ...shared, [key]: Array.isArray(values) && values.length > 0 ? values : [] };
}

/** `shared` once page `pageId` holds `selections` ({ [dim]: values }) on all its synced fields. */
export function withPageSelections(shared, groups, pageId, selections) {
  let out = shared;
  for (const dim of Object.keys(groups[pageId] || {})) {
    out = withSelection(out, groups, pageId, dim, selections?.[dim]);
  }
  return out;
}

/**
 * A page's filters ({ [dim]: values }) with its synced fields set to the
 * shared selection, or dropped when it is cleared. The same object when
 * nothing changes, so that a caller can tell a page that needs a new fetch.
 */
export function syncedFilters(filters, groups, pageId, shared) {
  const dims = groups[pageId];
  const base = filters || {};
  if (!dims) return base;
  let out = base;
  for (const [dim, key] of Object.entries(dims)) {
    const want = shared?.[key];
    const has = Array.isArray(want) && want.length > 0;
    if (has ? sameValues(base[dim], want) : !(dim in base)) continue;
    if (out === base) out = { ...base };
    if (has) out[dim] = want;
    else delete out[dim];
  }
  return out;
}

/**
 * A page's widgets with each synced slicer showing the shared selection in
 * its saved config (the editor keeps a slicer's selection there). Groups
 * nobody picked anything in are left alone. The same object when nothing
 * changes.
 */
export function alignedWidgets(widgets, groups, pageId, shared) {
  const dims = groups[pageId];
  if (!dims || !widgets) return widgets;
  let out = widgets;
  for (const [id, w] of Object.entries(widgets)) {
    const dim = w?.type === 'filter' ? dimOf(w) : null;
    const key = dim && dims[dim];
    if (!key || !(key in shared)) continue;
    const want = shared[key];
    const cur = w.config?.selectedValues;
    if (want.length > 0 ? sameValues(cur, want) : !(Array.isArray(cur) && cur.length > 0)) continue;
    const config = { ...(w.config || {}) };
    if (want.length > 0) config.selectedValues = want;
    else delete config.selectedValues;
    if (out === widgets) out = { ...widgets };
    out[id] = { ...w, config };
  }
  return out;
}

/**
 * The pages once filters are synced or unsynced as the assistant proposed
 * (server utils/ai/filterSync.js). A decision says that the filter on `dim`
 * of page `page` shares its selection with `pages` (ids), `[]` meaning its
 * own. The group is written on every filter of it — the property panel
 * shows each filter's pages — and an unsynced page is taken out of the
 * other filters' lists, the link going both ways. Ids that name no page are
 * ignored.
 * @returns {object[]} the pages, the same objects where nothing changes
 */
export function withFilterSync(pages, decisions) {
  const ids = new Set((pages || []).map((p) => p?.id).filter(Boolean));
  let out = pages || [];
  for (const d of decisions || []) {
    if (!d || !ids.has(d.page) || !d.dim) continue;
    const others = [...new Set((d.pages || []).filter((id) => ids.has(id) && id !== d.page))];
    const group = new Set([d.page, ...others]);
    out = out.map((p) => {
      let widgets = null;
      for (const [id, w] of Object.entries(p.widgets || {})) {
        if (w?.type !== 'filter' || dimOf(w) !== d.dim) continue;
        const cur = Array.isArray(w.config?.syncPages) ? w.config.syncPages : [];
        let next;
        if (p.id === d.page) next = others;
        else if (others.length && group.has(p.id)) next = [...new Set([...cur, ...[...group].filter((x) => x !== p.id)])];
        else if (!others.length && cur.includes(d.page)) next = cur.filter((x) => x !== d.page);
        else continue;
        const config = { ...(w.config || {}) };
        if (next.length) config.syncPages = next;
        else delete config.syncPages;
        widgets = widgets || { ...p.widgets };
        widgets[id] = { ...w, config };
      }
      return widgets ? { ...p, widgets } : p;
    });
  }
  return out;
}

/** A sync decision in words, for the card and the conversation. */
export function syncDecisionLine(d) {
  const names = (d?.pageNames || []).filter(Boolean);
  return d?.synced
    ? `${d.label} filter synced on ${names.join(', ') || 'several pages'}`
    : `${d?.label} filter on ${names[0] || 'its page'}: its own selection`;
}
