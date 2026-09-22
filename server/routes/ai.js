/**
 * AI assistant HTTP endpoints.
 *
 *   GET    /api/ai/status                    does THIS user have the assistant, on whose provider, and what may it read
 *   PUT    /api/ai/personal                  the user's own provider, when the instance has none
 *   POST   /api/ai/personal/test             try it
 *   DELETE /api/ai/personal                  forget it
 *   POST   /api/ai/reports/:reportId/chat    one assistant turn for a report
 *
 * Permission model: whoever may EDIT the report may talk to its assistant —
 * its answers are proposals to change that report. The assistant reads data
 * through /query with `cacheOnly`, as the requesting user (see
 * utils/ai/cachedQuery.js), so it can never see more than they can.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/auth');
const db = require('../db');
const cloudHooks = require('../cloudHooks');
const { parseModel } = require('../db/modelRow');
const { canWriteReport, canReadModel, canBuildOnModel, canWriteModel } = require('./reports');
const { canManageVisuals, canSeeVisuals } = require('./customVisuals');
const { libraryOf } = require('../utils/ai/visualLibrary');
const aiAccess = require('../utils/ai/access');
const aiProviders = require('../utils/ai/providers');
const aiTools = require('../utils/ai/tools');
const { buildEffectiveModel } = require('../utils/ai/effectiveModel');
const { runChat } = require('../utils/ai/agent');
const { pickDesignConfig } = require('../utils/ai/validateProposal');
const { withFloors } = require('../utils/ai/arrangeLayout');
const aiFeedback = require('../utils/ai/feedback');
const { cleanDraft, runModelChat } = require('../utils/ai/modelAssistant');

const router = express.Router();

const MAX_MESSAGES = 20;
// Room for the cache reads a turn replays (useAiChat.toWire).
const MAX_MESSAGE_CHARS = 8000;
const MAX_CONTEXT_WIDGETS = 60;
const MAX_CONTEXT_BYTES = 200 * 1024;
const SLUG = /^[a-z0-9][a-z0-9_-]{0,39}$/i;
const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;

// Every turn is paid for at the provider. Keyed per user: a shared office IP
// must not pool everyone into one bucket.
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user.id,
  skip: () => process.env.NODE_ENV === 'test',
  message: { error: 'Rate limit exceeded. Try again shortly.' },
});

// Who gets the assistant and on whose provider is decided in one place
// (utils/ai/access.js). The cloud build decides per organization instead, and
// has no personal providers.
function resolveAccess(req) {
  if (typeof cloudHooks.resolveAiConfig === 'function') {
    const config = cloudHooks.resolveAiConfig(req);
    const on = !!(config && config.enabled);
    return { config: on ? config : null, source: on ? 'instance' : null, reason: on ? null : 'off' };
  }
  return aiAccess.resolveForUser(req.user);
}

// Bringing one's own provider is for whoever is left without one: not when the
// assistant is off for the instance, not for a denied account, and pointless
// when the instance already provides it.
function mayBringOwn(access) {
  return access.reason === 'setup' || access.source === 'personal';
}

function safeJSON(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback; // malformed row — behave as if the field were empty
  }
}

function cleanMessages(raw) {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_MESSAGES) return null;
  const out = [];
  for (const m of raw) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.text !== 'string') return null;
    if (m.text.length > MAX_MESSAGE_CHARS) return null;
    // An assistant turn can have been a card and no words. Providers refuse an
    // assistant message with neither content nor tool call, and dropping it
    // would leave two user turns in a row, which some refuse as well.
    const text = m.role === 'assistant' && !m.text.trim() ? '(A proposal was shown to the user.)' : m.text;
    out.push({ role: m.role, text });
  }
  return out[out.length - 1].role === 'user' ? out : null;
}

// The editor's UNSAVED page, so the assistant sees what the author sees. Each
// widget is re-projected onto the keys the prompt needs: `data` (fetched rows)
// must not ride along, whatever the client sent.
const SHAPE = {
  slicerStyle: ['list', 'dropdown', 'buttons', 'range', 'dateRange', 'dateBetween', 'dateRelative', 'dateCalendar'],
  orientation: ['vertical', 'horizontal'],
  dateLayout: ['vertical', 'horizontal'],
  // A line drawn as an area is a large fill, and is colored as one.
  subType: ['grouped', 'stacked', 'stacked100', 'line', 'area', 'stackedArea', 'stackedArea100', 'stackedCombo', 'clusteredCombo'],
};

function pickShape(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, allowed] of Object.entries(SHAPE)) if (allowed.includes(raw[key])) out[key] = raw[key];
  return out;
}

function cleanPageContext(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const list = Array.isArray(src.widgets) ? src.widgets : [];
  if (list.length > MAX_CONTEXT_WIDGETS) return null;
  const widgets = list.map((w) => ({
    id: String((w && w.id) || ''),
    type: String((w && w.type) || ''),
    title: String((w && w.title) || '').slice(0, 200),
    dataBinding: (w && w.dataBinding && typeof w.dataBinding === 'object') ? w.dataBinding : {},
    layout: (w && w.layout && typeof w.layout === 'object') ? w.layout : null,
    // The look, through the same whitelist a design proposal is held to: a
    // config also carries image data and visual bundles.
    config: pickDesignConfig(w && w.config),
    // What decides how much room the widget needs, not how it looks: read to
    // size it, never settable by a proposal.
    shape: pickShape(w && w.shape),
    merged: !!(w && w.merged),
  }));
  const size = (v, fallback) => (Number.isFinite(Number(v)) && Number(v) >= 200 ? Math.round(Number(v)) : fallback);
  const slugs = (v) => (Array.isArray(v) ? v.filter((s) => typeof s === 'string' && SLUG.test(s)).slice(0, 30) : []);
  const ctx = {
    pageWidth: size(src.pageWidth, 1140),
    pageHeight: size(src.pageHeight, 800),
    themes: slugs(src.themes),
    theme: slugs([src.theme])[0] || null,
    pageBackground: HEX.test(src.pageBackground) ? src.pageBackground : null,
    palette: Array.isArray(src.palette) ? src.palette.filter((c) => HEX.test(c)).slice(0, 20) : [],
    widgets,
  };
  return Buffer.byteLength(JSON.stringify(ctx)) > MAX_CONTEXT_BYTES ? null : ctx;
}

router.get('/status', requireAuth, (req, res) => {
  const access = resolveAccess(req);
  res.json({
    enabled: !!access.config,
    dataSharing: access.config ? access.config.dataSharing : 'schema',
    source: access.source,
    // 'setup': no provider yet, and this user may bring their own.
    reason: access.reason,
    personal: mayBringOwn(access) ? aiAccess.publicPersonal(req.user.id) : null,
  });
});

// The key goes in and never comes back out, exactly as for the instance's.
router.put('/personal', requireAuth, (req, res) => {
  if (!mayBringOwn(resolveAccess(req))) return res.status(403).json({ error: 'A personal AI provider is not available for this account' });
  try {
    res.json({ personal: aiAccess.setPersonal(req.user.id, req.body) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/personal', requireAuth, (req, res) => {
  aiAccess.clearPersonal(req.user.id);
  res.json({ ok: true });
});

// Tries the SAVED personal provider, tool calling included: a model that
// answers but cannot call a tool could never propose anything.
router.post('/personal/test', requireAuth, chatLimiter, async (req, res) => {
  const access = resolveAccess(req);
  if (access.source !== 'personal') return res.json({ ok: false, toolCalling: false, error: 'Save a base URL and a model first' });
  try {
    const turn = await aiProviders.chat({
      config: access.config,
      system: 'This is a connectivity check. Call the `ping` tool with ok=true.',
      messages: [{ role: 'user', text: 'ping' }],
      tools: [aiTools.PING],
    });
    res.json({ ok: true, toolCalling: turn.toolCalls.some((c) => c.name === 'ping') });
  } catch (err) {
    const known = err instanceof aiProviders.AiProviderError;
    if (!known) console.error('[ai personal test]', err);
    res.json({ ok: false, toolCalling: false, error: known ? err.message : 'The test failed' });
  }
});

function refuseWithoutConfig(res, reason) {
  const why = { denied: 'The AI assistant is not available for this account', setup: 'Set up your AI provider first' }[reason] || 'The AI assistant is not enabled';
  return res.status(reason === 'denied' ? 403 : 409).json({ error: why });
}

function answer(res, turn) {
  return turn.then((result) => res.json(result)).catch((err) => {
    if (err instanceof aiProviders.AiProviderError) return res.status(502).json({ error: err.message });
    console.error('[ai chat]', err);
    return res.status(500).json({ error: 'The assistant failed to answer' });
  });
}

router.post('/reports/:reportId/chat', requireAuth, chatLimiter, async (req, res) => {
  const row = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.reportId);
  if (!row) return res.status(404).json({ error: 'Report not found' });
  if (!canWriteReport(row, req.user, req)) return res.status(403).json({ error: 'Forbidden' });

  // The schema of this model is about to be shown to a third party: the
  // caller must be allowed to read it themselves first.
  const modelRow = row.model_id ? db.prepare('SELECT * FROM models WHERE id = ?').get(row.model_id) : null;
  if (!modelRow || !canReadModel(modelRow, req.user, req)) {
    return res.status(409).json({ error: 'This report has no data model the assistant can use' });
  }

  const { config, reason } = resolveAccess(req);
  if (!config) return refuseWithoutConfig(res, reason);

  const messages = cleanMessages(req.body && req.body.messages);
  if (!messages) return res.status(400).json({ error: 'Invalid conversation' });
  const pageContext = cleanPageContext(req.body && req.body.pageContext);
  if (!pageContext) return res.status(400).json({ error: 'The page is too large for the assistant' });

  const report = { id: row.id, title: row.title, model_id: row.model_id, settings: safeJSON(row.settings, {}) };
  const effective = buildEffectiveModel(parseModel(modelRow), report.settings);

  return answer(res, runChat({
    config,
    user: req.user,
    orgId: req.organizationId || null,
    report,
    effective,
    messages,
    pageContext: withFloors(pageContext, effective),
    mode: req.body.mode === 'design' ? 'design' : 'visuals',
    // Custom visuals live in a workspace library, and only its admins may
    // add code to it — so only they are offered a visual to add.
    canWriteVisuals: canManageVisuals(row.workspace_id, req),
    // Only decides whether a card to the model assistant is offered: the
    // model editor checks it again, as does saving the model.
    canEditModel: canWriteModel(modelRow, req.user, req),
    library: libraryOf(row.workspace_id),
  }));
});

// The landing-page assistant: a conversation about a MODEL, with no report
// and no page. Open to whoever may build a report on that model — not to
// whoever can read it: in OSS, seeing one shared report makes its model
// readable, and that must not open the whole schema to questions.
router.post('/models/:modelId/chat', requireAuth, chatLimiter, async (req, res) => {
  const modelRow = db.prepare('SELECT * FROM models WHERE id = ?').get(req.params.modelId);
  if (!modelRow) return res.status(404).json({ error: 'Model not found' });
  if (!canBuildOnModel(modelRow, req.user, req)) return res.status(403).json({ error: 'Forbidden' });

  const { config, reason } = resolveAccess(req);
  if (!config) return refuseWithoutConfig(res, reason);

  const messages = cleanMessages(req.body && req.body.messages);
  if (!messages) return res.status(400).json({ error: 'Invalid conversation' });

  // The workspace the answer is meant for: its library is offered, and its
  // admins may have a new visual written. Only a member names one.
  const wsId = typeof req.body.workspaceId === 'string' && req.body.workspaceId ? req.body.workspaceId : null;
  if (wsId && !canSeeVisuals(wsId, req)) return res.status(403).json({ error: 'Not a member of this workspace' });

  // `id: null` is what keeps a reportId out of the cache read (cachedQuery).
  const scope = { id: null, title: null, model_id: modelRow.id, settings: {} };
  return answer(res, runChat({
    config,
    user: req.user,
    orgId: req.organizationId || null,
    report: scope,
    effective: buildEffectiveModel(parseModel(modelRow), {}),
    messages,
    pageContext: cleanPageContext({}),
    mode: 'ask',
    canWriteVisuals: canManageVisuals(wsId, req),
    canEditModel: canWriteModel(modelRow, req.user, req),
    library: libraryOf(wsId),
  }));
});

// The model editor's assistant. Changing a model is its owner's (or an admin's)
// business: the same rule as saving it. What it is shown is the editor's
// unsaved draft — table and column names, joins, flags; never rows.
router.post('/models/:modelId/model-chat', requireAuth, chatLimiter, async (req, res) => {
  const modelRow = db.prepare('SELECT * FROM models WHERE id = ?').get(req.params.modelId);
  if (!modelRow) return res.status(404).json({ error: 'Model not found' });
  if (!canWriteModel(modelRow, req.user, req)) return res.status(403).json({ error: 'Forbidden' });

  const { config, reason } = resolveAccess(req);
  if (!config) return refuseWithoutConfig(res, reason);

  const messages = cleanMessages(req.body && req.body.messages);
  if (!messages) return res.status(400).json({ error: 'Invalid conversation' });
  const draft = cleanDraft(req.body && req.body.draft);
  if (!draft) return res.status(400).json({ error: 'Pick the tables of the model first' });

  return answer(res, runModelChat({ config, modelName: modelRow.name, draft, messages }));
});

// 👍 / 👎 on an answer. Same gate as the conversation it rates: the model named
// here is one the caller could have asked about.
router.post('/feedback', requireAuth, (req, res) => {
  const modelRow = db.prepare('SELECT * FROM models WHERE id = ?').get(String((req.body && req.body.modelId) || ''));
  if (!modelRow) return res.status(404).json({ error: 'Model not found' });
  if (!canBuildOnModel(modelRow, req.user, req)) return res.status(403).json({ error: 'Forbidden' });
  const access = resolveAccess(req);
  if (!access.config) return refuseWithoutConfig(res, access.reason);

  const out = aiFeedback.record({
    user: req.user,
    orgId: req.organizationId || null,
    modelId: modelRow.id,
    effective: buildEffectiveModel(parseModel(modelRow), {}),
    access,
    body: req.body,
  });
  if (out.error) return res.status(400).json({ error: out.error });
  res.json({ ok: true });
});

module.exports = router;
