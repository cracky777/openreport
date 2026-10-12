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
const { invalidateDatasource, createConnection, DUCKDB_DIR } = require('../utils/dbConnector');
const { retireDuckDBFile } = require('../utils/duckdbFiles');
const { buildDatabaseInChild, ACCEPTED_EXTS } = require('../utils/fileImport');
const { utf8CopyPath } = require('../utils/textFile');
const { buildFecPack } = require('../utils/accounting/fecPack');
const { targetsOf } = require('../utils/accounting/accountMap');
const { CHART_NAMES } = require('../utils/accounting/charts');
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

// Multer config — accept CSV/text (FEC included), SAF-T XML, Excel, Parquet, JSON, SQLite, DuckDB
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
      accounting: filesOf(extra).find((f) => f.sourceFile === file.originalname)?.accounting || null,
    });
  }

  const dsId = uuidv4();
  const duckdbPath = versionPath(dsId);

  try {
    const { tables, accounting } = await buildDatabaseInChild({ outPath: duckdbPath, file: { path: file.path, originalname: file.originalname }, ext, body: req.body });
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
      ...(accounting ? { accounting } : {}),
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
      accounting,                      // books of accounts (FEC, SAF-T, DATEV, SIE, XAF): what the import learnt about them
      sameCompany: accounting ? sameCompanySources(req, accounting, dsId) : [],
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

// Books of accounts: a French FEC, a SAF-T audit file, a DATEV export or a SIE file. Two files are the
// same books when they are of one kind and one company (SIREN, organisation
// number), which is what lets their fiscal years share a table.
const isBooksFile = (f) => ['fec', 'saft', 'datev', 'sie', 'xaf', 'jpk', 'ledger'].includes(f?.accounting?.kind);
const companyOf = (a) => a?.companyId || a?.siren || null;
const otherBooks = (a, b) => a.kind !== b.kind || (companyOf(a) && companyOf(b) && companyOf(a) !== companyOf(b));
const otherBooksError = (a, b) => (a.kind !== b.kind
  ? 'The two files are not the same kind of books (FEC, SAF-T, DATEV, SIE, XAF)'
  : `These are another company's books (${b.kind === 'fec' ? 'SIREN' : 'company number'} ${companyOf(b)})`);

// Sources holding other fiscal years of the same company's books (same
// SIREN) that the caller may add these to: the import offers to merge them,
// so years compare in one report. Only in the workspace the books were
// imported into — a merge copies the entries, it never crosses workspaces.
function sameCompanySources(req, accounting, exceptId) {
  if (!companyOf(accounting)) return [];
  const actor = wsAccess.actorOf(req);
  const home = wsAccess.datasourceHome(db.prepare('SELECT id, user_id, workspace_id FROM datasources WHERE id = ?').get(exceptId));
  return listUploadedDatasources(req)
    .filter((s) => s.id !== exceptId && wsAccess.canManageDatasource(s, actor) && wsAccess.datasourceHome(s) === home)
    .map((s) => {
      let extra = {};
      try { extra = typeof s.extra_config === 'string' ? JSON.parse(s.extra_config || '{}') : (s.extra_config || {}); } catch { /* malformed row — not a source of books */ }
      const files = filesOf(extra);
      return files.length && files.every((x) => isBooksFile(x) && x.accounting.kind === accounting.kind && companyOf(x.accounting) === companyOf(accounting))
        ? { id: s.id, name: s.name, years: files.map((x) => x.accounting.fiscalYear).filter(Boolean).sort() }
        : null;
    })
    .filter(Boolean);
}

// The uploaded file is only a vehicle: gone once imported or refused. On
// Windows DuckDB may still hold it for a moment; the upload dir is scratch.
function dropUpload(file) {
  for (const p of [file.path, utf8CopyPath(file.path)]) {
    try { fs.rmSync(p, { force: true }); } catch { /* still held — left to the scratch dir */ }
  }
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
  // The fiscal years of a FEC source share one table: listed once, with all
  // their rows.
  const byName = new Map();
  for (const t of files.flatMap((f) => f.tables)) {
    const seen = byName.get(t.tableName);
    byName.set(t.tableName, seen ? { ...seen, rowCount: (Number(seen.rowCount) || 0) + (Number(t.rowCount) || 0) } : t);
  }
  const tables = [...byName.values()];
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
    const { tables, accounting } = await buildDatabaseInChild({
      outPath: newPath,
      file: { path: file.path, originalname: file.originalname },
      ext,
      body: withLedger(req.body, files[replacing]),
      keep: { fromPath: oldPath, tables: keptTables },
      renameSingleTo: previous.length === 1 ? previous[0] : null,
      accountMap: mapOf(extra),
    });
    dropUpload(file);

    const entry = {
      sourceFile: file.originalname,
      fileSize: file.size,
      importedAt: new Date().toISOString(),
      tables: tables.map((t) => ({ tableName: t.tableName, rowCount: t.rowCount })),
      ...(accounting ? { accounting } : {}),
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
      accounting,
    });
  } catch (err) {
    // The datasource still points at the previous version, never touched.
    dropUpload(file);
    const rawMsg = String(err && err.message ? err.message : err);
    res.status(500).json({ error: `Import failed: ${rawMsg.replace(/[^\x20-\x7E\r\n\t]/g, '?').slice(0, 500)}` });
  }
}

