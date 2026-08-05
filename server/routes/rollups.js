/**
 * Rollup HTTP endpoints (OSS).
 *
 *   POST   /api/rollups/run-now/:modelId       trigger a full rebuild
 *   GET    /api/rollups/manifest/:modelId      list manifest entries
 *   DELETE /api/rollups/:modelId/:grainHash    drop one rollup
 *
 * Permission model: model owner or global admin. Aligned with /query —
 * if you can edit the model, you can rebuild its rollups.
 */

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const db = require('../db');
const rollupBuilder = require('../utils/rollupBuilder');
const cloudHooks = require('../cloudHooks');

const router = express.Router();

// Load + authorize the model for a rollup op. OSS: model owner or global admin.
// Cloud: org-scoped (404 cross-org) + org-owner/admin/model-owner. Sends the
// 404/403 response itself when denied and returns null.
function authorizeRollupModel(req, res) {
  if (typeof cloudHooks.authorizeRollupModel === 'function') return cloudHooks.authorizeRollupModel(req, res);
  const m = db.prepare('SELECT id, user_id FROM models WHERE id = ?').get(req.params.modelId);
  if (!m) { res.status(404).json({ error: 'Model not found' }); return null; }
  if (!(req.user && (req.user.role === 'admin' || m.user_id === req.user.id))) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }
  return m;
}

router.post('/run-now/:modelId', requireAuth, async (req, res) => {
  const model = authorizeRollupModel(req, res);
  if (!model) return;

  try {
    const result = await rollupBuilder.buildRollupsForModel({
      modelId: model.id,
      internalUserId: req.user.id,
      orgId: req.organizationId || null,
      log: process.env.ROLLUP_LOG !== '0',
    });
    res.json(result);
  } catch (err) {
    console.error('[rollup run-now]', err);
    if (err.code === 'ROLLUP_STORAGE_UNSUPPORTED') {
      return res.status(501).json({ error: err.message });
    }
    res.status(500).json({ error: err.message || 'Rollup build failed' });
  }
});

router.get('/manifest/:modelId', requireAuth, (req, res) => {
  const model = authorizeRollupModel(req, res);
  if (!model) return;
  const rollups = rollupBuilder.getManifest({
    modelId: model.id,
    orgId: req.organizationId || null,
  });
  res.json({ rollups });
});

router.delete('/:modelId/:grainHash', requireAuth, async (req, res) => {
  const model = authorizeRollupModel(req, res);
  if (!model) return;
  const result = await rollupBuilder.dropRollup({
    modelId: model.id,
    grainHash: req.params.grainHash,
    orgId: req.organizationId || null,
  });
  if (!result.dropped) return res.status(404).json({ error: 'Rollup not found' });
  res.json(result);
});

module.exports = router;
