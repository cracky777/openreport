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

const db = require('../../db');
const { getAiConfig, publicAiConfig, applyAiProviderPatch, clearAiKey } = require('../settingsHelper');

const PERSONAL_DEFAULTS = { provider: 'openai-compat', baseUrl: '', model: '', apiKey: '' };

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

const isConfigured = (cfg) => !!(cfg.baseUrl && cfg.model);

function isDenied(userId) {
  const row = db.prepare('SELECT ai_denied FROM users WHERE id = ?').get(userId);
  return !!(row && row.ai_denied);
}

/**
 * @returns {{
 *   config: object|null,                        what the chat route hands the provider layer; null = no assistant
 *   source: 'instance'|'personal'|null,
 *   reason: 'off'|'denied'|'setup'|null,        why there is none; 'setup' = the user may bring their own
 * }}
 */
function resolveForUser(user) {
  const instance = getAiConfig();
  if (!publicAiConfig().enabled) return { config: null, source: null, reason: 'off' };
  if (isDenied(user.id)) return { config: null, source: null, reason: 'denied' };
  if (instance.enabled) return { config: instance, source: 'instance', reason: null };

  const personal = storedPersonal(user.id);
  const { apiKey, keyError } = clearAiKey(personal);
  if (!isConfigured(personal) || keyError) return { config: null, source: null, reason: 'setup' };
  return {
    config: { ...personal, apiKey, keyError: null, enabled: true, dataSharing: instance.dataSharing },
    source: 'personal',
    reason: null,
  };
}

/** What the user may read back of their own provider. Never the key. */
function publicPersonal(userId) {
  const cfg = storedPersonal(userId);
  return { provider: cfg.provider, baseUrl: cfg.baseUrl, model: cfg.model, hasApiKey: !!cfg.apiKey, keyError: clearAiKey(cfg).keyError };
}

function setPersonal(userId, patch) {
  const next = storedPersonal(userId);
  applyAiProviderPatch(next, patch && typeof patch === 'object' ? patch : {});
  if (!isConfigured(next)) throw new Error('Set a base URL and a model');
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