// Newer books for one fiscal year of a multi-year FEC source: the file is
// imported on its own, then merged in place of that year — the years share
// one table, which the per-file refresh above cannot rebuild.
async function refreshFecYear(req, res, ds, extra, files, replacing) {
  const file = req.file;
  const ext = path.extname(file.originalname).toLowerCase();
  const table = files[0].tables[0].tableName;
  const tmpPath = versionPath(ds.id);
  const newPath = versionPath(ds.id);
  const dropTmp = () => { try { fs.rmSync(tmpPath, { force: true }); } catch { /* scratch version, never served */ } };
  try {
    const { accounting } = await buildDatabaseInChild({
      outPath: tmpPath, file: { path: file.path, originalname: file.originalname }, ext, body: withLedger(req.body, files[replacing]), renameSingleTo: table,
    });
    dropUpload(file);
    if (!isBooksFile({ accounting }) || otherBooks(files[0].accounting, accounting)) {
      dropTmp();
      return res.status(400).json({ error: isBooksFile({ accounting }) ? otherBooksError(files[0].accounting, accounting) : 'This source holds books of accounts: refresh it with the same kind of file (FEC, SAF-T, DATEV, SIE or XAF)' });
    }
    const { years, stats } = await buildDatabaseInChild({
      kind: 'mergeFec', outPath: newPath, targetPath: ds.db_name, incomingPath: tmpPath, table,
      replaceYears: [files[replacing].accounting.fiscalYear], chart: files[0].accounting.chart, accountMap: mapOf(extra),
    });
    dropTmp();
    const incoming = { sourceFile: file.originalname, fileSize: file.size, importedAt: new Date().toISOString(), accounting, tables: [{ tableName: table }] };
    const nextFiles = withStats(withYearRows(fecFilesAfter(files.filter((_, i) => i !== replacing), [incoming]), table, years), stats);
    const oldPath = ds.db_name;
    db.prepare('UPDATE datasources SET db_name = ?, extra_config = ? WHERE id = ?')
      .run(newPath, JSON.stringify(extraFromFiles(extra, nextFiles)), ds.id);
    await switchedVersion(req, ds.id, oldPath);
    const rows = years.reduce((n, y) => n + y.rows, 0);
    res.json({
      datasource: { id: ds.id, name: ds.name, db_type: 'duckdb', sourceFile: file.originalname, tableName: table, rowCount: rows, tables: [{ tableName: table, rowCount: rows }], files: nextFiles },
      missingTables: [],
      accounting,
    });
  } catch (err) {
    dropUpload(file);
    dropTmp();
    res.status(500).json({ error: `Import failed: ${String(err?.message || err).replace(/[^\x20-\x7E\r\n\t]/g, '?').slice(0, 500)}` });
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
  if (files.length > 1 && files.every(isBooksFile)) await refreshFecYear(req, res, ds, extra, files, replacing);
  else await refreshFile(req, res, ds, extra, files, replacing);
});

