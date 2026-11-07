// The base maps added to this instance (utils/geo/baseMaps.js), for the map
// widget of every signed-in user — a viewer draws them too. Adding one is the
// assistant's card: POST /api/ai/maps.
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { listMapLayers, readBaseMap } = require('../utils/geo/baseMaps');

const router = express.Router();

router.get('/maps', requireAuth, (req, res) => {
  res.json({ maps: listMapLayers() });
});

router.get('/maps/:id', requireAuth, (req, res) => {
  const json = readBaseMap(req.params.id);
  if (!json) return res.status(404).json({ error: 'Map not found' });
  res.type('application/json').send(json);
});

module.exports = router;
