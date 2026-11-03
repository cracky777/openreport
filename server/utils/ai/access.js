// Who gets the assistant, and on whose provider. One function answers it, so
// the status the editor shows and the config the chat route uses cannot differ.
//
// In this order:
//   1. The admin's switch is off            → nobody, whatever key they hold.
//      It is the instance's "no AI here", not a billing setting.
//   2. The admin took it away from this user → nobody's provider, theirs
//      included. Denied means "no AI on this data for you".
//   3. The instance has a provider          → that one, for everyone left.
//   4. It has none                          → the user's own, if they set one.
//      The key is theirs, stored encrypted on their row, used for their
//      requests only, and never readable back — not even by an admin.
//
// A user's own provider decides WHERE the prompt goes, never WHAT goes: the
// data-sharing level stays the instance's. Letting the person who picks the
// destination also widen what is sent to it would undo the admin's decision.
//
// "The instance" is a scope: its stored config and whether this user is denied
// in it. The cloud edition passes its own — the organization the request runs
// in, set up by that organization's admins (cloudHooks.resolveAiScope).
//
// The Claude subscription (providers/claudeSubscription.js) is a personal
// provider and nothing else: a Pro / Max plan is one person's, its token pays
// that person's turns. Neither the instance nor an organization can be set to
// it (settingsHelper.AI_PROVIDERS leaves it out).

const db = require('../../db');
const { AI_PROVIDERS, storedAiConfig, effectiveAiConfig, publicAiConfigOf, applyAiProviderPatch, clearAiKey } = require('../settingsHelper');
const { PROVIDER: SUBSCRIPTION } = require('./providers/claudeSubscription');
const { effectiveOpenMetadata } = require('../openMetadata/settings');

const PERSONAL_DEFAULTS = { provider: 'openai-compat', baseUrl: '', model: '', apiKey: '' };
const PERSONAL_PROVIDERS = [...AI_PROVIDERS, SUBSCRIPTION];

function storedPersonal(userId) {
  const row = db.prepare('SELECT ai_config FROM users WHERE id = ?').get(userId);
  let stored = null;
  try {
    stored = row && row.ai_config ? JSON.parse(row.ai_config) : null;
  } catch {
    stored = null; // a mangled row behaves as "nothing set": the user saves again
  }
  return { ...PERSONAL_DEFAULTS, ...(stored && typeof stored === 'object' ? stored : {}) };
}

// The subscription has no URL: the token is the whole setup, the model the plan's default unless named.
const isConfigured = (cfg) => (cfg.provider === SUBSCRIPTION ? !!cfg.apiKey : !!(cfg.baseUrl && cfg.model));

function isDenied(userId) {
  const row = db.prepare('SELECT ai_denied FROM users WHERE id = ?').get(userId);
  return !!(row && row.ai_denied);
}

/** The instance's scope: its settings, and the account's own denial flag. */
function instanceScope(user) {
  return { stored: storedAiConfig(), denied: isDenied(user.id) };
}

/**
 * @param {{stored: object, denied: boolean}} [scope] where the rules are read; the instance when omitted
 * @returns {{
 *   config: object|null,                        what the chat route hands the provider layer; null = no assistant
 *   source: 'instance'|'personal'|null,
 *   reason: 'off'|'denied'|'setup'|null,        why there is none; 'setup' = the user may bring their own
 *   openMetadata?: {url, token, service}|null,  the data catalog the assistant may read, when switched on
 * }}
 */
function resolveForUser(user, scope = instanceScope(user)) {
  const instance = effectiveAiConfig(scope.stored);
  if (!publicAiConfigOf(scope.stored).enabled) return { config: null, source: null, reason: 'off' };
  if (scope.denied) return { config: null, source: null, reason: 'denied' };
  // The data catalog is the scope's, whoever's provider answers: a personal
  // provider decides where the prompt goes, never what the assistant may read.
  const openMetadata = effectiveOpenMetadata(scope.stored);
  if (instance.enabled) return { config: instance, source: 'instance', reason: null, openMetadata };

  const personal = storedPersonal(user.id);
  const { apiKey, keyError } = clearAiKey(personal);
  if (!isConfigured(personal) || keyError) return { config: null, source: null, reason: 'setup' };
  return {
    config: { ...personal, apiKey, keyError: null, enabled: true, dataSharing: instance.dataSharing },
    source: 'personal',
    reason: null,
    openMetadata,
  };
}

/** What the user may read back of their own provider. Never the key. */
function publicPersonal(userId) {
  const cfg = storedPersonal(userId);
  return { provider: cfg.provider, baseUrl: cfg.baseUrl, model: cfg.model, hasApiKey: !!cfg.apiKey, configured: isConfigured(cfg), keyError: clearAiKey(cfg).keyError };
}

function setPersonal(userId, patch) {
  const p = patch && typeof patch === 'object' ? patch : {};
  const next = storedPersonal(userId);
  // A key belongs to the provider it was made for: changing provider drops it,
  // so an OpenAI key never passes for a Claude token.
  if (p.provider !== undefined && p.provider !== next.provider) next.apiKey = '';
  const subscription = (p.provider !== undefined ? p.provider : next.provider) === SUBSCRIPTION;
  // No base URL for the subscription; its model may stay empty (the plan's default).
  applyAiProviderPatch(next, subscription ? { ...p, baseUrl: undefined, model: undefined } : p, PERSONAL_PROVIDERS);
  if (subscription) {
    next.baseUrl = '';
    if (p.model !== undefined) next.model = String(p.model == null ? '' : p.model).trim().slice(0, 200);
    // A token never holds whitespace; one copied from a terminal often holds a
    // line break where the line wrapped. Saved as the token it was meant to be.
    if (typeof p.apiKey === 'string' && /\s/.test(p.apiKey.trim())) applyAiProviderPatch(next, { apiKey: p.apiKey.replace(/\s+/g, '') }, PERSONAL_PROVIDERS);
  }
  if (!isConfigured(next)) throw new Error(subscription ? 'Paste the token that `claude setup-token` prints' : 'Set a base URL and a model');
  db.prepare('UPDATE users SET ai_config = ? WHERE id = ?').run(JSON.stringify(next), userId);
  return publicPersonal(userId);
}

function clearPersonal(userId) {
  db.prepare('UPDATE users SET ai_config = NULL WHERE id = ?').run(userId);
}

function setDenied(userId, denied) {
  return db.prepare('UPDATE users SET ai_denied = ? WHERE id = ?').run(denied ? 1 : 0, userId).changes > 0;
}

module.exports = { resolveForUser, publicPersonal, setPersonal, clearPersonal, setDenied, isDenied };
