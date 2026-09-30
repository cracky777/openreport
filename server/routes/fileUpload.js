const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { authFor } = require('../middleware/auth');
const db = require('../db');
const uploadHooks = require('../hooks/upload');
const cloudHooks = require('../cloudHooks');
const wsAccess = require('../utils/workspaceAccess');
const { nameTaken } = require('../utils/nameUniqueness');
const { invalidateDatasource, DUCKDB_DIR } = require('../utils/dbConnector');
const { retireDuckDBFile } = require('../utils/duckdbFiles');
const { buildDatabaseInChild, ACCEPTED_EXTS } = require('../utils/fileImport');
const queryCache = require('../utils/queryCache');
const rollupBuilder = require('../utils/rollupBuilder');

const router = express.Router();

// Access scoping (cloud org-scopes these; OSS scopes by owner).
function dedupUpload(req, originalFilename) {
  if (typeof cloudHooks.dedupUpload === 'function') return cloudHooks.dedupUpload(req, originalFilename);
  return db.prepare("SELECT id, name, extra_config FROM datasources WHERE user_id = ? AND extra_config LIKE ?")
    .get(req.user.id, `%"sourceFile":"${originalFilename}"%`);
}
function listUploadedDatasources(req) {
  if (typeof cloudHooks.listUploadedDatasources === 'function') return cloudHooks.listUploadedDatasources(req);
  return wsAccess.listVisibleDatasources(wsAccess.actorOf(req)).filter((s) => s.db_type === 'duckdb' && String(s.extra_config || '').includes('sourceFile'));
}
function stampNewDatasource(req, id) {
  if (typeof cloudHooks.onDatasourceCreate === 'function') cloudHooks.onDatasourceCreate(req, id);
}
// Returns the FULL row (secrets included) — used here only to read db_name and
// extra_config, never sent to the client.
function getDatasource(id, req) {
  const row = db.prepare('SELECT * FROM datasources WHERE id = ?').get(id);
  return row && wsAccess.canReadDatasource(row, wsAccess.actorOf(req)) ? row : null;
}
// Where an uploaded file lands: the workspace asked for, else the caller's
// personal one; adding a source there is a workspace admin's call. Returns the
// workspace id, or null after a 403.
function targetWorkspaceFor(req, res) {
  const wsId = req.body.workspaceId || wsAccess.personalWorkspaceOf(req);
  if (!wsAccess.canCreateDatasourceIn(wsId, wsAccess.actorOf(req))) {
    res.status(403).json({ error: 'Only a workspace admin can add a data source there' });
    return null;
  }
  return wsId;
}

