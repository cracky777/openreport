// The assistant's turn: a bounded loop of provider calls. The model may read
// the cache as many times as the budget allows; the turn ends when it answers
// in plain text or hands over a proposal.

const providers = require('./providers');
const tools = require('./tools');
const { buildSystemPrompt } = require('./prompt');
const { toPromptSchema } = require('./effectiveModel');
const { getCoverage } = require('./cacheCoverage');
const { queryCached } = require('./cachedQuery');
const { dimensionCardinality } = require('./cardinality');
const { helpTopics, readHelp } = require('./help');
const { validateWidgetsProposal, validateDesignProposal, validateVisualProposal } = require('./validateProposal');
const { layoutNew } = require('./arrangeLayout');
const { validateActionProposal } = require('./actions');

const MAX_ITERATIONS = 6;
// Rows of each cache read handed back to the client, which replays them in the
// next turns of the session: the model reads "these clients" again instead of
// guessing them. The rest of a read served its turn.
const MAX_KEPT_ROWS = 50;
// What a miss means, said once, in the result the model reads: without it, a
// model tries one combination after another until the budget is spent.
const NOT_CACHED = 'Not in the cache. You can only read data the cache holds — the combinations under "Cached data". Do not try other combinations to get around it: propose the visual, the app draws it from the source.';
// Four attempts in all: at the failure rate measured below, an author sees the
// "empty answer" message about once in fifty requests instead of once in three.
const MAX_EMPTY_RETRIES = 3;
// Argument keys of the proposal tools, as they look once typed into prose.
const WRITTEN_PROPOSAL = /"(widgets|binding|selectedMeasures|ops|visualJs)"\s*:/;

