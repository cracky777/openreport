// The report changed as a whole from the studio's conversation: visuals added
// where they belong, replaced or removed, pages added, renamed or removed —
// the report's look (theme, colors, fonts) untouched, that is the Design
// tab's. Asked by Jonathan: in the chat the assistant is as free on the
// report as it was when it built the Finance package by itself. Every visual
// goes through the checks of a propose_widgets answer; every page it touches
// is laid out here (the rows the model gives, or the page recomposed), and
// the browser applies the result as one undo step
// (client utils/aiProposal.applyReportChanges).

const { validateWidgetsProposal } = require('./validateProposal');
const { arrange, layoutNew, insertWidgets, pageHeightOf, floorOf, MARGIN, COMPOSITIONS } = require('./arrangeLayout');
const { colorWidgets, formatOverrides } = require('./dress');
const { validateMeasures } = require('./reportMeasures');
const { checkSync, filterDim } = require('./filterSync');

const MAX_PAGES_TOUCHED = 8;
const MAX_REPLACED = 12;
const MAX_REMOVED = 24;
const PAGE_ALIAS = /^p(\d{1,2})$/;
const NEW_ID = /^n(\d{1,2})$/;
const NEW_PAGE = /^new(\d{0,2})$/;
const MAX_SYNC = 12;
const SIDES = new Set(['right', 'left', 'below', 'above']);
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// Where the k-th addition goes, as the proposal wrote it: next to a widget
// the page keeps, or to an addition before it; anything else means the end
// of the page.
function placeOf(raw, k, byId, removed) {
  const place = raw && raw.place && typeof raw.place === 'object' ? raw.place : null;
  if (!place || !SIDES.has(place.side)) return null;
  const near = String(place.near || '');
  const earlier = NEW_ID.exec(near);
  const known = earlier ? Number(earlier[1]) <= k : byId.has(near) && !removed.has(near);
  return known ? { near, side: place.side } : null;
}

// 'p1' is the page shown, 'p2'… the report's other pages in the order the
// context lists them (the prompt names them the same way).
function pageOf(alias, pageContext) {
  if (alias === 'p1') return { id: pageContext.pageId || null, name: pageContext.pageName || '', shown: true, widgets: pageContext.widgets || [] };
  const m = PAGE_ALIAS.exec(String(alias || ''));
  const other = m ? (pageContext.otherPages || [])[Number(m[1]) - 2] : null;
  return other ? { id: other.id, name: other.name || '', shown: false, widgets: other.widgets || [] } : null;
}

// A sync's page refs, as the proposal writes them: p1, p2… (pages of the
// report), new1, new2… (the pages this call adds, in order; "new" when it
// adds one). Resolved once every entry is read: a token is a page id, or
// "new:k" for the k-th new page of the payload (the browser gives it its id).
function syncTokenOf(ref, pageContext, newTokens) {
  const r = String(ref || '');
  const m = NEW_PAGE.exec(r);
  if (m) {
    if (!m[1]) return newTokens.length === 1 ? newTokens[0] : undefined;
    return newTokens[Number(m[1]) - 1];
  }
  const page = pageOf(r, pageContext);
  return page ? page.id || 'p1' : undefined;
}

// The filters a page holds, as the sync check reads them.
const filtersOf = (widgets, fresh) => widgets.map((w) => ({ dim: filterDim(w), fresh })).filter((f) => f.dim);

const dateDimsOf = (effective) => new Set(((effective && effective.dimensions) || []).filter((d) => /date|time/i.test(String(d.type || ''))).map((d) => d.name));

// A widget of the page context, as the layout helpers size it: its look and
// its shape together, its title where a new widget carries it.
const sizable = (w, dateDims, inner) => {
  const config = { ...(w.config || {}), ...(w.shape || {}), title: w.title || '' };
  const item = { id: w.id, type: w.type, title: w.title || '', config, shape: w.shape || {}, dataBinding: w.dataBinding || {}, merged: !!w.merged };
  return { ...item, ...(w.type === 'image' && w.layout ? { ownWidth: w.layout.w } : {}), minSize: w.minSize || floorOf(item, dateDims, inner) };
};
// A new widget, sized the same way.
const sizableNew = (id, w, dateDims, inner) => {
  const item = { id, type: w.type, title: (w.config && w.config.title) || '', config: w.config || {}, shape: w.config || {}, dataBinding: w.dataBinding || {} };
  return { ...item, minSize: floorOf(item, dateDims, inner) };
};