// Merge the books of another FEC source (`from`, typically just imported)
// into this one: one table, one row set per fiscal year, a year present in
// both taken from `from`. The client then deletes `from`, a duplicate.
router.post('/:id/fec-years', authFor('write'), async (req, res) => {
  const target = getDatasource(req.params.id, req);
  if (!target) return res.status(404).json({ error: 'Datasource not found' });
  if (!wsAccess.canManageDatasource(target, wsAccess.actorOf(req))) {
    return res.status(403).json({ error: 'Only a workspace admin can add data to this source' });
  }
  const from = getDatasource(req.body?.from, req);
  if (!from || from.id === target.id) return res.status(404).json({ error: 'Books to add not found' });
  // The entries are copied into the target: the books must be the caller's to
  // hand over, and already in the target's workspace.
  if (!wsAccess.canManageDatasource(from, wsAccess.actorOf(req)) || wsAccess.datasourceHome(from) !== wsAccess.datasourceHome(target)) {
    return res.status(403).json({ error: 'Only books of the same workspace can be merged' });
  }
  const parse = (ds) => { try { return JSON.parse(ds.extra_config || '{}'); } catch { return {}; /* malformed row — refused below */ } };
  const targetExtra = parse(target);
  const targetFiles = filesOf(targetExtra);
  const fromFiles = filesOf(parse(from));
  const allBooks = (files) => files.length > 0 && files.every(isBooksFile) && files.every((f) => f.tables?.length === 1);
  if (target.db_type !== 'duckdb' || from.db_type !== 'duckdb' || !allBooks(targetFiles) || !allBooks(fromFiles)) {
    return res.status(400).json({ error: 'Both sources must hold books of accounts (FEC, SAF-T, DATEV, SIE or XAF) only' });
  }
  const table = targetFiles[0].tables[0].tableName;
  if (fromFiles.some((f) => f.tables[0].tableName !== table)) return res.status(400).json({ error: 'The two sources do not name their entries table alike' });
  const other = fromFiles.find((f) => otherBooks(targetFiles[0].accounting, f.accounting));
  if (other) return res.status(400).json({ error: otherBooksError(targetFiles[0].accounting, other.accounting) });

  const oldPath = target.db_name;
  const newPath = versionPath(target.id);
  try {
    const { years, stats } = await buildDatabaseInChild({
      kind: 'mergeFec', outPath: newPath, targetPath: oldPath, incomingPath: from.db_name, table,
      chart: targetFiles[0].accounting.chart, accountMap: mapOf(targetExtra),
    });
    const nextFiles = withStats(withYearRows(fecFilesAfter(targetFiles, fromFiles), table, years), stats);
    db.prepare('UPDATE datasources SET db_name = ?, extra_config = ? WHERE id = ?')
      .run(newPath, JSON.stringify(extraFromFiles(targetExtra, nextFiles)), target.id);
    await switchedVersion(req, target.id, oldPath);
    res.json({ datasource: { id: target.id, name: target.name, files: nextFiles }, years });
  } catch (err) {
    res.status(500).json({ error: `Merge failed: ${String(err?.message || err).replace(/[^\x20-\x7E\r\n\t]/g, '?').slice(0, 500)}` });
  }
});

// The FEC files of a source once `incoming` is merged in: a fiscal year the
// incoming books bring replaces the one already there.
function fecFilesAfter(files, incoming) {
  const years = new Set(incoming.map((f) => f.accounting.fiscalYear));
  return [...files.filter((f) => !years.has(f.accounting.fiscalYear)), ...incoming]
    .sort((a, b) => (a.accounting.fiscalYear || 0) - (b.accounting.fiscalYear || 0));
}
// Each FEC file's share of the shared table, from the merged row counts.
function withYearRows(files, table, years) {
  return files.map((f) => ({ ...f, tables: [{ tableName: table, rowCount: years.find((y) => y.year === f.accounting.fiscalYear)?.rows || 0 }] }));
}