// Each proposal tool → its validator, returning what goes to the client
// (`payload`, null when nothing survived) and what was refused (`errors`).
const PROPOSERS = {
  propose_widgets(args, ctx) {
    const checked = validateWidgetsProposal(args, ctx);
    const { errors, warnings } = checked;
    // With no page to look at, the model is not asked where things go.
    const widgets = ctx.mode === 'ask' ? layoutNew(checked.widgets, ctx.page, ctx.effective) : checked.widgets;
    return { payload: widgets.length ? { kind: 'widgets', widgets } : null, errors, warnings };
  },
  propose_design_changes(args, ctx) {
    const { summary, advice, colorScheme, ops, errors, warnings } = validateDesignProposal(args, ctx);
    // Advice with nothing to apply is still worth the author's time: it then
    // travels as text instead of on a card that would have no button.
    if (!ops.length) return { payload: null, errors, warnings, text: advice.join('\n') };
    return { payload: { kind: 'design', summary, advice, colorScheme, ops }, errors, warnings };
  },
  propose_action(args, ctx) {
    const { action, errors } = validateActionProposal(args, { canEditModel: ctx.canEditModel });
    if (!action) return { payload: null, errors };
    // The model to open is the one of the conversation, never a name the
    // model chose.
    if (action.action === 'open_model_assistant') return { payload: { kind: 'action', ...action, modelId: ctx.modelId }, errors };
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

// In Design, what the request allows to change. Left out, the narrow reading:
// a change read too narrowly costs one more message, one read too widely
// undoes work nobody asked to have touched.
function designReading(args) {
  const r = args && args.reading && typeof args.reading === 'object' ? args.reading : {};
  return { scope: { layout: r.layout === true, scheme: r.colors === true, theme: r.theme === true } };
}

function withRealIds(payload, realId) {
  if (!Array.isArray(payload.ops)) return payload;
  return { ...payload, ops: payload.ops.map((op) => (op.widgetId ? { ...op, widgetId: realId(op.widgetId) } : op)) };
}

/**
 * @returns {Promise<{reply: string, proposals: object[]}>}
 */
async function runChat({ config, user, orgId, report, effective, messages, pageContext: realPage, mode = 'visuals', canWriteVisuals = false, canEditModel = false, library = [] }, deps = {}) {
  const { aliased: pageContext, realId } = withAliases(realPage);
  const chat = deps.chat || providers.chat;
  const canQueryData = config.dataSharing === 'schema+cache';
  const hasDate = effective.dimensions.some((d) => /date|time/i.test(String(d.type || '')));
  // The author says which job they want done. Offering both made a request
  // for a chart come back as a restyle (and the reverse), and a short toolset
  // is what keeps small models reliable at tool calling.
  const proposalTools = mode === 'design'
    ? [tools.PROPOSE_DESIGN_CHANGES]
    : [tools.widgetsToolFor({ library, withLayout: mode !== 'ask', hasDate })];
  if (mode !== 'design' && canWriteVisuals) proposalTools.push(tools.PROPOSE_CUSTOM_VISUAL);
  if (mode !== 'design') proposalTools.push(tools.PROPOSE_ACTION);
  // Design restyles; it has no use for the data, so no data tool either.
  // "How do I…?" is asked in every mode: the user guide is one tool away.
  const topics = helpTopics();
  const helpTool = topics.length ? tools.helpToolFor(topics) : null;
  const toolset = [
    ...(canQueryData && mode !== 'design' ? [tools.QUERY_CACHED_DATA] : []),
    ...proposalTools,
    ...(helpTool ? [helpTool] : []),
  ];
  const otherMode = new Set({ design: ['propose_widgets', 'propose_custom_visual'], ask: ['propose_design_changes'] }[mode] || ['propose_design_changes']);
  const coverage = (deps.getCoverage || getCoverage)({ modelId: report.model_id, orgId });
  // Design places what is already on the page and needs none of it.
  const cardinality = mode === 'design' || !coverage.length
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
    canWriteVisuals,
    canEditModel,
    library,
    hasDate,
    helpTopics: topics,
  });
  const page = { width: pageContext.pageWidth, height: pageContext.pageHeight };

  const convo = messages.map((m) => ({ role: m.role, text: m.text }));
  let repaired = false;
  let nudged = false;
  let emptyRetries = 0;
  let lastText = '';
  const reads = [];
  const done = (answer) => (reads.length ? { ...answer, reads } : answer);

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const turn = await chat({ config, system, messages: convo, tools: toolset }, deps);
    lastText = turn.text || lastText;
    if (!turn.toolCalls.length) {
      // Some models write the tool call out as JSON in their answer instead of
      // making it: the author gets a wall of text and nothing to apply. One
      // push back; the text is never parsed — a proposal only exists as a call.
      if (!nudged && WRITTEN_PROPOSAL.test(turn.text || '')) {
        nudged = true;
        convo.push({ role: 'assistant', text: turn.text });
        convo.push({ role: 'user', text: `You wrote a proposal as text; the user cannot apply text. Call ${proposalTools[0].name} now, with the single best option — do not list alternatives or ask which one they prefer.` });
        continue;
      }
      // Neither words nor a call. Measured against Mistral (mistral-large, 20
      // real requests): between one in three and two in three come back HTTP 200 with finish_reason "error" and zero
      // tokens — their generation failed, ours is fine. The same request sent
      // again goes through, so that is what happens: nothing is added to the
      // conversation, the model is not at fault. Shown as is, the panel would
      // stay blank and the author could not tell a failure from a slow answer.
      if (!(turn.text || '').trim()) {
        if (emptyRetries < MAX_EMPTY_RETRIES) {
          emptyRetries += 1;
          continue;
        }
        return done({ reply: 'The AI provider returned an empty answer. Try again, or rephrase the request.', proposals: [] });
      }
      return done({ reply: turn.text || '', proposals: [] });
    }

    convo.push({ role: 'assistant', text: turn.text, toolCalls: turn.toolCalls });
    let proposal = null;
    for (const call of turn.toolCalls) {
      let result;
      if (call.argsError) {
        result = { error: call.argsError };
      } else if (call.name === 'read_help' && helpTool) {
        result = readHelp(call.args && call.args.topics);
      } else if (call.name === 'query_cached_data' && canQueryData) {
        result = await queryCached({ user, orgId, report, effective, args: call.args }, deps);
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
          });
        }
      } else if (otherMode.has(call.name)) {
        // A model can call a tool it was never offered; the mode still holds.
        result = { error: mode === 'ask' ? `${call.name} is not available here: it needs a report open in the editor. Say so in one sentence.` : `${call.name} is not available in ${mode} mode. Tell the user to switch mode if that is what they need.` };
      } else if (PROPOSERS[call.name]) {
        const checked = PROPOSERS[call.name](call.args, {
          effective, page, pageContext, canWriteVisuals, canEditModel, mode, library, cardinality, reportId: report.id, modelId: report.model_id,
          ...(call.name === 'propose_design_changes' ? designReading(call.args) : widgetReading(call.args, effective, messages)),
        });
        // One repair round: the model usually fixes a mistyped field name
        // once it is told which one. After that, keep what is valid.
        const problems = [...checked.errors, ...(checked.warnings || [])];
        if (problems.length && !repaired) {
          repaired = true;
          result = { error: `Fix these and call ${call.name} again: ${problems.join('; ')}` };
        } else {
          proposal = checked;
          result = { ok: true };
        }
      } else {
        result = { error: `Unknown tool: ${String(call.name).slice(0, 40)}` };
      }
      convo.push({ role: 'tool', toolCallId: call.id, name: call.name, content: JSON.stringify(result), isError: !!result.error });
    }

    if (proposal) {
      // Left out = refused and dropped. Check = kept, but worth a look before applying.
      const notes = [
        proposal.errors.length ? `\n\nLeft out: ${proposal.errors.join('; ')}` : '',
        (proposal.warnings || []).length ? `\n\nCheck before applying: ${proposal.warnings.join('; ')}` : '',
      ].join('');
      return done({
        reply: [turn.text, proposal.text].filter(Boolean).join('\n\n').concat(notes).trim(),
        proposals: proposal.payload ? [withRealIds(proposal.payload, realId)] : [],
      });
    }
  }
  return done({ reply: lastText || 'I could not finish within the allowed number of steps. Try a narrower question.', proposals: [] });
}

module.exports = { runChat, withAliases, MAX_ITERATIONS };
