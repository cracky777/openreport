// Power BI template import — analysis only. The client applies the plan
// through the existing endpoints (datasource create, model import, report
// import), so authorization, encryption and cloud hooks stay in one place.
const express = require('express');
const multer = require('multer');
const { authFor } = require('../middleware/auth');
const { analyzePbit } = require('../utils/pbit');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 64 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/\.pbit$/i.test(file.originalname || '')) return cb(null, true);
    cb(new Error('Only .pbit files are accepted'));
  },
});

router.post('/pbit', authFor('write'), (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, (req, res) => {
  if (!req.file || !req.file.buffer) return res.status(400).json({ error: 'No file uploaded' });
  let plan;
  try {
    plan = analyzePbit(req.file.buffer, { fileName: req.file.originalname });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  res.json({ plan });
});

module.exports = router;