// The accounts a user placed by hand on a source of books, as { account: line
// number } — what every import of the source applies again.
const mapOf = (extra) => Object.fromEntries(Object.entries(extra.accountMap || {}).map(([a, v]) => [a, v.lineNo]));
// A ledger exported to CSV or Excel is refreshed with the columns and chart
// it was first read with.
const withLedger = (body, file) => (file?.accounting?.ledger && !body.ledger ? { ...body, ledger: JSON.stringify(file.accounting.ledger) } : body);
// Each file's summary once accounts were placed again (accountMap.booksStats).
const withStats = (files, stats) => (stats ? files.map((f) => (stats[f.sourceFile] ? { ...f, accounting: { ...f.accounting, ...stats[f.sourceFile] } } : f)) : files);

// A source now points at a new file: drop what was read from the previous
// one (connections, cached rows, rollups), then the file itself.
async function switchedVersion(req, dsId, oldPath) {
  invalidateDatasource(dsId);
  await retireDuckDBFile(oldPath);
  queryCache.invalidateDatasource(dsId);
  rollupBuilder.dropAllRollupsForDatasource({ datasourceId: dsId, orgId: req.organizationId || null })
    .catch((e) => console.warn('[rollup] invalidate on file import failed:', e.message));
}

// The accounting pack of a source imported from books (FEC, SAF-T, DATEV, SIE, XAF): a plan (model YAML +
// report bundle) the client applies through /models/import and
// /reports/import, with the caller's own rights. The model takes the first
// free name, so offering the pack twice never collides.
router.get('/:id/fec-pack', authFor('read'), (req, res) => {
  const ds = getDatasource(req.params.id, req);
  if (!ds) return res.status(404).json({ error: 'Datasource not found' });
  let extra = {};
  try { extra = JSON.parse(ds.extra_config || '{}'); } catch { /* malformed row — no books to find */ }
  const fecFiles = ds.db_type === 'duckdb' ? filesOf(extra).filter(isBooksFile) : [];
  if (!fecFiles.length || !fecFiles[0].tables?.length) return res.status(404).json({ error: 'This source holds no books of accounts' });
  // A SAF-T from a country whose chart of accounts is not read here is a
  // ledger only: no income statement to build a package on.
  if (fecFiles[0].accounting.kind === 'saft' && !fecFiles[0].accounting.chart) {
    return res.status(404).json({ error: `No Finance package yet for books from ${fecFiles[0].accounting.country || 'this country'}` });
  }
  // The report reads its books one fiscal year at a time.
  if (fecFiles.some((f) => !f.accounting.fiscalYear)) return res.status(409).json({ error: 'Refresh this source with its FEC file first: it was imported before fiscal years were recorded' });
  const latest = fecFiles.reduce((a, b) => (b.accounting.fiscalYear > a.accounting.fiscalYear ? b : a));
  const accounting = {
    ...latest.accounting,
    years: fecFiles.map((f) => f.accounting.fiscalYear).sort(),
    incomeLines: [...new Set(fecFiles.flatMap((f) => f.accounting.incomeLines || []))].sort((x, y) => x - y),
  };
  const base = `${ds.name} — Accounts`;
  let modelName = base;
  for (let i = 2; nameTaken('model', modelName, req); i++) modelName = `${base} ${i}`;
  res.json({
    plan: buildFecPack({ datasourceName: ds.name, tableName: fecFiles[0].tables[0].tableName, accounting, modelName }),
    accounting,
  });
});

// The accounts of a source of books, where each one sits, and where it could
// go: the account mapping a user edits when the chart places an account
// wrongly or not at all. Reading it is reading the books.
async function accountsOf(ds, extra) {
  const files = ds.db_type === 'duckdb' ? filesOf(extra).filter(isBooksFile) : [];
  if (!files.length || !files[0].tables?.length) return null;
  const table = files[0].tables[0].tableName;
  const chart = files[0].accounting.chart || 'pcg';
  const conn = createConnection(ds);
  try {
    // An account's place is that of its own lines, closing entries aside.
    const rows = await conn.query(`SELECT CompteNum AS account, any_value(CompteLib) AS label,
      COALESCE(mode(LineNo) FILTER (WHERE LineNo <> 201), any_value(LineNo))::INTEGER AS "lineNo",
      SUM(Debit)::DOUBLE AS debit, SUM(Credit)::DOUBLE AS credit
      FROM "${String(table).replace(/"/g, '""')}" GROUP BY 1 ORDER BY 1`);
    return { table, chart, rows };
  } finally {
    conn.close();
  }
}

