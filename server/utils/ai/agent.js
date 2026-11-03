// The assistant's turn: a bounded loop of provider calls. The model may read
// the cache as many times as the budget allows; the turn ends when it answers
// in plain text or hands over a proposal.

const providers = require('./providers');
const { outsideCritique } = require('./critique');
const tools = require('./tools');
const { buildSystemPrompt } = require('./prompt');
const { toPromptSchema, businessLines } = require('./effectiveModel');
const { getCoverage } = require('./cacheCoverage');
const { queryCached, queryLive } = require('./cachedQuery');
const { sharesCachedData } = require('../settingsHelper');
const { dimensionCardinality } = require('./cardinality');
const { helpTopics, readHelp } = require('./help');
const { validateWidgetsProposal, validateDesignProposal, validateVisualProposal } = require('./validateProposal');
const { layoutNew, pageHeightOf, COMPOSITIONS } = require('./arrangeLayout');
const { validateActionProposal, ACTIONS_FOR } = require('./actions');
const { guidedLines, validateQuestion, validateUnderstood } = require('./guidedPath');
const { formatOverrides, colorWidgets } = require('./dress');
const { swatchesOf, talkColorsOf } = require('./talkTheme');
const { validateReportChanges } = require('./reportChanges');
const { validateMeasures } = require('./reportMeasures');
const { validateRemember } = require('./remember');
const { layoutIssues } = require('./layoutIssues');
const { checkSync, reportDecisions, syncConfirmed, syncQuestionError, filterDim } = require('./filterSync');
const { openMetadataKit } = require('./openMetadataTools');

const MAX_ITERATIONS = 6;
// Rows of each cache read handed back to the client, which replays them in the
// next turns of the session: the model reads "these clients" again instead of
// guessing them. The rest of a read served its turn.
const MAX_KEPT_ROWS = 50;
// What a miss means, said once, in the result the model reads: without it, a
// model tries one combination after another until the budget is spent.
const NOT_CACHED = 'Not in the cache. You can only read data the cache holds — the combinations under "Cached data". Do not try other combinations to get around it: propose the visual, the app draws it from the source.';
// Argument keys of the proposal tools, as they look once typed into prose.
const WRITTEN_PROPOSAL = /"(widgets|binding|selectedMeasures|ops|visualJs)"\s*:/;
// The question of a review turn (the studio, after a change was applied; the
// browser sends the page before and after). Asked by Jonathan: the assistant
// should look at the whole page and say when what it did is bad, as a person
// would — so it is shown the result and asked, every time.
const REVIEW_PROMPT = 'Here is the page BEFORE (first image) and AFTER (second image) the change you proposed was applied. Look at the whole page as its reader would: reading order, what leads, empty cards, squashed visuals, anything cut off, the balance of the rows. Then look at it as the demanding designer you are: would you sign it? Generic, flat or plain ugly is a flaw to fix like a title cut off — not a matter of taste to leave alone. Values may be hidden behind stripes: judge the layout and the look, not the figures. Answer in one or two sentences in the user\'s language. If the page is as good or better and something you would still watch can be fixed by the look or the layout (a filter card stretched to a figure\'s height, edges out of line, a page that reads unevenly, a look any dashboard could have), fix it now with one proposal, as the dashboard designer you are — your principles before any rule — unless the user turned that very fix down in this conversation; a fix you proposed that left the flaw in place is no reason to stop, but never propose again the arrangement just applied: boxes snap to a 20 px grid, and a gap or a width one grid step off is the grid, not a flaw. Otherwise say it in a sentence and stop. If it is WORSE, say plainly what went wrong, then either fix it (call the proposal tool again with the correction) or, when no proposal can fix it, call undo_change. Visuals that showed figures BEFORE and are empty AFTER mean the change broke the data, not the layout: moving or resizing anything fixes nothing — call undo_change and say why, unless the same call can correct what emptied them (the measure itself). Never ask the user for a fact about their data to repair your change.';
// A whole report built from the conversation was never looked at by the
// designer: its pages kept the defaults, and Jonathan found the reports plain
// ("je croyais qu'on avait dit à l'agent design de prendre en main en
// priorité"). Its first page goes back with this, for the look of all pages.
const REVIEW_NEW_REPORT = "Here is the first page of the report you just built, as its reader sees it; the other pages were laid out the same way. The pages carry the app's defaults, not a look. Now, as the dashboard designer you are — your principles before any rule — give the WHOLE report its look in one propose_design_changes for every page: the colors (a scheme that suits the trade, frame true), the fonts, the hierarchy of figures and labels, which cards keep a border or a shadow, the page background, and the page menu (op page_nav: its place, colors, font, an icon per page) — in ONE direction chosen for this trade and this brand (reading.style), never the default recipe. Fix in the same proposal what the layout of this page still needs. Then say in one sentence, in the user's language, what look you gave it. A page that is broken (empty visuals, cut off) comes first: say it and fix that instead. The user validates the card; if this conversation shows the user already chose or turned down a look, keep theirs and only fix what is broken.";
const REVIEW_NEW_PAGE = 'Here is the page your change created, as its reader sees it. Judge it as they would: reading order, what leads, empty cards, squashed visuals, anything cut off, the balance of the rows. Then look at it as the demanding designer you are: would you sign it? Generic, flat or plain ugly is a flaw to fix like a title cut off — not a matter of taste to leave alone. Values may be hidden behind stripes: judge the layout and the look, not the figures. Answer in one or two sentences in the user\'s language. Good: fix what the look or the layout can still improve with one proposal, as the dashboard designer you are — or say there is nothing, and stop. Not good: say plainly what is wrong, then fix it (call the proposal tool again with the correction) or, when no proposal can fix it — visuals empty because a measure cannot be read — call undo_change. Never ask the user for a fact about their data to repair your change.';