// Reading order: the page as a person scans it, so a recomposition keeps the
// story the author told.
const ROOM_GUTTER = 20;
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * A text or an image set at its own box over the page's visuals (a title
 * band across the top) is meant above them, never on them: everything from
 * the first visual it covers down slides under it, by one shift. The card
 * said "the rest of the page goes down a row" and the band sat on the
 * figures (seen with Karim). A shape keeps its place: a background sits
 * under the visuals by design.
 * @param {object[]} added    the additions, laid out
 * @param {object[]} kept     the page's widgets kept, at their layout
 * @param {object[]} moves    the moves already made for the kept ones
 * @param {Set<number>} placedByApp  indexes of the additions the app placed (they slide too)
 */
function makeRoom(added, kept, moves, placedByApp) {
  const bands = added.filter((w, k) => !placedByApp.has(k) && (w.type === 'text' || w.type === 'image') && w.layout).map((w) => w.layout);
  const at = new Map(kept.map((w) => [w.id, w.layout]).filter(([, r]) => r));
  for (const m of moves) at.set(m.widgetId, { x: m.x, y: m.y, w: m.w, h: m.h });
  const placed = added.map((w, k) => (placedByApp.has(k) && w.layout ? w.layout : null));
  const boxes = [...at.values(), ...placed.filter(Boolean)];
  const covering = bands.filter((b) => boxes.some((r) => overlaps(b, r)));
  if (!covering.length) return { moves, added };
  const top = Math.min(...boxes.filter((r) => covering.some((b) => overlaps(b, r))).map((r) => r.y));
  const shift = Math.max(...covering.map((b) => b.y + b.h)) + ROOM_GUTTER - top;
  const down = (r) => ({ x: r.x, y: r.y + shift, w: r.w, h: r.h });
  const next = new Map(moves.map((m) => [m.widgetId, m]));
  for (const [id, r] of at) if (r.y >= top) next.set(id, { op: 'move', widgetId: id, ...down(r) });
  return {
    moves: [...next.values()],
    added: added.map((w, k) => (placed[k] && placed[k].y >= top ? { ...w, layout: down(placed[k]) } : w)),
  };
}

const readingOrder = (widgets) => [...widgets].sort((a, b) => ((a.layout && a.layout.y) || 0) - ((b.layout && b.layout.y) || 0) || ((a.layout && a.layout.x) || 0) - ((b.layout && b.layout.x) || 0));

/**
 * The page laid out again around what it keeps and what joins it, with the
 * composition rules of a new page (filters, figures, charts two by two…).
 * @returns {{ moves: object[], added: object[] }} moves for the widgets kept, the added widgets with their layout
 */
function composePage(kept, added, page, effective) {
  const dateDims = dateDimsOf(effective);
  const inner = page.width - 2 * MARGIN;
  const items = [
    ...readingOrder(kept).map((w) => ({ ...sizable(w, dateDims, inner), existingId: w.id })),
    ...added.map((w) => ({ type: w.type, config: w.config, dataBinding: w.dataBinding, minSize: sizableNew('', w, dateDims, inner).minSize })),
  ];
  const laid = layoutNew(items, page, effective);
  const moves = [];
  const out = [];
  laid.forEach((it, i) => {
    if (i < kept.length) moves.push({ op: 'move', widgetId: it.existingId, ...it.layout });
    else out.push({ ...added[i - kept.length], layout: it.layout });
  });
  return { moves, added: out };
}

/**
 * @param {object} args  the tool's arguments: { summary, pages: [{ page, name, remove, add: [{ …widget, place? }], replace, removeWidgets, rows }] }
 * @param {object} ctx   the proposal context of the report chat (agent.js)
 * @returns {{ payload: object|null, errors: string[], warnings: string[] }}
 */