router.get('/:id/accounts', authFor('read'), async (req, res) => {
  const ds = getDatasource(req.params.id, req);
  if (!ds) return res.status(404).json({ error: 'Datasource not found' });
  if (!wsAccess.canQueryDatasource(ds, wsAccess.actorOf(req))) return res.status(403).json({ error: 'Reading these books needs a role in their workspace' });
  let extra = {};
  try { extra = JSON.parse(ds.extra_config || '{}'); } catch { /* malformed row — no books to find */ }
  try {
    const books = await accountsOf(ds, extra);
    if (!books) return res.status(404).json({ error: 'This source holds no books of accounts' });
    const map = extra.accountMap || {};
    res.json({
      chart: books.chart,
      chartName: CHART_NAMES[books.chart] || books.chart,
      canEdit: wsAccess.canManageDatasource(ds, wsAccess.actorOf(req)),
      targets: targetsOf(books.chart),
      accounts: books.rows.map((r) => ({ ...r, mapped: !!map[r.account], original: map[r.account] ? map[r.account].was : r.lineNo })),
    });
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err).slice(0, 300) });
  }
});

// Place accounts: `changes` = { account: line number }. Kept on the source
// (a change back to where the chart put it forgets it), applied to a new
// version of its file in the import process.
router.put('/:id/accounts', authFor('write'), async (req, res) => {
  const ds = getDatasource(req.params.id, req);
  if (!ds) return res.status(404).json({ error: 'Datasource not found' });
  if (!wsAccess.canManageDatasource(ds, wsAccess.actorOf(req))) return res.status(403).json({ error: 'Only a workspace admin can change how these books are read' });
  const changes = req.body?.changes;
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return res.status(400).json({ error: 'changes is required' });
  let extra = {};
  try { extra = JSON.parse(ds.extra_config || '{}'); } catch { /* malformed row — no books to find */ }
  try {
    const books = await accountsOf(ds, extra);
    if (!books) return res.status(404).json({ error: 'This source holds no books of accounts' });
    const allowed = new Set(targetsOf(books.chart).map((t) => t.lineNo));
    const current = new Map(books.rows.map((r) => [r.account, r.lineNo]));
    const map = { ...(extra.accountMap || {}) };
    const job = {};
    for (const [account, value] of Object.entries(changes)) {
      const lineNo = Number(value);
      if (!current.has(account) || !allowed.has(lineNo)) return res.status(400).json({ error: `Account ${String(account).slice(0, 40)} cannot be placed there` });
      const was = map[account] ? map[account].was : current.get(account);
      if (lineNo === was) delete map[account]; else map[account] = { lineNo, was };
      job[account] = lineNo;
    }
    const files = filesOf(extra);
    const oldPath = ds.db_name;
    const newPath = versionPath(ds.id);
    const { stats } = await buildDatabaseInChild({ kind: 'reclassify', outPath: newPath, sourcePath: oldPath, table: books.table, chart: books.chart, accountMap: job });
    const nextExtra = { ...extraFromFiles(extra, withStats(files, stats)), accountMap: map };
    db.prepare('UPDATE datasources SET db_name = ?, extra_config = ? WHERE id = ?').run(newPath, JSON.stringify(nextExtra), ds.id);
    await switchedVersion(req, ds.id, oldPath);
    res.json({ mapped: Object.keys(map).length, files: nextExtra.files.map((x) => ({ sourceFile: x.sourceFile, accounting: x.accounting })) });
  } catch (err) {
    res.status(500).json({ error: `Mapping failed: ${String(err?.message || err).replace(/[^\x20-\x7E\r\n\t]/g, '?').slice(0, 300)}` });
  }
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