// A logo the user added is on the page now, and the browser read its colors:
// the report is offered them, on a design card the user validates (asked by
// Jonathan). Said on the review turn — one card per turn, and the change that
// placed the logo had its own. The page shows an image; nothing is read in
// the user's words.
// The last picture of a review that reached several pages: the whole report.
const SHEET_NOTE = ' The LAST picture shows every page of the report in small: judge the report whole too — do its pages hold together, does it repeat itself, does it look like this brand or like any dashboard?';
// Reviews follow one another as long as each proposes a card: with an outside
// eye that always finds something, the designer turned the bars horizontal,
// then vertical again, the figures 52 px then 44 (CARDIO-PREV). Two rounds of
// polish after a request, then only what is broken.
const REVIEWED = '[You were shown the page before and after';
function reviewsInRow(messages) {
  let n = 0;
  for (let i = messages.length - 2; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'user') continue;
    if (!String(m.text || '').startsWith(REVIEWED)) break;
    n += 1;
  }
  return n;
}
const MAX_POLISH = 2;
const STEADY_NOTE = ' Never reverse a choice made earlier in this conversation (a bar direction, a size, a color) unless the reader is clearly worse off with it: going back and forth is not designing.';
const enoughNote = (n) => ` This is review ${n + 1} in a row since the user last asked for something: the page has been polished enough. Propose only to repair something broken or clearly worse than before; otherwise say in one sentence that it is done, and stop.`;
// What the outside eye said (utils/ai/critique.js), an opinion to weigh.
const critiqueNote = (said) => (said ? ` An outside art director, who did not make this page, was shown it and said: «${said.replace(/«|»/g, '"')}» Weigh it with your own eye: act on what you agree with, and say in a few words what you set aside and why.` : '');

function logoColorsNote(page, assets) {
  const colored = assets.filter((a) => Array.isArray(a.colors) && a.colors.length);
  if (!colored.length || !((page && page.widgets) || []).some((w) => w.type === 'image')) return '';
  const named = colored.map((a) => `${a.name}: ${a.colors.join(', ')}`).join('; ');
  return ` The page now shows an image the user added, whose colors are ${named}. Unless the report already takes its colors from it, or you already offered them in this conversation, now, as the designer you are, call propose_design_changes with the report's whole look built on that logo: its leading color as baseColor, its other strong color as accentColor, frame true, the colorScheme that suits it — and, in the same proposal, everything else your principles call for: fonts, the hierarchy of figures and labels, which cards keep a border, shadows, the page. The whole report, a summary that names the image — and say in one sentence that the look comes from the logo. The user validates the card; one that offered them already, applied or dismissed, is never offered again. Only after the page itself is judged sound: a page made worse comes first.`;
}

// The history carries past cards as bracketed digests (client aiProposal.
// describeProposal: "[Asked the user: …]", "[Proposed …]"); a model sometimes
// echoes one into its own answer, where the user read it as is (seen with Karim).
const DIGEST_LINE = /^\s*\[(Asked the user|Proposed|Offered|Applied|Added)\b[^\n]*\]\s*$/gm;
const withoutDigests = (text) => text.replace(DIGEST_LINE, '').replace(/\n{3,}/g, '\n\n').trim();

// Every report came out with the same skeleton and the same three charts
// (Jonathan: "chacun de tes rapports se ressemble"). A report of three pages
// or more goes back once when its pages share one composition, or when it
// draws with bars, lines and figures only.
const PLAIN_TYPES = new Set(['scorecard', 'bar', 'line', 'table', 'filter', 'text', 'shape', 'image']);
function sameEverywhere(raw, pages) {
  if (pages.length < 3) return [];
  const out = [];
  const compositions = new Set(raw.map((p) => (p && p.composition) || 'standard'));
  if (compositions.size < 2) out.push('every page has the same composition: choose the layout of each page for what it says (hero for one story, sidebar to explore, grid for comparable panels, focus for a trend and its breakdowns)');
  if (pages.every((p) => p.widgets.every((w) => PLAIN_TYPES.has(w.type)))) out.push('the report draws only with bars, lines, figures and tables: answer with the visual each question calls for — a gauge for a figure against its target, a combo for actual against target over time, a pie as a funnel for stages that lose volume, a pivot as a heatmap for two dimensions crossed, a waterfall for how a figure is built, a treemap or a donut for a mix, a scatter for two measures against each other, horizontal bars for a ranking');
  return out;
}

