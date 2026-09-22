const db = require('../db');
const { encrypt, decrypt } = require('./secretCrypto');

// Bounds for the query timeout setting — enforced server-side so a
// misconfigured admin UI can never park a runaway query.
const QUERY_TIMEOUT_MIN_MS = 5_000;        // 5 s safety floor for tests
const QUERY_TIMEOUT_MAX_MS = 300_000;      // 5 min hard ceiling
const QUERY_TIMEOUT_DEFAULT_MS = 60_000;   // 1 min default

function getSetting(key, fallback) {
  try {
    const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
    if (!row) return fallback;
    return JSON.parse(row.value);
  } catch {
    return fallback;
  }
}

function setSetting(key, value) {
  const json = JSON.stringify(value);
  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).run(key, json);
}

// ─── Adresse de signalement ─────────────────────────────────────────
// Où partent les rapports de bug de l'édition auto-hébergée. Un réglage plutôt
// qu'une constante, pour deux raisons : une installation d'entreprise voudra
// souvent router vers son propre support avant de remonter en amont, et une
// adresse en dur dans un dépôt public est une adresse récoltée par les robots.
// La valeur d'usine vient de l'environnement, ce qui permet à une image Docker
// de la porter sans toucher à la base.
function getSupportEmail() {
  const stored = getSetting('support_email', null);
  if (typeof stored === 'string' && stored.trim()) return stored.trim();
  const fromEnv = String(process.env.OPENREPORT_SUPPORT_EMAIL || '').trim();
  return fromEnv || null;
}

