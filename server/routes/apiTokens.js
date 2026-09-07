/**
 * Managing one's own API tokens. Session-only by design: apiToken.middleware
 * runs on /api/v1 alone, so a token can never mint or revoke another token.
 *
 * A token acts as its owner, so there is nothing to share — each user manages
 * their own list, admins included.
 */

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const apiToken = require('../utils/apiToken');
const { isApiEnabled, getApiMinRole, canUseApi } = require('../utils/settingsHelper');

const router = express.Router();

// Listing stays open even when the API is off: a user still needs to see and
// clean up the tokens they hold. `canCreate` is what the panel renders on.
router.get('/', requireAuth, (req, res) => {
  res.json({
    tokens: apiToken.listForUser(req.user.id),
    availableScopes: apiToken.SCOPES,
    enabled: isApiEnabled(),
    minRole: getApiMinRole(),
    canCreate: canUseApi(req.user),
  });
});

router.post('/', requireAuth, (req, res) => {
  if (!isApiEnabled()) return res.status(403).json({ error: 'The API is disabled on this instance' });
  if (!canUseApi(req.user)) return res.status(403).json({ error: 'Your role is not allowed to create API tokens' });

  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (name.length > 80) return res.status(400).json({ error: 'Name is too long (80 chars max)' });

  const { scopes, error } = apiToken.parseScopes(req.body.scopes);
  if (error) return res.status(400).json({ error });

  let expiresAt = null;
  if (req.body.expiresInDays != null && req.body.expiresInDays !== '') {
    const days = Number(req.body.expiresInDays);
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      return res.status(400).json({ error: 'expiresInDays must be an integer between 1 and 3650' });
    }
    expiresAt = new Date(Date.now() + days * 86400_000).toISOString().replace('T', ' ').slice(0, 19);
  }

  const { id, token } = apiToken.create({ userId: req.user.id, name, scopes, expiresAt });
  // The only time the clear-text token is ever returned.
  res.status(201).json({ id, token, name, scopes, expires_at: expiresAt });
});

router.delete('/:id', requireAuth, (req, res) => {
  if (!apiToken.revoke({ id: req.params.id, userId: req.user.id })) {
    return res.status(404).json({ error: 'Token not found or already revoked' });
  }
  res.json({ ok: true });
});

module.exports = router;