// Each proposal tool → its validator, returning what goes to the client
// (`payload`, null when nothing survived) and what was refused (`errors`).
const PROPOSERS = {
  propose_widgets(args, givenCtx) {
    // A conversation with no report (Ask, Let's Talk) defines the measures its
    // visuals need here. Their closed arguments travel too: the route that adds
    // a visual to a report compiles them again, never trusting a compiled one.
    const measured = givenCtx.mode === 'ask' && Array.isArray(args && args.measures) ? validateMeasures(args.measures, givenCtx) : { measures: [], errors: [] };
    const ctx = measured.measures.length ? { ...givenCtx, effective: { ...givenCtx.effective, measures: [...givenCtx.effective.measures, ...measured.measures] } } : givenCtx;
    const checked = validateWidgetsProposal(args, ctx);
    const errors = [...measured.errors, ...checked.errors];
    // What it understood travels on the card for the user to read and
    // correct; a wrong id there is dropped, never a reason to withhold visuals.
    const read = validateUnderstood(args, ctx);
    const warnings = [...(checked.warnings || []), ...read.warnings];
    // With no page to look at, the model is not asked where things go.
    const laid = ctx.mode === 'ask' ? layoutNew(checked.widgets, ctx.page, ctx.effective) : checked.widgets;
    // Colored where the assistant composes the page (Ask, the studio); in the
    // editor a new visual follows the report's theme like its neighbours.
    // Let's Talk draws with Open Report's colors or the user's theme (talkTheme.js).
    const widgets = ctx.mode === 'ask' || ctx.allowReport ? colorWidgets(laid, { theme: ctx.pageContext.theme, effective: ctx.effective, ...(ctx.colors || {}) }) : laid;
    // Formats for the measures the model leaves bare, merged into the
    // report's settings by whoever applies the card (dress.js).
    const measureOverrides = formatOverrides(widgets, ctx.effective);
    const measures = measured.measures.length ? { measures: measured.measures, ...(measured.errors.length ? {} : { measureArgs: args.measures }) } : {};
    // What the user taught about the fields (remember.js): a strip on the card, applied by their click.
    const learned = givenCtx.mode === 'ask' && Array.isArray(args && args.remember) ? validateRemember(args.remember, givenCtx.effective) : { items: [], errors: [] };
    warnings.push(...learned.errors);
    return { payload: widgets.length ? { kind: 'widgets', widgets, measureOverrides, pageHeight: pageHeightOf(widgets, ctx.page), ...measures, ...(read.understood ? { understood: read.understood } : {}), ...(learned.items.length ? { remember: learned.items } : {}), ...colorsTag(ctx) } : null, errors, warnings };
  },
  ask_user(args, ctx) {
    const { payload, errors } = validateQuestion(args, ctx);
    return { payload, errors };
  },
  // A whole report: each page checked and laid out like one Ask answer. A
  // page with nothing valid on it is dropped; the report needs one page left.
  propose_report(args, givenCtx) {
    const a = args && typeof args === 'object' ? args : {};
    const title = typeof a.title === 'string' && a.title.trim() ? a.title.trim().slice(0, 120) : 'Report';
    const raw = Array.isArray(a.pages) ? a.pages.slice(0, tools.MAX_PAGES) : [];
    // The measures the pages need, first (a service rate asked with the
    // report was only offered for later: this tool could not define one).
    const measured = validateMeasures(a.measures, givenCtx);
    const ctx = measured.measures.length ? { ...givenCtx, effective: { ...givenCtx.effective, measures: [...givenCtx.effective.measures, ...measured.measures] } } : givenCtx;
    const errors = raw.length ? [...measured.errors] : ['pages: one page at least', ...measured.errors];
    const warnings = [];
    const pages = [];
    // Each page's filters and their `sync`, by the page's index in the payload.
    const filtered = [];
    raw.forEach((p, i) => {
      const checked = validateWidgetsProposal({ widgets: p && p.widgets }, ctx);
      const name = typeof (p && p.name) === 'string' && p.name.trim() ? p.name.trim().slice(0, 60) : `Page ${i + 1}`;
      errors.push(...checked.errors.map((e) => `${name}: ${e}`));
      warnings.push(...(checked.warnings || []).map((w) => `${name}: ${w}`));
      // The composition the model chose for this page (arrangeLayout.COMPOSITIONS); standard otherwise.
      const composition = COMPOSITIONS.includes(p && p.composition) ? p.composition : 'standard';
      if (!checked.widgets.length) return;
      const filters = checked.widgets.map((w, k) => ({ dim: filterDim(w), sync: ((p.widgets || [])[checked.accepted[k]] || {}).sync })).filter((f) => f.dim)
        .map((f) => (typeof f.sync === 'boolean' ? f : { dim: f.dim }));
      filtered.push({ token: pages.length, name, filters });
      pages.push({ name, widgets: colorWidgets(layoutNew(checked.widgets, ctx.page, ctx.effective, composition), { theme: ctx.pageContext.theme, effective: ctx.effective, ...(ctx.colors || {}) }) });
    });
    // Filters on one field on several pages: synced or not, as the user said (filterSync.js).
    const sync = checkSync(filtered.map((p) => ({ ...p, filters: p.filters.map((f) => ({ dim: f.dim, fresh: true })) })), reportDecisions(filtered), {
      effective: ctx.effective, confirmed: !!ctx.filterSyncConfirmed, requireReport: !!ctx.requireReport,
    });
    warnings.push(...sameEverywhere(raw, pages));
    const read = validateUnderstood(a, ctx);
    warnings.push(...read.warnings);
    const measureOverrides = formatOverrides(pages.flatMap((p) => p.widgets), ctx.effective);
    // The tallest page sets the report's page height.
    const pageHeight = Math.max(ctx.page.height, ...pages.map((p) => pageHeightOf(p.widgets, ctx.page)));
    return {
      payload: pages.length ? { kind: 'report', title, pages, measures: measured.measures, measureOverrides, pageHeight, ...colorsTag(ctx), ...(sync.filterSync.length ? { filterSync: sync.filterSync } : {}), ...(read.understood ? { understood: read.understood } : {}) } : null,
      errors,
      warnings,
      notes: sync.notes,
      syncIssue: sync.undecided.length || sync.unconfirmed ? sync : null,
    };
  },
  // The report changed as a whole (the studio): the pages it touches, laid out.
  propose_report_changes(args, ctx) {
    if (!ctx.allowReport) return { payload: null, errors: ['propose_report_changes is for the AI studio: here, propose the visuals of this page with propose_widgets'] };
    return validateReportChanges(args, ctx);
  },
  // A review turn's verdict that the change was a mistake: a card to take it back.
  undo_change(args, ctx) {
    if (!ctx.review) return { payload: null, errors: ['undo_change is only for the review of a change just applied'] };
    const reason = typeof (args && args.reason) === 'string' ? args.reason.trim().slice(0, 300) : '';
    return { payload: { kind: 'undo', reason }, errors: [] };
  },
  propose_design_changes(args, ctx) {
    const { summary, advice, colorScheme, ops, errors, warnings, notes, pageHeight } = validateDesignProposal(args, ctx);
    // Advice with nothing to apply is still worth the author's time: it then
    // travels as text instead of on a card that would have no button.
    if (!ops.length) return { payload: null, errors, warnings, text: advice.join('\n') };
    // The page height the boxes need, when they run past the page.
    return { payload: { kind: 'design', summary, advice, colorScheme, ops, ...(pageHeight > ctx.page.height ? { pageHeight } : {}) }, errors, warnings, notes };
  },
  propose_action(args, ctx) {
    const allowed = ACTIONS_FOR[ctx.mode === 'ask' ? 'ask' : 'editor'];
    // What the user taught about the fields, with no visual to go with it.
    if (args && args.action === 'remember_fields' && allowed.includes('remember_fields')) {
      const { items, errors } = validateRemember(args.remember, ctx.effective);
      if (!items.length) return { payload: null, errors: errors.length ? errors : ['remember_fields needs `remember`: the fields and what the user said of them'] };
      const summary = typeof args.summary === 'string' ? args.summary.slice(0, 200) : '';
      return { payload: { kind: 'action', action: 'remember_fields', summary, remember: items, modelId: ctx.modelId }, errors };
    }
    const { action, errors } = validateActionProposal(args, { canEditModel: ctx.canEditModel, fileModel: ctx.fileModel, sourceLabel: ctx.sourceLabel, allowed });
    if (!action) return { payload: null, errors };
    // The model to open, or to build the report on, is the one of the
    // conversation, never a name the model chose.
    if (action.action === 'open_model_assistant' || action.action === 'create_report' || action.action === 'add_file_to_model') return { payload: { kind: 'action', ...action, modelId: ctx.modelId }, errors };
    // The card shows the colors it would give, on the surface the user reads on.
    if (action.action === 'talk_colors') {
      return { payload: { kind: 'action', ...action, swatches: swatchesOf(action.theme || talkColorsOf(null), ctx.pageContext.theme) }, errors };
    }
    // Which report it is for: the one open in the editor; in Ask, the user
    // picks it on the card (`null` here).
    return { payload: { kind: 'action', ...action, reportId: ctx.reportId || null }, errors };
  },
  propose_custom_visual(args, ctx) {
    // Refused here too, not only left out of the toolset: a model can call a
    // tool it was never offered.
    if (!ctx.canWriteVisuals) return { payload: null, errors: ['Writing a visual needs a workspace admin'] };
    const { visual, errors } = validateVisualProposal(args, ctx);
    // No page in Ask: the size is the server's, as for any other visual there.
    if (visual && ctx.mode === 'ask') {
      [{ layout: visual.layout }] = layoutNew([{ type: 'customVisual', config: { title: visual.manifest.name }, dataBinding: visual.dataBinding }], ctx.page, ctx.effective);
    }
    return { payload: visual ? { kind: 'customVisual', ...visual } : null, errors };
  },
};