function validateReportChanges(args, givenCtx) {
  const a = args && typeof args === 'object' ? args : {};
  const entries = Array.isArray(a.pages) ? a.pages.slice(0, MAX_PAGES_TOUCHED) : [];
  const errors = [];
  const warnings = [];
  const pages = [];
  // Measures first: the visuals below may use them.
  const measured = validateMeasures(a.measures, givenCtx);
  errors.push(...measured.errors);
  const ctx = measured.measures.length ? { ...givenCtx, effective: { ...givenCtx.effective, measures: [...givenCtx.effective.measures, ...measured.measures] } } : givenCtx;
  const title = typeof a.title === 'string' && a.title.trim() ? a.title.trim().slice(0, 120) : null;
  if (!entries.length && !measured.measures.length && !title) errors.push('pages: nothing to change — one page at least, p1 for the page shown or "new"');
  const theme = { theme: ctx.pageContext.theme, effective: ctx.effective };
  const dateDims = dateDimsOf(ctx.effective);
  const inner = ctx.page.width - 2 * MARGIN;
  let newPages = 0;
  // The report as it will be, for the filters synced across pages: every
  // page by its token, its filters after the change (filterSync.checkSync).
  const after = new Map([
    [ctx.pageContext.pageId || 'p1', { token: ctx.pageContext.pageId || 'p1', name: ctx.pageContext.pageName || '', filters: filtersOf(ctx.pageContext.widgets || [], false) }],
    ...(ctx.pageContext.otherPages || []).map((p) => [p.id, { token: p.id, name: p.name || '', filters: filtersOf(p.widgets || [], false) }]),
  ]);
  // The new pages the proposal writes, in order (`new1`…), and the payload
  // token of each one kept (null when refused).
  const newTokens = [];
  // Sync decisions as written, page refs resolved after the loop.
  const rawSyncs = [];

  entries.forEach((e, i) => {
    const label = `Page ${i + 1}`;
    const entry = e && typeof e === 'object' ? e : {};
    const isNew = entry.page === 'new';
    const page = isNew ? null : pageOf(entry.page, ctx.pageContext);
    if (!isNew && !page) { errors.push(`${label}: page must be "p1" (the page shown), "p2"… (the other pages, as listed) or "new"`); return; }
    const name = text(entry.name, 60);
    const out = {
      shown: !!(page && page.shown), pageId: page ? page.id : null, isNew,
      name: isNew ? (name || `Page ${(ctx.pageContext.otherPages || []).length + 2 + newPages}`) : page.name,
      rename: !isNew && name && name !== page.name ? name : null,
      remove: !isNew && entry.remove === true,
      add: [], replace: [], removeWidgets: [], moves: [], laidOut: false,
    };
    if (isNew) newPages += 1;
    if (isNew) newTokens.push(null);
    if (out.remove) { pages.push(out); after.delete(page.id || 'p1'); return; }

    const existing = page ? page.widgets : [];
    // A visual joining this page dresses like this page's; a new page follows the page shown.
    const pageCtx = { ...ctx, siblings: existing.length ? existing : (ctx.pageContext.widgets || []) };
    const byId = new Map(existing.map((w) => [w.id, w]));
    const removed = new Set();
    for (const id of (Array.isArray(entry.removeWidgets) ? entry.removeWidgets : []).slice(0, MAX_REMOVED)) {
      if (byId.has(id)) { removed.add(id); out.removeWidgets.push(id); }
      else errors.push(`${label}: removeWidgets: no widget ${JSON.stringify(String(id).slice(0, 40))} on this page`);
    }
    // A replacement keeps the slot and the frame of what it replaces: only
    // what the visual shows changes.
    const replaced = new Map();
    for (const r of (Array.isArray(entry.replace) ? entry.replace : []).slice(0, MAX_REPLACED)) {
      const target = r && byId.get(r.widgetId);
      if (!target) { errors.push(`${label}: replace: no widget ${JSON.stringify(String((r && r.widgetId) || '').slice(0, 40))} on this page`); continue; }
      if (removed.has(target.id)) { errors.push(`${label}: replace: ${JSON.stringify(target.title || target.type)} is also removed; do one or the other`); continue; }
      const checked = validateWidgetsProposal({ widgets: [r.with] }, pageCtx);
      errors.push(...checked.errors.map((m) => `${label}, replacing ${JSON.stringify(target.title || target.type)}: ${m}`));
      warnings.push(...(checked.warnings || []).map((m) => `${label}, replacing ${JSON.stringify(target.title || target.type)}: ${m}`));
      if (checked.widgets[0]) {
        const [widget] = colorWidgets(checked.widgets, theme);
        replaced.set(target.id, widget);
        // Its title travels too: on another page, the card has nothing else to name it by.
        out.replace.push({ widgetId: target.id, widget, from: target.title || '' });
      }
    }
    const rawAdd = Array.isArray(entry.add) ? entry.add : [];
    let added = [];
    if (rawAdd.length) {
      const checked = validateWidgetsProposal({ widgets: rawAdd }, pageCtx);
      errors.push(...checked.errors.map((m) => `${label}: ${m}`));
      warnings.push(...(checked.warnings || []).map((m) => `${label}: ${m}`));
      // Where each one goes, as the proposal said it: beside, under or over
      // a widget of the page (or an earlier addition), else the end of the page.
      added = colorWidgets(checked.widgets, theme).map((w, k) => {
        const raw = rawAdd[checked.accepted[k]];
        return { ...w, place: placeOf(raw, k, byId, removed), ...(raw && raw.sync !== undefined ? { sync: raw.sync } : {}) };
      });
    }

    // What the page holds afterwards, sized: the kept widgets (a replaced one
    // at the size its new visual needs) and the new ones as n1, n2…
    const kept = existing.filter((w) => !removed.has(w.id)).map((w) => {
      const next = replaced.get(w.id);
      return next ? { ...w, type: next.type, title: (next.config && next.config.title) || w.title, config: next.config, shape: next.config, dataBinding: next.dataBinding, minSize: undefined } : w;
    });
    const byIdAfter = new Map([
      ...kept.map((w) => [w.id, sizable(w, dateDims, inner)]),
      ...added.map((w, k) => [`n${k + 1}`, sizableNew(`n${k + 1}`, w, dateDims, inner)]),
    ]);
    const rows = Array.isArray(entry.rows) ? entry.rows : null;
    // Rows the page cannot take (a row too full, a widget left out): said
    // once, and the page recomposed around everything it keeps and gains —
    // never a visual dropped for a layout mistake (seen with a real model:
    // eight figures in one row lost the four it was adding).
    let rowsUsed = false;
    if (rows) {
      const laid = arrange({ rows }, byIdAfter, ctx.page);
      const placed = new Set(laid.moves.map((m) => m.widgetId));
      const missing = [...byIdAfter.keys()].filter((id) => !placed.has(id));
      if (!laid.errors.length && laid.moves.length && !missing.length) {
        rowsUsed = true;
        for (const m of laid.moves) {
          const n = NEW_ID.exec(m.widgetId);
          if (n) added[Number(n[1]) - 1] = { ...added[Number(n[1]) - 1], layout: { x: m.x, y: m.y, w: m.w, h: m.h } };
          else out.moves.push(m);
        }
      } else {
        const why = laid.errors.length ? laid.errors.join('; ') : `rows leave out ${missing.map((id) => JSON.stringify(id)).join(', ')}`;
        warnings.push(`${label}: the rows were not used (${why}); ${added.length ? 'the new visuals were set into the page as it is' : 'the page was laid out again by the app'}`);
      }
    }
    if (rowsUsed) {
      out.laidOut = true;
    } else if (!kept.length) {
      added = layoutNew(added, ctx.page, ctx.effective, isNew && COMPOSITIONS.includes(entry.composition) ? entry.composition : 'standard');
    } else if (added.length) {
      // The page keeps its layout: the new visuals are set into it where the
      // proposal put them, and only what has to make room moves. A visual
      // with its own box (the page's dressing: a band, a divider, a logo,
      // meant to sit under or over the others) is kept exactly there.
      const free = added.map((w, k) => ({ ...w, k })).filter((w) => !w.layout);
      const set = insertWidgets(
        kept.map((w) => ({ ...byIdAfter.get(w.id), layout: w.layout })),
        free.map((w) => ({ ...w, minSize: byIdAfter.get(`n${w.k + 1}`).minSize })),
        ctx.page,
        ctx.effective,
      );
      out.moves = set.moves;
      set.added.forEach(({ k, ...w }) => { added[k] = w; });
      ({ moves: out.moves, added } = makeRoom(added, kept, out.moves, new Set(free.map((w) => w.k))));
    } else if (rows) {
      // Rows asked for the page as it is, and unusable: recomposed instead.
      out.moves = composePage(kept, [], ctx.page, ctx.effective).moves;
      out.laidOut = true;
    }
    out.add = added.filter((w) => w.layout).map(({ place: _where, minSize: _size, sync: _sync, ...w }) => w);

    // Sync decisions of this page: an added filter's own `sync`, and the
    // page's `sync` entries for the filters it holds (n1… = additions).
    const holder = (id) => {
      const n = NEW_ID.exec(String(id || ''));
      if (n) return added[Number(n[1]) - 1] && added[Number(n[1]) - 1].layout ? added[Number(n[1]) - 1] : null;
      return removed.has(id) ? null : (replaced.get(id) || byId.get(id) || null);
    };
    const syncs = [
      ...added.filter((w) => w.layout && Array.isArray(w.sync)).map((w) => ({ w, refs: w.sync })),
      ...(Array.isArray(entry.sync) ? entry.sync.slice(0, MAX_SYNC) : []).map((s) => ({ w: holder(s && s.widget), refs: s && s.pages, id: s && s.widget })),
    ];
    const decided = [];
    for (const { w, refs, id } of syncs) {
      const dim = filterDim(w);
      if (!dim) { errors.push(`${label}: sync: ${JSON.stringify(String(id || '').slice(0, 40))} is not a filter of this page`); continue; }
      if (!Array.isArray(refs)) { errors.push(`${label}: sync: pages is a list of page refs ([] = its own selection)`); continue; }
      decided.push({ dim, refs: refs.slice(0, 20) });
    }

    if (!out.add.length && !out.replace.length && !out.removeWidgets.length && !out.moves.length && !out.rename && !decided.length) {
      errors.push(`${label}: nothing changes on it`);
      return;
    }
    pages.push(out);
    // A new page's token is its rank among the new pages the payload keeps.
    const token = isNew ? `new:${pages.filter((p) => p.isNew).length - 1}` : page.id || 'p1';
    if (isNew) newTokens[newTokens.length - 1] = token;
    for (const d of decided) rawSyncs.push({ label, token, ...d });
    after.set(token, {
      token,
      name: out.rename || out.name,
      filters: [
        ...filtersOf(existing.filter((w) => !removed.has(w.id) && !replaced.has(w.id)), false),
        ...filtersOf([...replaced.values(), ...out.add], true),
      ],
    });
  });

  // The page refs of the syncs, now that every page has its token.
  const decisions = [];
  for (const { label, token, dim, refs } of rawSyncs) {
    const tokens = [];
    for (const ref of refs) {
      const t = syncTokenOf(ref, ctx.pageContext, newTokens);
      if (!t || !after.has(t)) { errors.push(`${label}: sync: ${JSON.stringify(String(ref).slice(0, 20))} is not a page of the report — p1, p2… as listed under Pages, new1, new2… for the pages this call adds`); continue; }
      if (t !== token && !tokens.includes(t)) tokens.push(t);
    }
    decisions.push({ page: token, dim, pages: tokens });
  }
  const sync = checkSync([...after.values()], decisions, { effective: ctx.effective, confirmed: !!ctx.filterSyncConfirmed, requireReport: !!ctx.requireReport });

  const widgets = pages.flatMap((p) => [...p.add, ...p.replace.map((r) => r.widget)]);
  // The tallest page sets the report's page height, moves included.
  const pageHeight = Math.max(ctx.page.height, ...pages.map((p) => pageHeightOf([...p.add, ...p.moves.map((m) => ({ layout: m }))], ctx.page)));
  if (!pages.length && !measured.measures.length && !title) return { payload: null, errors, warnings, notes: sync.notes, syncIssue: null };
  return {
    payload: { kind: 'reportChanges', summary: text(a.summary, 500), pages, measures: measured.measures, ...(title ? { title } : {}), ...(sync.filterSync.length ? { filterSync: sync.filterSync } : {}), measureOverrides: formatOverrides(widgets, ctx.effective), pageHeight },
    errors,
    warnings,
    notes: sync.notes,
    syncIssue: sync.undecided.length || sync.unconfirmed ? sync : null,
  };
}

// The pages as the prompt names them, for the model to point at.
function pageLines(pageContext) {
  const others = (pageContext.otherPages || []).map((p, i) => `p${i + 2} = ${JSON.stringify(p.name || `Page ${i + 2}`)}`);
  return `Pages: p1 = ${JSON.stringify(pageContext.pageName || 'the page shown')} (shown)${others.length ? `, ${others.join(', ')}` : ''}.`;
}

module.exports = { validateReportChanges, composePage, pageLines, MAX_PAGES_TOUCHED };
