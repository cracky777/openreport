// The OpenMetadata link of the AI assistant: where the catalog is, the token
// of its read-only bot, and the name of the Open Report service there. It
// lives inside the AI config (`openMetadata`), so it is read in the same scope
// as the provider — the instance in OSS, the organization in cloud
// (cloudHooks.resolveAiScope) — with no second place to keep in step.
//
// Off by default: switched on, table names, SQL and the ETL's rules leave for
// the AI provider. The token goes in and never comes back out, like a
// provider's key.

const { encrypt, decrypt } = require('../secretCrypto');
const { cleanLayerRules } = require('./layers');

const OM_DEFAULTS = { enabled: false, url: '', token: '', service: 'openreport', layers: [], changedAt: null, changedBy: null };
// A service name is one FQN part: no dot, no quote.
const SERVICE = /^[A-Za-z0-9_-]{1,128}$/;

const omOf = (stored) => ({ ...OM_DEFAULTS, ...(stored && stored.openMetadata && typeof stored.openMetadata === 'object' ? stored.openMetadata : {}) });

function clearToken(om) {
  if (!om.token) return { token: '', tokenError: null };
  try {
    return { token: decrypt(om.token), tokenError: null };
  } catch {
    return { token: '', tokenError: 'The stored token cannot be decrypted. Check DATASOURCE_ENC_KEY, then save the token again.' };
  }
}

/** The saved link, switched on or not (the admin tests it before), token in clear; null when incomplete. */
function savedConnection(stored) {
  const om = omOf(stored);
  const { token } = clearToken(om);
  return om.url && token ? { url: om.url, token, service: om.service, layers: om.layers || [] } : null;
}

/** What the assistant may use; null when the link is off or incomplete. */
function effectiveOpenMetadata(stored) {
  return omOf(stored).enabled ? savedConnection(stored) : null;
}

/** What an admin reads back. Never the token. */
function publicOpenMetadata(stored) {
  const om = omOf(stored);
  const { tokenError } = clearToken(om);
  return {
    enabled: !!om.enabled,
    url: om.url,
    service: om.service,
    layers: om.layers || [],
    hasToken: !!om.token,
    tokenError,
    changedAt: om.changedAt,
    changedBy: om.changedBy,
  };
}

function validateUrl(raw) {
  const v = String(raw == null ? '' : raw).trim().replace(/\/+$/, '');
  if (!v) return '';
  let url;
  try {
    url = new URL(v);
  } catch {
    throw new Error('The OpenMetadata URL must be a valid http(s) URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('The OpenMetadata URL must be a valid http(s) URL');
  if (url.username || url.password) throw new Error('The OpenMetadata URL must not carry credentials');
  return v;
}

/**
 * The next stored AI config with its OpenMetadata part patched. An empty token
 * keeps the stored one (the form never receives it). Who switched it on or off,
 * and when, is kept with it: there is no audit journal to write it to.
 * @param {{ email?: string }} actor
 */
function patchOpenMetadata(stored, patch, actor = {}, now = new Date().toISOString()) {
  const p = patch && typeof patch === 'object' ? patch : {};
  const om = omOf(stored);
  if (p.url !== undefined) om.url = validateUrl(p.url);
  if (p.service !== undefined) {
    const s = String(p.service == null ? '' : p.service).trim() || OM_DEFAULTS.service;
    if (!SERVICE.test(s)) throw new Error('The service name holds letters, digits, - and _ only');
    om.service = s;
  }
  if (p.layers !== undefined) om.layers = cleanLayerRules(p.layers);
  if (p.clearToken === true) om.token = '';
  if (typeof p.token === 'string' && p.token.trim()) {
    try {
      om.token = encrypt(p.token.trim());
    } catch {
      throw new Error('Set DATASOURCE_ENC_KEY and restart the server before saving a token: it is never stored in clear.');
    }
  }
  if (p.enabled !== undefined && !!p.enabled !== om.enabled) {
    om.enabled = !!p.enabled;
    om.changedAt = now;
    om.changedBy = actor.email || null;
  }
  if (om.enabled && (!om.url || !om.token)) throw new Error('Set the OpenMetadata URL and token before switching it on');
  return { ...(stored && typeof stored === 'object' ? stored : {}), openMetadata: om };
}

module.exports = { savedConnection, effectiveOpenMetadata, publicOpenMetadata, patchOpenMetadata, OM_DEFAULTS };