/**
 * The page as the model sees it: widgets named w1, w2… instead of their
 * UUIDs. A layout names every widget of the page; eleven 36-character ids in a
 * nested tool call is where a provider's JSON generation breaks (measured:
 * two requests in three failed at the provider). `realId` translates a
 * proposal back before it leaves.
 */
function withAliases(pageContext) {
  const real = new Map();
  const widgets = pageContext.widgets.map((w, i) => {
    real.set(`w${i + 1}`, w.id);
    return { ...w, id: `w${i + 1}` };
  });
  return { aliased: { ...pageContext, widgets }, realId: (alias) => real.get(alias) || alias };
}

// The ranking of the previous answer, read back from the digest of its
// proposal that the conversation carries (our own JSON, not the user's words).
// Its field is only ever looked up in the model (shapeWidget).
const RANK_IN_DIGEST = /"field":"([^"]{1,200})","isMeasure":true,"op":"(top_n|bottom_n)","value":(\d{1,3})\b/;
function previousRankIn(messages) {
  const before = messages.length >= 2 ? messages[messages.length - 2] : null;
  const m = before && before.role === 'assistant' ? RANK_IN_DIGEST.exec(before.text || '') : null;
  return m ? { field: m[1], op: m[2], n: Number(m[3]) } : null;
}

