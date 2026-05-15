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

const router = express.Router();

function loadModelOrFail(modelId, res) {
  const m = db.prepare('SELECT id, user_id FROM models WHERE id = ?').get(modelId);
  if (!m) {
    res.status(404).json({ error: 'Model not found' });
    return null;
  }
  return m;
}

function canManageRollups(model, user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return model.user_id === user.id;
}

router.post('/run-now/:modelId', requireAuth, async (req, res) => {
  const model = loadModelOrFail(req.params.modelId, res);
  if (!model) return;
  if (!canManageRollups(model, req.user)) return res.status(403).json({ error: 'Forbidden' });

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
  const model = loadModelOrFail(req.params.modelId, res);
  if (!model) return;
  if (!canManageRollups(model, req.user)) return res.status(403).json({ error: 'Forbidden' });
  const rollups = rollupBuilder.getManifest({
    modelId: model.id,
    orgId: req.organizationId || null,
  });
  res.json({ rollups });
});

router.delete('/:modelId/:grainHash', requireAuth, async (req, res) => {
  const model = loadModelOrFail(req.params.modelId, res);
  if (!model) return;
  if (!canManageRollups(model, req.user)) return res.status(403).json({ error: 'Forbidden' });
  const result = await rollupBuilder.dropRollup({
    modelId: model.id,
    grainHash: req.params.grainHash,
    orgId: req.organizationId || null,
  });
  if (!result.dropped) return res.status(404).json({ error: 'Rollup not found' });
  res.json(result);
});

module.exports = router;
