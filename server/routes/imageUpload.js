/**
 * Image upload endpoint — accepts a multipart `image` file, stores it on
 * disk under `server/data/uploads/images/`, and returns the public URL.
 *
 * This is the OSS path. The cloud edition shadows this route to return
 * 403 — cloud users are expected to host images on their own CDN/S3 and
 * paste the URL into the property panel. Storing per-tenant binaries on
 * the cloud server would require quota / GC / abuse handling that the
 * cloud team hasn't built yet, so the safer default is "no uploads here,
 * use your own URL".
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const imagesDir = path.join(__dirname, '..', 'data', 'uploads', 'images');
if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

const storage = multer.diskStorage({
  destination: imagesDir,
  // UUID-prefixed filename. Keeps the original extension so the browser
  // picks the right content type from the static-serve middleware.
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname || '') || '').toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  },
});

const ALLOWED = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif']);

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB — generous for a dashboard image
  fileFilter: (req, file, cb) => {
    const ext = (path.extname(file.originalname || '') || '').toLowerCase();
    if (!ALLOWED.has(ext)) {
      return cb(new Error(`Unsupported image type: ${ext}. Allowed: ${[...ALLOWED].join(', ')}`));
    }
    // Belt-and-braces: also require an image MIME type. Multer parses it
    // from the request headers, which the browser sets from the file
    // extension — so it's not a strong check, but catches the obvious
    // "rename file.exe to file.png" case before bytes hit disk.
    if (!String(file.mimetype || '').startsWith('image/')) {
      return cb(new Error('File is not an image'));
    }
    cb(null, true);
  },
});

router.post('/', requireAuth, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
  // Public URL relative to the server root — Express serves it via the
  // static middleware mounted in `server/index.js` on `/uploads/images`.
  res.json({ url: `/uploads/images/${req.file.filename}` });
});

// Multer error handler — surfaces "file too large" / "unsupported type"
// with a 400 + readable message instead of a generic 500.
router.use((err, req, res, next) => {
  if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
  next();
});

module.exports = router;