// What the model says the request asks for — its `reading`, written with the
// proposal. Understanding the request is the model's job, in any language; the
// server holds the proposal to that reading. Replaces lists of French and
// English words that read the request here and missed every other language.
function widgetReading(args, effective, messages) {
  const r = args && args.reading && typeof args.reading === 'object' ? args.reading : {};
  const dims = new Set(effective.dimensions.map((d) => d.name));
  const measures = new Set(effective.measures.map((m) => m.name));
  const breakdownBy = (Array.isArray(r.breakdownBy) ? r.breakdownBy : []).filter((n) => typeof n === 'string' && dims.has(n)).slice(0, 4);
  const k = r.ranking && typeof r.ranking === 'object' ? r.ranking : null;
  const n = Math.floor(Number(k && k.n));
  const rank = k && n >= 1 && (k.direction === 'top' || k.direction === 'bottom')
    ? { n: Math.min(n, 100), op: k.direction === 'top' ? 'top_n' : 'bottom_n', ...(measures.has(k.by) ? { by: k.by } : {}) }
    : null;
  const keepRank = r.sameMembersAsBefore === true ? previousRankIn(messages) : null;
  return { breakdownBy, rank, keepRank };
}

// Did the assistant already ask the user something in this conversation? Read
// from the digest of its own questions that the conversation carries (our own
// format, never the user's words): a whole report is not proposed before the
// user was asked which pages they want.
const ASKED = /\[Asked the user:/;
const askedBefore = (messages) => messages.some((m) => m.role === 'assistant' && ASKED.test(m.text || ''));

// `reading.scope` (precise | view | report) decides which proposal tool ends
// the turn in Ask: a whole report is several pages, never six visuals on one.
function mismatchedScope(call) {
  const scope = call.args && call.args.reading && call.args.reading.scope;
  if (call.name === 'propose_widgets' && scope === 'report') return 'Your reading says the user asked for a WHOLE report: call propose_report instead, one page per objective of the domain whose roles are present (the overview first), with the same widgets per page.';
  if (call.name === 'propose_report' && scope && scope !== 'report') return `Your reading says the request is ${scope === 'precise' ? 'precise' : 'a view on one topic'}: call propose_widgets instead, on one page.`;
  return null;
}

// In Design, what the request allows to change. Left out, the narrow reading:
// a change read too narrowly costs one more message, one read too widely
// undoes work nobody asked to have touched.
function designReading(args) {
  const r = args && args.reading && typeof args.reading === 'object' ? args.reading : {};
  return { scope: { layout: r.layout === true, scheme: r.colors === true, theme: r.theme === true }, style: typeof r.style === 'string' ? r.style : null };
}

function withRealIds(payload, realId) {
  if (payload.kind === 'reportChanges' && Array.isArray(payload.pages)) {
    return {
      ...payload,
      pages: payload.pages.map((p) => ({
        ...p,
        removeWidgets: p.removeWidgets.map(realId),
        replace: p.replace.map((r) => ({ ...r, widgetId: realId(r.widgetId) })),
        moves: p.moves.map((m) => ({ ...m, widgetId: realId(m.widgetId) })),
      })),
    };
  }
  if (!Array.isArray(payload.ops)) return payload;
  return { ...payload, ops: payload.ops.map((op) => (op.widgetId ? { ...op, widgetId: realId(op.widgetId) } : op)) };
}

/**
 * @returns {Promise<{reply: string, proposals: object[]}>}
 */
/**
 * @param {boolean} allowReport    the studio: a whole report may be proposed on an open report
 * @param {boolean} requireReport  the user PRESSED "Build the full report": only a report (or a question on the way to it) may end the turn
 */
// What an answer of Let's Talk was colored with: the browser draws it again
// when the user's theme or the app's (dark / light) changes.
const colorsTag = (ctx) => (ctx.colors ? { colors: { ...ctx.colors, theme: ctx.pageContext.theme === 'dark' ? 'dark' : 'light' } } : {});

async function runChat({ config, user, orgId, report, effective, messages: given, pageContext: realPage, mode = 'report', canWriteVisuals = false, canEditModel = false, fileModel = false, sourceLabel = 'its data source', library = [], allowReport = false, requireReport = false, review = false, sheet = false, assets = [], talk = false, colors = null, openMetadata = null }, deps = {}) {
  // A review turn: the last message carries the page before and after an
  // applied change; its words are ours, so the question is always the same.
  // One picture: the page the change created, with no before to compare.
  const lastTurn = given[given.length - 1] || {};
  const { aliased: pageContext, realId } = withAliases(realPage);
  // What the app measured on the page after the change, by the ids the model reads.
  const measured = layoutIssues(pageContext);
  const flaws = measured.length ? ` Measured by the app on the page as it is now (trust these over the picture): ${measured.join(' ')} Fix them in your proposal, as the designer, unless the user turned that fix down.` : '';
  const pictures = lastTurn.images || [];
  // A review of a change (not the first look of a report, which judges defaults): the outside eye first.
  const inRow = review === true ? reviewsInRow(given) : 0;
  const polished = inRow >= MAX_POLISH;
  const said = review === true && !polished ? await outsideCritique({ config, images: pictures, sheet }, deps) : '';
  const pagePictures = pictures.length - (sheet ? 1 : 0);
  const reviewText = `${review === 'report' ? REVIEW_NEW_REPORT : pagePictures === 1 ? REVIEW_NEW_PAGE : REVIEW_PROMPT}${sheet ? SHEET_NOTE : ''}${review === true ? STEADY_NOTE : ''}${polished ? enoughNote(inRow) : ''}${flaws}${critiqueNote(said)}${logoColorsNote(realPage, assets)}`;
  const messages = review ? [...given.slice(0, -1), { ...lastTurn, text: reviewText }] : given;
  const chat = deps.chat || providers.chat;
  const canQueryData = sharesCachedData(config.dataSharing);
  // Let's Talk may read the source as the user when the admin allows it
  // (settingsHelper 'schema+results'): its questions are ad hoc, a cache only
  // holds what reports group by.
  const readsLive = talk && mode === 'ask' && config.dataSharing === 'schema+results';
  const hasDate = effective.dimensions.some((d) => /date|time/i.test(String(d.type || '')));
  // Two modes: `ask`, a conversation about a model with no page (the
  // Assistant panel), and `report`, beside an open report — one conversation
  // for its visuals AND its look: the request says which tool answers it,
  // the author no longer picks a mode first (asked by Jonathan).
  const ask = mode === 'ask';
  const proposalTools = [tools.widgetsToolFor({ library, withLayout: !ask, hasDate, assets, decor: !ask, measures: ask })];
  if (!ask) proposalTools.push(tools.PROPOSE_DESIGN_CHANGES);
  if (canWriteVisuals) proposalTools.push(tools.PROPOSE_CUSTOM_VISUAL);
  // A whole report is made where there is none yet (the Assistant panel), or
  // in the studio, whose pages the browser appends to the open report.
  const wholeReport = ask || allowReport;
  if (wholeReport) proposalTools.push(tools.reportToolFor({ library, hasDate }));
  // The studio: the report itself may be changed — visuals replaced, removed,
  // placed, pages added — its look through the design tool only.
  const studio = !ask && allowReport;
  if (studio) proposalTools.push(tools.reportChangesToolFor({ library, hasDate, assets }));
  // Reviewing a change it proposed: it may also take it back.
  if (studio && review) proposalTools.push(tools.UNDO_CHANGE);
  proposalTools.push(ask ? tools.actionToolFor(ACTIONS_FOR.ask) : tools.PROPOSE_ACTION, tools.ASK_USER);
  // "How do I…?" is asked in every mode: the user guide is one tool away.
  const topics = helpTopics();
  const helpTool = topics.length ? tools.helpToolFor(topics) : null;
  // The data catalog, when the admin linked one: where a field comes from.
  const catalog = review ? await openMetadataKit({}) : await openMetadataKit({
    om: openMetadata,
    modelId: report.model_id,
    reportId: report.id,
    reportOwn: new Set([...((report.settings || {}).extraMeasures || []), ...((report.settings || {}).extraDimensions || [])].map((f) => f && f.name)),
    fields: [...effective.dimensions, ...effective.measures],
  }, deps);
  const toolset = [
    ...(readsLive ? [tools.QUERY_DATA] : canQueryData ? [tools.QUERY_CACHED_DATA] : []),
    ...proposalTools,
    ...(helpTool ? [helpTool] : []),
    ...catalog.tools,
  ];
  const otherMode = new Set(ask ? ['propose_design_changes', 'propose_report_changes'] : (wholeReport ? [] : ['propose_report', 'propose_report_changes']));
  const coverage = (deps.getCoverage || getCoverage)({ modelId: report.model_id, orgId });
  const cardinality = !coverage.length
    ? {}
    : await (deps.dimensionCardinality || dimensionCardinality)({ user, orgId, report, effective, coverage }, deps);
  const schema = toPromptSchema(effective);
  // Counts are data: they go to the provider only where cached data may.
  if (canQueryData) {
    for (const d of schema.dimensions) {
      const c = cardinality[d.name];
      if (c) d.values = c.more ? `${c.n}+` : c.n;
    }
  }
  const system = buildSystemPrompt({
    reportTitle: report.title,
    schema,
    coverage,
    pageContext,
    mode,
    canQueryData,
    readsLive,
    canWriteVisuals,
    canEditModel,
    fileModel,
    sourceLabel,
    library,
    hasDate,
    helpTopics: topics,
    businessLines: businessLines(effective),
    guidedLines: guidedLines(effective),
    studio,
    assets,
    talk: talk && mode === 'ask',
  }).concat(catalog.lines.map((l) => `\n${l}`).join(''));
  const page = { width: pageContext.pageWidth, height: pageContext.pageHeight };

  // The turn's state, shared with the tool handler below: one repair round; a
  // whole report once tried is not traded for one page; a proposal taken ends
  // the turn; the cache reads are handed back to the client.
  let repaired = false;
  let nudged = false;
  // One turn back to ask the user about filters synced across pages, at most.
  let syncAsked = false;
  let reportTried = false;
  let proposal = null;
  const reads = [];
  const done = (answer) => {
    const reply = typeof answer.reply === 'string' ? withoutDigests(answer.reply) : answer.reply;
    return reads.length ? { ...answer, reply, reads } : { ...answer, reply };
  };

  // One tool call of the model, whichever engine takes the steps (providers.runTurn).
  const execute = async (call) => {
    let result;
    if (call.argsError) {
      if (call.name === 'propose_report' && wholeReport) reportTried = true;
      result = { error: call.name === 'propose_report' ? `${call.argsError}. Call propose_report again with fewer pages or fewer widgets per page — not propose_widgets.` : call.argsError };
    } else if (call.name === 'read_help' && helpTool) {
      result = readHelp(call.args && call.args.topics);
    } else if (catalog.handles(call.name)) {
      result = await catalog.execute(call);
    } else if ((call.name === 'query_cached_data' && canQueryData && !readsLive) || (call.name === 'query_data' && readsLive)) {
      // The figures an answer defines are read before they are drawn:
      // compiled here like those of propose_widgets, never the model's SQL.
      const defined = readsLive && Array.isArray(call.args && call.args.define) ? validateMeasures(call.args.define, { effective, cardinality }) : null;
      if (defined && defined.errors.length) {
        result = { error: defined.errors.join('; ') };
      } else {
        const readModel = defined && defined.measures.length
          ? { ...effective, measures: [...effective.measures.filter((m) => !defined.measures.some((x) => x.name === m.name)), ...defined.measures] }
          : effective;
        result = readsLive
          ? await (deps.queryLive || queryLive)({ user, orgId, report, effective: readModel, args: call.args, extraMeasures: defined ? defined.measures : [] }, deps)
          : await queryCached({ user, orgId, report, effective, args: call.args }, deps);
      }
      if (result.miss) result = { ...result, note: NOT_CACHED };
      // Only what came back: a read that returned rows passed buildBody, so
      // its names are fields of the model.
      if (result.rows) {
        reads.push({
          dimensions: call.args.dimensions || [],
          measures: call.args.measures || [],
          ...(Array.isArray(call.args.filters) && call.args.filters.length ? { filters: call.args.filters } : {}),
          rows: result.rows.slice(0, MAX_KEPT_ROWS),
          truncated: result.truncated || result.rows.length > MAX_KEPT_ROWS,
          ...(readsLive ? { live: true } : {}),
        });
      }
    } else if (otherMode.has(call.name)) {
      // A model can call a tool it was never offered; the mode still holds.
      result = { error: ask ? `${call.name} is not available here: it needs a report open in the editor. Say so in one sentence.`
        : call.name === 'propose_report' ? 'propose_report is for the Assistant panel, where there is no report yet. Here, propose the visuals of THIS page with propose_widgets; a page is one objective.'
          : `${call.name} is not available here: it needs the AI studio. Say so in one sentence.` };
    } else if (wholeReport && (requireReport || reportTried) && (call.name === 'propose_widgets' || call.name === 'propose_custom_visual')) {
      // A button, not a reading: the user asked for the whole report in a
      // way no language can blur. Only propose_report may answer.
      result = { error: `${requireReport ? 'The user pressed "Build the full report"' : 'You were building a whole report'}: answer with propose_report (reading.scope "report"), one page per objective whose roles are present — never propose_widgets. Ask with ask_user first only if a domain or a needed column is missing.` };
    } else if (call.name === 'propose_report' && wholeReport && !requireReport && !askedBefore(messages)) {
      // A typed request for a report: which pages is the user's call, asked once.
      result = { error: 'Before proposing a whole report, ask the user which pages it should have: ask_user with multiple: true and the objectives of the domain as options (the ones missing a column marked). The pages are the objectives they pick. Ask about the domain first if the model declares none.' };
    } else if (PROPOSERS[call.name] && wholeReport && mismatchedScope(call)) {
      // The model read a whole report and proposed one page, or the reverse:
      // held to its own reading, as for everything else it declares.
      result = { error: mismatchedScope(call) };
    } else if (PROPOSERS[call.name]) {
      // A report the model meant (its reading says so) and got wrong is retried as a report.
      if (call.name === 'propose_report' && wholeReport) reportTried = true;
      const confirmed = syncConfirmed(messages, call.args);
      const checked = PROPOSERS[call.name](call.args, {
        effective, page, pageContext, canWriteVisuals, canEditModel, fileModel, sourceLabel, mode, library, cardinality, allowReport, review: studio && review, assets, reportId: report.id, modelId: report.model_id, colors,
        requireReport, filterSyncConfirmed: confirmed,
        ...(call.name === 'propose_design_changes' ? designReading(call.args) : widgetReading(call.args, effective, messages)),
      });
      // Filters on one field on several pages without the user's word on
      // syncing them: back once, to ask. After that, the card says what was left.
      const syncIssue = checked.syncIssue && !syncAsked ? checked.syncIssue : null;
      if (syncIssue) syncAsked = true;
      // One repair round: the model usually fixes a mistyped field name
      // once it is told which one. After that, keep what is valid.
      const problems = [...checked.errors, ...(checked.warnings || [])];
      const repair = problems.length && !repaired;
      if (repair) repaired = true;
      if (syncIssue || repair) {
        result = { error: [syncIssue ? syncQuestionError(syncIssue, confirmed) : '', repair ? `Fix these and call ${call.name} again: ${problems.join('; ')}` : ''].filter(Boolean).join(' ') };
      } else {
        proposal = checked;
        result = { ok: true };
      }
    } else {
      result = { error: `Unknown tool: ${String(call.name).slice(0, 40)}` };
    }
    return { result, end: !!proposal };
  };

  // Some models write the tool call out as JSON in their answer instead of
  // making it: the author gets a wall of text and nothing to apply. One push
  // back; the text is never parsed — a proposal only exists as a call.
  const onWords = (text) => {
    if (nudged || !WRITTEN_PROPOSAL.test(text)) return null;
    nudged = true;
    return `You wrote a proposal as text; the user cannot apply text. Call ${proposalTools[0].name} now, with the single best option — do not list alternatives or ask which one they prefer.`;
  };

  const turn = await providers.runTurn({ config, system, messages, tools: toolset, maxSteps: MAX_ITERATIONS, execute, onWords }, { ...deps, chat });
  if (proposal) {
    // Left out = refused and dropped. Check = kept, but worth a look before applying.
    // Not in Let's Talk: nothing is applied there, and these lines are written
    // to the assistant ("your reading says…"), not to whoever asked.
    const toCheck = [...(proposal.warnings || []), ...(proposal.notes || [])];
    const notes = talk && mode === 'ask' ? '' : [
      proposal.errors.length ? `\n\nLeft out: ${proposal.errors.join('; ')}` : '',
      toCheck.length ? `\n\nCheck before applying: ${toCheck.join('; ')}` : '',
    ].join('');
    return done({
      reply: [turn.text, proposal.text].filter(Boolean).join('\n\n').concat(notes).trim(),
      proposals: proposal.payload ? [withRealIds(proposal.payload, realId)] : [],
    });
  }
  if (turn.ended === 'empty') return done({ reply: 'The AI provider returned an empty answer. Try again, or rephrase the request.', proposals: [] });
  if (turn.ended === 'limit') return done({ reply: turn.text || 'I could not finish within the allowed number of steps. Try a narrower question.', proposals: [] });
  return done({ reply: turn.text || '', proposals: [] });
}

module.exports = {
  sameEverywhere, runChat, withAliases, MAX_ITERATIONS };