// Validation volontairement lâche : le seul but est d'écarter ce qui ne peut
// pas fonctionner dans un lien mailto — pas de décider ce qu'est une adresse.
function setSupportEmail(email) {
  const v = String(email == null ? '' : email).trim();
  if (!v) { setSetting('support_email', ''); return null; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new Error('Invalid e-mail address');
  setSetting('support_email', v);
  return v;
}

function clampQueryTimeout(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return QUERY_TIMEOUT_DEFAULT_MS;
  return Math.max(QUERY_TIMEOUT_MIN_MS, Math.min(QUERY_TIMEOUT_MAX_MS, Math.round(n)));
}

function getQueryTimeoutMs() {
  return clampQueryTimeout(getSetting('query_timeout_ms', QUERY_TIMEOUT_DEFAULT_MS));
}

function setQueryTimeoutMs(ms) {
  const clamped = clampQueryTimeout(ms);
  setSetting('query_timeout_ms', clamped);
  return clamped;
}

// ─── Query result cache ─────────────────────────────────────────────
// Same shape as the timeout: bounded values, persisted in app_settings,
// admin-tunable via /api/admin/settings.
const QUERY_CACHE_TTL_MIN_MS = 0;             // 0 = cache disabled
const QUERY_CACHE_TTL_MAX_MS = 24 * 3600_000; // 24 h ceiling
// 24 h default — long enough that a once-a-night warm schedule keeps
// reports cached the whole day. Lower it if your data churns hourly.
const QUERY_CACHE_TTL_DEFAULT_MS = 24 * 3600_000;
const QUERY_CACHE_MAX_ENTRIES_DEFAULT = 5000;

function clampQueryCacheTtl(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return QUERY_CACHE_TTL_DEFAULT_MS;
  return Math.max(QUERY_CACHE_TTL_MIN_MS, Math.min(QUERY_CACHE_TTL_MAX_MS, Math.round(n)));
}

function isQueryCacheEnabled() {
  return getSetting('query_cache_enabled', true) !== false;
}

function setQueryCacheEnabled(enabled) {
  setSetting('query_cache_enabled', !!enabled);
  return !!enabled;
}

function getQueryCacheTtlMs() {
  return clampQueryCacheTtl(getSetting('query_cache_ttl_ms', QUERY_CACHE_TTL_DEFAULT_MS));
}

function setQueryCacheTtlMs(ms) {
  const clamped = clampQueryCacheTtl(ms);
  setSetting('query_cache_ttl_ms', clamped);
  return clamped;
}

function getQueryCacheMaxEntries() {
  const v = Number(getSetting('query_cache_max_entries', QUERY_CACHE_MAX_ENTRIES_DEFAULT));
  return Number.isFinite(v) && v > 0 ? Math.round(v) : QUERY_CACHE_MAX_ENTRIES_DEFAULT;
}

// ─── Public sharing policy ──────────────────────────────────────────
// Governs the "make this report public" capability instance-wide:
//   everyone  (default) any user with write access to the report's model
//   admins    only global admins may flip a report public
//   disabled  nobody may — AND already-public reports stop serving
//             anonymously (kill switch; signed embed tokens are a separate
//             capability and keep working, each one is individually minted)
const PUBLIC_SHARING_POLICIES = ['everyone', 'admins', 'disabled'];

function getPublicSharingPolicy() {
  const v = getSetting('public_sharing_policy', 'everyone');
  return PUBLIC_SHARING_POLICIES.includes(v) ? v : 'everyone';
}

function setPublicSharingPolicy(policy) {
  if (!PUBLIC_SHARING_POLICIES.includes(policy)) {
    throw new Error(`Policy must be one of: ${PUBLIC_SHARING_POLICIES.join(', ')}`);
  }
  setSetting('public_sharing_policy', policy);
  return policy;
}

// ─── API access ─────────────────────────────────────────────────────
// The public API is OFF on a fresh install and stays off until an admin turns
// it on. A BI instance is a key to every database it connects to, so the
// surface that answers to a bearer string is opt-in, not opt-out.
//
// `api_min_role` says who may hold a token once the API is on. Read as a floor
// on the role ladder (admin > editor > viewer), so 'viewer' means everyone.
// It is enforced at BOTH ends: minting refuses a user below the floor, and the
// bearer middleware re-checks on every call — demoting someone kills the tokens
// they already hold, without anyone having to remember to revoke them.
const API_MIN_ROLES = ['admin', 'editor', 'viewer'];
const ROLE_RANK = { admin: 3, editor: 2, viewer: 1 };

function isApiEnabled() {
  return getSetting('api_enabled', false) === true;
}

function setApiEnabled(enabled) {
  setSetting('api_enabled', !!enabled);
  return !!enabled;
}

function getApiMinRole() {
  const v = getSetting('api_min_role', 'admin');
  return API_MIN_ROLES.includes(v) ? v : 'admin';
}

function setApiMinRole(role) {
  if (!API_MIN_ROLES.includes(role)) {
    throw new Error(`Minimum role must be one of: ${API_MIN_ROLES.join(', ')}`);
  }
  setSetting('api_min_role', role);
  return role;
}

// Whether `user` may hold and use an API token right now. The single place
// both the mint route and the bearer middleware ask.
function canUseApi(user) {
  if (!isApiEnabled()) return false;
  if (!user) return false;
  return (ROLE_RANK[user.role] || 0) >= ROLE_RANK[getApiMinRole()];
}

// ─── AI assistant ───────────────────────────────────────────────────
// One provider for the whole instance, chosen by an admin — or, in the cloud
// edition, one per organization (cloudHooks.resolveAiScope): the functions
// taking a stored config work on either; the instance's wrap them. Two wire protocols
// cover the field: `openai-compat` is the chat-completions shape that OpenAI,
// Mistral, Ollama, LM Studio, Azure and OpenRouter all speak; `anthropic` is
// the native Messages API.
//
// `dataSharing` is a privacy decision, not a tuning knob: 'schema' sends only
// field names and labels to the provider, 'schema+cache' also lets the
// assistant read rows out of the rollup cache — rows that then leave the
// instance. Off by default for that reason.
const AI_PROVIDERS = ['openai-compat', 'anthropic'];
const AI_DATA_SHARING = ['schema', 'schema+cache'];
// `enabled` is the admin's switch, on unless they turn it off: configuring a
// provider is the decision to use the assistant, a second "and now enable it"
// step was only ever forgotten. What is NOT on by default is `dataSharing`.
const AI_DEFAULTS = { enabled: true, provider: 'openai-compat', baseUrl: '', model: '', apiKey: '', dataSharing: 'schema' };

// The switch alone does not make an assistant: without a provider there is
// nobody to talk to, and the editor must not offer a panel that can only fail.
const isConfigured = (cfg) => !!(cfg.baseUrl && cfg.model);

const withAiDefaults = (stored) => ({ ...AI_DEFAULTS, ...(stored && typeof stored === 'object' ? stored : {}) });

function storedAiConfig() {
  return withAiDefaults(getSetting('ai_config', null));
}

// The config as the provider layer needs it, key in clear. A key that no
// longer decrypts (DATASOURCE_ENC_KEY rotated or removed) disables the
// assistant with a reason instead of taking the whole settings page down.
function effectiveAiConfig(stored) {
  const cfg = withAiDefaults(stored);
  const { apiKey, keyError } = clearAiKey(cfg);
  return { ...cfg, apiKey, keyError, enabled: !!cfg.enabled && !keyError && isConfigured(cfg) };
}

function getAiConfig() {
  return effectiveAiConfig(storedAiConfig());
}

// A stored provider config's key, in clear — shared with the per-user configs
// (utils/ai/access.js), which are stored the same way.
function clearAiKey(cfg) {
  if (!cfg.apiKey) return { apiKey: '', keyError: null };
  try {
    return { apiKey: decrypt(cfg.apiKey), keyError: null };
  } catch {
    return { apiKey: '', keyError: 'The stored API key cannot be decrypted. Check DATASOURCE_ENC_KEY, then save the key again.' };
  }
}

// What an admin may read back. The key itself is never part of it.
function publicAiConfigOf(stored) {
  const cfg = withAiDefaults(stored);
  return {
    enabled: !!cfg.enabled,
    // The switch is one thing, whether authors actually get the assistant another.
    active: !!cfg.enabled && isConfigured(cfg),
    provider: cfg.provider,
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    dataSharing: cfg.dataSharing,
    hasApiKey: !!cfg.apiKey,
  };
}

function publicAiConfig() {
  return publicAiConfigOf(storedAiConfig());
}

function validateAiBaseUrl(raw) {
  const v = String(raw == null ? '' : raw).trim().replace(/\/+$/, '');
  let url;
  try {
    url = new URL(v);
  } catch {
    throw new Error('Base URL must be a valid http(s) URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Base URL must be a valid http(s) URL');
  if (url.username || url.password) throw new Error('Base URL must not carry credentials');
  return v;
}

// Same rule as a datasource password: an empty key means keep the stored one,
// because the form never receives it and so has nothing to send back.
// Returns the next stored config; throws on an invalid patch, before anything
// is written.
function patchAiConfig(stored, patch) {
  const p = patch && typeof patch === 'object' ? patch : {};
  const next = withAiDefaults(stored);
  // Back to "no instance provider": every user is then free to bring their
  // own. The switch and the data-sharing level are the admin's and stay.
  if (p.removeProvider === true) Object.assign(next, { provider: AI_DEFAULTS.provider, baseUrl: '', model: '', apiKey: '' });
  else applyAiProviderPatch(next, p);
  if (p.dataSharing !== undefined) {
    if (!AI_DATA_SHARING.includes(p.dataSharing)) throw new Error(`Data sharing must be one of: ${AI_DATA_SHARING.join(', ')}`);
    next.dataSharing = p.dataSharing;
  }
  // On without a provider is a state of its own, not a mistake: it is the one
  // in which each user may bring theirs (utils/ai/access.js).
  if (p.enabled !== undefined) next.enabled = !!p.enabled;
  return next;
}

function setAiConfig(patch) {
  setSetting('ai_config', patchAiConfig(storedAiConfig(), patch));
  return publicAiConfig();
}

// The provider half of a config — where, which model, which key — validated
// and applied in place. The instance's config and a user's own share it: same
// rules, same encryption, one place to get them wrong.
function applyAiProviderPatch(next, p) {
  if (p.provider !== undefined) {
    if (!AI_PROVIDERS.includes(p.provider)) throw new Error(`Provider must be one of: ${AI_PROVIDERS.join(', ')}`);
    next.provider = p.provider;
  }
  if (p.baseUrl !== undefined) next.baseUrl = validateAiBaseUrl(p.baseUrl);
  if (p.model !== undefined) {
    const model = String(p.model == null ? '' : p.model).trim();
    if (!model || model.length > 200) throw new Error('Model must be 1 to 200 characters');
    next.model = model;
  }
  if (p.clearApiKey === true) next.apiKey = '';
  if (typeof p.apiKey === 'string' && p.apiKey.trim()) {
    try {
      next.apiKey = encrypt(p.apiKey.trim());
    } catch {
      throw new Error('Set DATASOURCE_ENC_KEY and restart the server before saving an API key: it is never stored in clear.');
    }
  }
}

module.exports = {
  AI_PROVIDERS,
  AI_DATA_SHARING,
  getAiConfig,
  setAiConfig,
  publicAiConfig,
  storedAiConfig,
  effectiveAiConfig,
  publicAiConfigOf,
  patchAiConfig,
  applyAiProviderPatch,
  clearAiKey,
  QUERY_TIMEOUT_MIN_MS,
  QUERY_TIMEOUT_MAX_MS,
  QUERY_TIMEOUT_DEFAULT_MS,
  QUERY_CACHE_TTL_MIN_MS,
  QUERY_CACHE_TTL_MAX_MS,
  QUERY_CACHE_TTL_DEFAULT_MS,
  getSetting,
  setSetting,
  clampQueryTimeout,
  getQueryTimeoutMs,
  setQueryTimeoutMs,
  clampQueryCacheTtl,
  isQueryCacheEnabled,
  setQueryCacheEnabled,
  getQueryCacheTtlMs,
  setQueryCacheTtlMs,
  getQueryCacheMaxEntries,
  PUBLIC_SHARING_POLICIES,
  getPublicSharingPolicy,
  setPublicSharingPolicy,
  getSupportEmail,
  setSupportEmail,
  API_MIN_ROLES,
  isApiEnabled,
  setApiEnabled,
  getApiMinRole,
  setApiMinRole,
  canUseApi,
};
