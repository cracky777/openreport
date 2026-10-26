// Filters synced across pages, as the assistant proposes them. In the report a
// filter lists, in `config.syncPages`, the other pages that share its
// selection (client utils/syncedSlicers.js: per field, both ways, links chain).
//
// Asked by Jonathan: the assistant may sync filters, and whenever a proposal
// leaves filters on one field on several pages, synced or not is the user's
// call — confirmed with them before the proposal goes through. Whether it was
// is read from OUR digest of the conversation (the sync question the
// assistant asked, written by the client's describeProposal) or from the
// reading the model declares with its proposal; never from the user's words.

const SYNC_ASKED = /\[Asked the user about filter sync:/;

/** Did the assistant ask the sync question earlier in this conversation? */
const syncAskedBefore = (messages) => (messages || []).some((m) => m && m.role === 'assistant' && SYNC_ASKED.test(m.text || ''));

/** The user's word on syncing is in hand: asked by the sync question, or said by the user (the model's reading). */
function syncConfirmed(messages, args) {
  const reading = args && args.reading && typeof args.reading === 'object' ? args.reading : {};
  return syncAskedBefore(messages) || reading.filterSync === 'user_said';
}

const filterDim = (w) => (w && w.type === 'filter' && w.dataBinding && Array.isArray(w.dataBinding.selectedDimensions) ? w.dataBinding.selectedDimensions[0] || null : null);
const labelOf = (effective, dim) => (((effective && effective.dimensions) || []).find((d) => d.name === dim) || {}).label || dim;

/**
 * The sync decisions of a proposal, checked against the report as it would be
 * once applied.
 * @param {{ token: *, name: string, filters: { dim: string, fresh: boolean }[] }[]} pages
 *   every page of the report after the proposal; `fresh` = a filter the proposal adds
 * @param {{ page: *, dim: string, pages: *[] }[]} decisions
 *   what the proposal says: the filter on `dim` of page `page` shares its selection with `pages` ([] = its own)
 * @param {{ effective: object, confirmed: boolean, requireReport: boolean }} opts
 * @returns {{ filterSync: object[], undecided: string[], unconfirmed: boolean, notes: string[] }}
 *   `filterSync` = the decisions for the card and the browser (label and page
 *   names to say them in words); `undecided` = labels of the fields that need
 *   the user's word; `unconfirmed` = decisions made without it
 */
function checkSync(pages, decisions, { effective, confirmed, requireReport }) {
  const nameOf = new Map(pages.map((p) => [p.token, p.name]));
  const pagesWith = (dim) => pages.filter((p) => p.filters.some((f) => f.dim === dim)).map((p) => p.token);
  const touched = [...new Set(pages.flatMap((p) => p.filters.filter((f) => f.fresh).map((f) => f.dim)))];
  const all = [...decisions];
  const undecided = [];
  const notes = [];
  for (const dim of touched) {
    const where = pagesWith(dim);
    if (where.length < 2 || decisions.some((d) => d.dim === dim)) continue;
    const label = labelOf(effective, dim);
    if (requireReport) {
      // The user pressed "Build the full report" so as not to be asked
      // anything: one selection for the whole report is what a reader of a
      // report expects from the same filter on every page, and it is said.
      all.push({ page: where[0], dim, pages: where.slice(1) });
      notes.push(`the ${label} filter is on ${where.length} pages and they share one selection — untick "Sync with other pages" in a filter's settings to keep a page apart`);
    } else {
      undecided.push(label);
      notes.push(`the ${label} filter is on ${where.length} pages, each with its own selection — tick "Sync with other pages" in its settings to share one`);
    }
  }
  const filterSync = all.map((d) => {
    const synced = d.pages.length > 0;
    return {
      dim: d.dim,
      label: labelOf(effective, d.dim),
      page: d.page,
      pages: d.pages,
      synced,
      pageNames: [d.page, ...d.pages].map((t) => nameOf.get(t) || '').filter(Boolean),
    };
  });
  return { filterSync, undecided, unconfirmed: decisions.length > 0 && !confirmed && !requireReport, notes };
}

/**
 * A whole report's decisions (propose_report): a filter says `sync: true`
 * (one selection with the same field's filters on the report's other pages)
 * or `false` (its own). A field one filter syncs is synced on every page that
 * filters on it, but the pages whose filter says false.
 * @param {{ token: number, filters: { dim: string, sync?: boolean }[] }[]} pages
 * @returns {{ page: number, dim: string, pages: number[] }[]}
 */
function reportDecisions(pages) {
  const dims = [...new Set(pages.flatMap((p) => p.filters.map((f) => f.dim)))];
  const out = [];
  for (const dim of dims) {
    const at = (p) => p.filters.filter((f) => f.dim === dim);
    const where = pages.filter((p) => at(p).length);
    const said = where.flatMap(at).filter((f) => typeof f.sync === 'boolean');
    if (where.length < 2 || !said.length) continue;
    const apart = (p) => at(p).some((f) => f.sync === false);
    const group = said.some((f) => f.sync) ? where.filter((p) => !apart(p)).map((p) => p.token) : [];
    if (group.length >= 2) out.push({ page: group[0], dim, pages: group.slice(1) });
    for (const p of where) if (!group.includes(p.token)) out.push({ page: p.token, dim, pages: [] });
  }
  return out;
}

/** What the model is told when the user's word is missing: ask first, or write down what they answered. */
function syncQuestionError({ undecided, unconfirmed }, confirmed) {
  const fields = undecided.length ? undecided.join(', ') : 'these fields';
  const why = undecided.length
    ? `This proposal leaves filters on ${fields} on several pages without saying whether they share one selection.`
    : 'This proposal syncs or unsyncs filters across pages, and the user has not said so in this conversation.';
  if (confirmed && !unconfirmed) return `${why} The user answered the sync question: propose again with each of these filters' sync as they answered.`;
  return `${why} Do not decide it yourself: ask the user first, with ask_user (about: "filter_sync"), whether the filters on ${fields} should stay in sync across pages — one selection for every page — or each page keep its own. Then propose again with each filter's sync as they answered. If the user already said it in this conversation, write reading.filterSync "user_said" and their decision.`;
}

/**
 * The filters of the report on several pages, as the prompt shows them: the
 * model needs the current sync to keep it, change it or ask about it.
 */
function syncLines(pageContext) {
  const pages = [
    { ref: 'p1', id: pageContext.pageId, widgets: pageContext.widgets || [] },
    ...(pageContext.otherPages || []).map((p, i) => ({ ref: `p${i + 2}`, id: p.id, widgets: p.widgets || [] })),
  ];
  const refOf = new Map(pages.filter((p) => p.id).map((p) => [p.id, p.ref]));
  const byDim = new Map();
  for (const p of pages) {
    for (const w of p.widgets) {
      const dim = filterDim(w);
      if (!dim) continue;
      if (!byDim.has(dim)) byDim.set(dim, []);
      const linked = (Array.isArray(w.syncPages) ? w.syncPages : []).map((id) => refOf.get(id)).filter(Boolean);
      byDim.get(dim).push(`${p.ref} ${w.id}${linked.length ? ` synced with ${linked.join(', ')}` : ''}`);
    }
  }
  const lines = [...byDim].filter(([, list]) => list.length >= 2).map(([dim, list]) => `${dim}: ${list.join('; ')}`);
  return lines.length ? ['Filters on the same field on several pages (a sync goes both ways and chains; no sync = each page its own selection):', ...lines] : [];
}

module.exports = { checkSync, reportDecisions, syncConfirmed, syncAskedBefore, syncQuestionError, syncLines, filterDim, SYNC_ASKED };