// Ensure upload directories exist — under the data directory, like the DB.
const uploadsDir = path.join(process.env.OPENREPORT_DATA_DIR || path.join(__dirname, '..', 'data'), 'uploads');
const duckdbDir = DUCKDB_DIR;
[uploadsDir, duckdbDir].forEach((d) => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// Multer config — accept CSV, Excel, Parquet, JSON, SQLite, DuckDB
const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`),
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ACCEPTED_EXTS.includes(ext)) cb(null, true);
    else cb(new Error(`Unsupported file type: ${ext}. Allowed: ${ACCEPTED_EXTS.join(', ')}`));
  },
});

// Upload file → import into DuckDB → create datasource
router.post('/', authFor('write'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const file = req.file;

  // Run any registered upload checks (e.g. cloud-edition per-plan quota).
  // OSS users have no checks registered, so this is a no-op for them.
  const veto = await uploadHooks.runChecks(req, file);
  if (veto) {
    try { fs.unlinkSync(file.path); } catch { /* ignore */ }
    return res.status(413).json({ error: veto });
  }

  const ext = path.extname(file.originalname).toLowerCase();
  const name = req.body.name || path.basename(file.originalname, ext);
  const targetWs = targetWorkspaceFor(req, res);
  if (!targetWs) { try { fs.unlinkSync(file.path); } catch { /* ignore */ } return; }

  // A datasource already carries this name → block and tell the user, rather
  // than silently branching them onto it. Takes precedence over the same-file
  // reuse below: re-importing a file yields the same derived name, so the user
  // gets an explicit "already exists" instead of a surprise reuse.
  if (nameTaken('datasource', name, req)) {
    try { fs.unlinkSync(file.path); } catch { /* ignore */ }
    return res.status(409).json({ error: `A datasource named "${name}" already exists.` });
  }
  // Same source file already imported under a still-free name → reuse it.
  const existing = dedupUpload(req, file.originalname);
  if (existing) {
    try { fs.unlinkSync(file.path); } catch { /* ignore */ }
    const extra = JSON.parse(existing.extra_config || '{}');
    return res.status(200).json({
      datasource: { id: existing.id, name: existing.name, db_type: 'duckdb', tableName: extra.tableName, rowCount: extra.rowCount, sourceFile: extra.sourceFile },
      reused: true,
    });
  }

  const dsId = uuidv4();
  const duckdbPath = versionPath(dsId);

  try {
    const tables = await buildDatabaseInChild({ outPath: duckdbPath, file: { path: file.path, originalname: file.originalname }, ext, body: req.body });
    const primary = tables[0];
    dropUpload(file);

    // Create datasource entry
    db.prepare(`
      INSERT INTO datasources (id, user_id, name, db_type, host, port, db_name, db_user, db_password, extra_config, workspace_id)
      VALUES (?, ?, ?, 'duckdb', '', 0, ?, '', '', ?, ?)
    `).run(dsId, req.user.id, name, duckdbPath, JSON.stringify(extraFromFiles({}, [{
      sourceFile: file.originalname,
      fileSize: file.size,            // bytes — used by cloud quota enforcement
      importedAt: new Date().toISOString(),
      tables: tables.map((t) => ({ tableName: t.tableName, rowCount: t.rowCount })),
    }])), targetWs);
    stampNewDatasource(req, dsId);

    res.status(201).json({
      datasource: {
        id: dsId,
        name,
        db_type: 'duckdb',
        db_name: duckdbPath,
        sourceFile: file.originalname,
        tableName: primary.tableName,
        rowCount: primary.rowCount,
        columns: primary.columns,
        tables,                        // full per-table detail (name, rowCount, columns)
      },
    });
  } catch (err) {
    // The child removed its half-written file; a file it completed is only
    // left behind when the datasource row could not be written.
    dropUpload(file);
    fs.rmSync(duckdbPath, { force: true });
    // Sanitize error message: DuckDB sometimes embeds raw bytes from a malformed file,
    // which renders as gibberish (e.g. "Invalid Error: p���d"). Strip non-printable
    // chars and cap the length so the client gets a readable message.
    const rawMsg = String(err && err.message ? err.message : err);
    const cleanMsg = rawMsg.replace(/[^\x20-\x7E\r\n\t]/g, '?').slice(0, 500);
    res.status(500).json({ error: `Import failed: ${cleanMsg}` });
  }
});

// The uploaded file is only a vehicle: gone once imported or refused. On
// Windows DuckDB may still hold it for a moment; the upload dir is scratch.
function dropUpload(file) {
  try { fs.unlinkSync(file.path); } catch { /* still held — left to the scratch dir */ }
}

// The files an imported source is made of. A source imported before it could
// hold several is one file, and every table of the source is that file's.
function filesOf(extra) {
  if (Array.isArray(extra.files) && extra.files.length) return extra.files;
  const tables = Array.isArray(extra.tables) && extra.tables.length
    ? extra.tables.map((t) => ({ tableName: t.tableName, rowCount: t.rowCount }))
    : (extra.tableName ? [{ tableName: extra.tableName, rowCount: extra.rowCount }] : []);
  return [{ sourceFile: extra.sourceFile, fileSize: extra.fileSize, importedAt: extra.importedAt, tables }];
}

// The source-wide fields every reader of extra_config already knows — the
// first table for single-table callers, the full list, the total size the
// cloud quota adds up — derived from the file list so they cannot disagree.
function extraFromFiles(extra, files) {
  const tables = files.flatMap((f) => f.tables);
  return {
    ...extra,
    files,
    sourceFile: files[0].sourceFile,
    tableName: tables[0].tableName,
    rowCount: tables[0].rowCount,
    tables,
    fileSize: files.reduce((sum, f) => sum + (Number(f.fileSize) || 0), 0),
    importedAt: new Date().toISOString(),
  };
}

// Every import writes a new file: the one the served instances hold stays
// untouched until the datasource points elsewhere.
function versionPath(dsId) {
  return path.join(duckdbDir, `${dsId}-${uuidv4().slice(0, 8)}.duckdb`);
}

// Write a new version of an imported source with newer data for one of its
// files (`replacing`, an index): the tables of its other files — a source
// imported before "one file, one source" can hold several — are copied from
// the current version.
//
// Same id, same name: creating a second datasource instead would orphan every
// model and report already built on this one.
async function refreshFile(req, res, ds, extra, files, replacing) {
  const file = req.file;
  const ext = path.extname(file.originalname).toLowerCase();
  const keptTables = files.filter((_, i) => i !== replacing).flatMap((f) => f.tables.map((t) => t.tableName));
  const previous = files[replacing].tables.map((t) => t.tableName);
  const oldPath = ds.db_name;
  const newPath = versionPath(ds.id);

  try {
    const tables = await buildDatabaseInChild({
      outPath: newPath,
      file: { path: file.path, originalname: file.originalname },
      ext,
      body: req.body,
      keep: { fromPath: oldPath, tables: keptTables },
      renameSingleTo: previous.length === 1 ? previous[0] : null,
    });
    dropUpload(file);

    const entry = {
      sourceFile: file.originalname,
      fileSize: file.size,
      importedAt: new Date().toISOString(),
      tables: tables.map((t) => ({ tableName: t.tableName, rowCount: t.rowCount })),
    };
    const nextFiles = files.map((f, i) => (i === replacing ? entry : f));
    // One statement: the datasource must never name a file whose contents it
    // no longer describes.
    db.prepare('UPDATE datasources SET db_name = ?, extra_config = ? WHERE id = ?')
      .run(newPath, JSON.stringify(extraFromFiles(extra, nextFiles)), ds.id);

    // Retire the previous version. Queries already running on it finish; a
    // file Windows will not delete yet is orphaned but harmless — nothing
    // points at it any more.
    invalidateDatasource(ds.id);
    await retireDuckDBFile(oldPath);

    // Cached rows and materialised rollups were computed on the previous data.
    queryCache.invalidateDatasource(ds.id);
    rollupBuilder.dropAllRollupsForDatasource({ datasourceId: ds.id, orgId: req.organizationId || null })
      .catch((e) => console.warn('[rollup] invalidate on file import failed:', e.message));

    // Tables the model may no longer resolve. The model editor flags broken
    // references already, but the user deserves to hear it at the moment they
    // caused it rather than the next time they open the model.
    const arrived = new Set(tables.map((t) => t.tableName));
    res.json({
      datasource: {
        id: ds.id, name: ds.name, db_type: 'duckdb',
        sourceFile: file.originalname,
        tableName: tables[0].tableName, rowCount: tables[0].rowCount,
        tables,                          // this file's tables, with their columns
        files: nextFiles,
      },
      missingTables: previous.filter((t) => !arrived.has(t)),
    });
  } catch (err) {
    // The datasource still points at the previous version, never touched.
    dropUpload(file);
    const rawMsg = String(err && err.message ? err.message : err);
    res.status(500).json({ error: `Import failed: ${rawMsg.replace(/[^\x20-\x7E\r\n\t]/g, '?').slice(0, 500)}` });
  }
}

// Refresh one file of an imported source with new data. A source made of
// several files names the one to replace (`sourceFile`); a single-file source
// needs no name.
router.put('/:id', authFor('write'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const ds = getDatasource(req.params.id, req);
  if (!ds) { dropUpload(req.file); return res.status(404).json({ error: 'Datasource not found' }); }
  if (!wsAccess.canManageDatasource(ds, wsAccess.actorOf(req))) {
    dropUpload(req.file);
    return res.status(403).json({ error: 'Only a workspace admin can replace this data source' });
  }
  let extra = {};
  try { extra = JSON.parse(ds.extra_config || '{}'); } catch { /* malformed row — rejected just below */ }
  if (ds.db_type !== 'duckdb' || !extra.sourceFile) {
    dropUpload(req.file);
    return res.status(400).json({ error: 'This datasource is a live connection, not an imported file.' });
  }
  // Same per-plan quota checks as a first import — a replacement can weigh
  // more than what it replaces.
  const veto = await uploadHooks.runChecks(req, req.file);
  if (veto) { dropUpload(req.file); return res.status(413).json({ error: veto }); }

  const files = filesOf(extra);
  const replacing = files.length === 1 ? 0 : files.findIndex((f) => f.sourceFile === req.body.sourceFile);
  if (replacing < 0) {
    dropUpload(req.file);
    return res.status(400).json({ error: 'Pick the file of this source to refresh.' });
  }
  await refreshFile(req, res, ds, extra, files, replacing);
});

// List uploaded file datasources
router.get('/', authFor('read'), (req, res) => {
  const sources = listUploadedDatasources(req);
  res.json({
    sources: sources.map((s) => ({
      ...s,
      extra_config: JSON.parse(s.extra_config || '{}'),
    })),
  });
});

module.exports = router;
