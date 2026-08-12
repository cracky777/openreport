const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { authFor } = require('../middleware/auth');
const db = require('../db');
const uploadHooks = require('../hooks/upload');
const cloudHooks = require('../cloudHooks');
const { nameTaken } = require('../utils/nameUniqueness');
const { invalidateDatasource, closeDuckDBFile, adoptDuckDBInstance } = require('../utils/dbConnector');
const queryCache = require('../utils/queryCache');
const rollupBuilder = require('../utils/rollupBuilder');

const router = express.Router();

// Whitelisted CSV parse options. The client sends opaque tokens; we map them
// here to safe DuckDB fragments so nothing user-supplied is ever interpolated
// raw into the import SQL. An unknown token falls back to auto-detection.
const CSV_DELIMS = { comma: ',', semicolon: ';', tab: '\t', pipe: '|' };
const CSV_DECIMALS = { point: '.', comma: ',' };
const CSV_ENCODINGS = { utf8: 'utf-8', latin1: 'latin-1' };
const CSV_DATEFORMATS = { dmy_slash: '%d/%m/%Y', mdy_slash: '%m/%d/%Y', iso: '%Y-%m-%d' };

// Access scoping (cloud org-scopes these; OSS scopes by owner).
function dedupUpload(req, originalFilename) {
  if (typeof cloudHooks.dedupUpload === 'function') return cloudHooks.dedupUpload(req, originalFilename);
  return db.prepare("SELECT id, name, extra_config FROM datasources WHERE user_id = ? AND extra_config LIKE ?")
    .get(req.user.id, `%"sourceFile":"${originalFilename}"%`);
}
function listUploadedDatasources(req) {
  if (typeof cloudHooks.listUploadedDatasources === 'function') return cloudHooks.listUploadedDatasources(req);
  return db.prepare("SELECT * FROM datasources WHERE user_id = ? AND db_type = 'duckdb' AND extra_config LIKE '%sourceFile%'").all(req.user.id);
}
function stampNewDatasource(req, id) {
  if (typeof cloudHooks.onDatasourceCreate === 'function') cloudHooks.onDatasourceCreate(req, id);
}
// Returns the FULL row (secrets included) — used here only to read db_name and
// extra_config, never sent to the client.
function getDatasource(id, req) {
  if (typeof cloudHooks.getDatasource === 'function') return cloudHooks.getDatasource(id, req);
  return db.prepare('SELECT * FROM datasources WHERE id = ? AND user_id = ?').get(id, req.user.id);
}

// Ensure upload directories exist
const uploadsDir = path.join(__dirname, '..', 'data', 'uploads');
const duckdbDir = path.join(__dirname, '..', 'data', 'duckdb');
[uploadsDir, duckdbDir].forEach((d) => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// Multer config — accept CSV, Excel, Parquet, JSON
const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`),
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['.csv', '.xlsx', '.xls', '.parquet', '.json', '.tsv'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error(`Unsupported file type: ${ext}. Allowed: ${allowed.join(', ')}`));
  },
});

// Import an uploaded file into the tables of an already-open DuckDB instance.
//
// Shared by the create and the replace routes on purpose: the parsing rules are
// the contract between a file and its tables, and letting "first import" drift
// from "same file, new data" would make a refresh silently reshape the model
// built on it.
//
// The caller owns the instance. Reopening a DuckDB file this process has opened
// before does not work — not even after close() — so everything a route needs
// to do to a database has to go through one handle.
async function importTables({ dbInstance, file, ext, body, tableNamer }) {
  {
    // Import based on file type. Each imported unit becomes a DuckDB table; a
    // spreadsheet can yield several (one per selected sheet), a flat file one.
    const filePath = file.path.replace(/\\/g, '/'); // DuckDB needs forward slashes
    const tables = []; // { tableName, rowCount, columns }
    const usedTableNames = new Set();
    const uniqueTableName = (base) => {
      const s = tableNamer ? tableNamer(sanitizeTableName(base)) : sanitizeTableName(base);
      let candidate = s, i = 2;
      while (usedTableNames.has(candidate)) candidate = `${s}_${i++}`;
      usedTableNames.add(candidate);
      return candidate;
    };
    const describeTable = async (t) => {
      const cnt = await dbInstance.all(`SELECT COUNT(*) as cnt FROM "${t}"`);
      const cols = await dbInstance.all(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '${t}' ORDER BY ordinal_position`);
      return { tableName: t, rowCount: Number(cnt[0]?.cnt || 0), columns: cols };
    };

    // CSV/TSV import handled inline so we can fall back to Latin-1 if UTF-8 fails.
    // Many real-world CSVs (e.g. FAOSTAT, exports from Excel) are Windows-1252 / Latin-1
    // and DuckDB returns garbled errors when it tries to parse them as UTF-8.
    if (ext === '.csv' || ext === '.tsv') {
      const t = uniqueTableName(path.basename(file.originalname, ext));
      // Resolve parse options from the whitelisted tokens; absent tokens keep
      // DuckDB's auto-detection.
      const delim = CSV_DELIMS[body.delimiter];  // undefined = auto-detect
      const header = body.hasHeader === 'false' ? 'false' : 'true';
      const decimal = CSV_DECIMALS[body.decimalSeparator];
      const dateformat = CSV_DATEFORMATS[body.dateFormat];
      const chosenEnc = CSV_ENCODINGS[body.encoding];

      const optList = [`header=${header}`, 'sample_size=-1'];
      // Only pin the delimiter when explicitly chosen — forcing delim=',' makes
      // the sniffer fail on ';'/tab files ("Delimiter Candidates: ','"). Leaving
      // it out lets DuckDB try all candidates; .tsv keeps a tab prior.
      if (delim) optList.push(`delim='${delim}'`);
      else if (ext === '.tsv') optList.push(`delim='\t'`);
      if (decimal) optList.push(`decimal_separator='${decimal}'`);
      if (dateformat) optList.push(`dateformat='${dateformat}'`);
      const buildSQL = (encoding) =>
        `CREATE TABLE "${t}" AS SELECT * FROM read_csv_auto('${filePath}', ${optList.join(', ')}${encoding ? `, encoding='${encoding}'` : ''})`;

      if (chosenEnc) {
        await dbInstance.run(buildSQL(chosenEnc));        // explicit encoding → no fallback
      } else {
        try {
          await dbInstance.run(buildSQL());               // try UTF-8 (default) first
        } catch (firstErr) {
          try { await dbInstance.run(`DROP TABLE IF EXISTS "${t}"`); } catch { /* ignore */ }
          try {
            await dbInstance.run(buildSQL('latin-1'));    // retry with Latin-1
          } catch {
            throw firstErr;                               // surface the original UTF-8 error
          }
        }
      }
      tables.push(await describeTable(t));
    } else if (ext === '.xlsx' || ext === '.xls') {
      // A workbook can hold several sheets — import each selected one as its own
      // table. The client sends the chosen sheet names as a JSON array; absent
      // or invalid → the first sheet only (backward compatible). The header flag
      // applies here too (first spreadsheet row as column names, or not).
      const XLSX = require('xlsx');
      const workbook = XLSX.readFile(file.path);
      const header = body.hasHeader === 'false' ? 'false' : 'true';
      let wanted;
      try { wanted = JSON.parse(body.sheets || '[]'); } catch { wanted = []; }
      if (!Array.isArray(wanted)) wanted = [];
      wanted = wanted.filter((s) => workbook.SheetNames.includes(s));
      if (!wanted.length) wanted = [workbook.SheetNames[0]];
      for (const sheetName of wanted) {
        const csvContent = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]);
        const csvPath = `${file.path}.${uuidv4()}.csv`; // unique temp per sheet
        fs.writeFileSync(csvPath, csvContent, 'utf-8');
        const csvPathFwd = csvPath.replace(/\\/g, '/');
        const t = uniqueTableName(sheetName);
        await dbInstance.run(`CREATE TABLE "${t}" AS SELECT * FROM read_csv_auto('${csvPathFwd}', header=${header}, sample_size=-1)`);
        try { fs.unlinkSync(csvPath); } catch { /* ignore */ }
        tables.push(await describeTable(t));
      }
    } else if (ext === '.parquet') {
      const t = uniqueTableName(path.basename(file.originalname, ext));
      await dbInstance.run(`CREATE TABLE "${t}" AS SELECT * FROM read_parquet('${filePath}')`);
      tables.push(await describeTable(t));
    } else if (ext === '.json') {
      const t = uniqueTableName(path.basename(file.originalname, ext));
      await dbInstance.run(`CREATE TABLE "${t}" AS SELECT * FROM read_json_auto('${filePath}')`);
      tables.push(await describeTable(t));
    } else {
      throw new Error(`Unsupported file type: ${ext}`);
    }
    return tables;
  }
}

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
  const duckdbPath = path.join(duckdbDir, `${dsId}.duckdb`);

  try {
    const duckdb = require('duckdb-async');
    const dbInstance = await duckdb.Database.create(duckdbPath);
    let tables;
    try {
      tables = await importTables({ dbInstance, file, ext, body: req.body });
    } finally {
      await dbInstance.close();
    }
    const primary = tables[0];

    // Clean up uploaded file (data is now in DuckDB)
    try { fs.unlinkSync(file.path); } catch { /* ignore */ }

    // Create datasource entry
    db.prepare(`
      INSERT INTO datasources (id, user_id, name, db_type, host, port, db_name, db_user, db_password, extra_config)
      VALUES (?, ?, ?, 'duckdb', '', 0, ?, '', '', ?)
    `).run(dsId, req.user.id, name, duckdbPath, JSON.stringify({
      sourceFile: file.originalname,
      tableName: primary.tableName,   // first table — kept for single-table callers
      rowCount: primary.rowCount,
      tables: tables.map((t) => ({ tableName: t.tableName, rowCount: t.rowCount })),
      fileSize: file.size,            // bytes — used by cloud quota enforcement
      importedAt: new Date().toISOString(),
    }));
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
    // Cleanup on error
    try { fs.unlinkSync(file.path); } catch { /* ignore */ }
    // Wait a bit for file handle release on Windows
    await new Promise((r) => setTimeout(r, 200));
    try { fs.unlinkSync(duckdbPath); } catch { /* ignore */ }
    try { fs.unlinkSync(duckdbPath + '.wal'); } catch { /* ignore */ }
    // Sanitize error message: DuckDB sometimes embeds raw bytes from a malformed file,
    // which renders as gibberish (e.g. "Invalid Error: p���d"). Strip non-printable
    // chars and cap the length so the client gets a readable message.
    const rawMsg = String(err && err.message ? err.message : err);
    const cleanMsg = rawMsg.replace(/[^\x20-\x7E\r\n\t]/g, '?').slice(0, 500);
    res.status(500).json({ error: `Import failed: ${cleanMsg}` });
  }
});

// Re-import a file into an EXISTING imported datasource: same id, same name,
// fresh data. Creating a second datasource instead would orphan every model and
// report already built on this one — refreshing in place is the whole point.
router.put('/:id', authFor('write'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const file = req.file;
  const dropUpload = () => { try { fs.unlinkSync(file.path); } catch { /* ignore */ } };

  const ds = getDatasource(req.params.id, req);
  if (!ds) { dropUpload(); return res.status(404).json({ error: 'Datasource not found' }); }

  let extra = {};
  try { extra = JSON.parse(ds.extra_config || '{}'); } catch { /* malformed row — rejected just below */ }
  if (ds.db_type !== 'duckdb' || !extra.sourceFile) {
    dropUpload();
    return res.status(400).json({ error: 'This datasource is a live connection, not an imported file.' });
  }

  // Same per-plan quota checks as a first import — a replacement can weigh more
  // than what it replaces.
  const veto = await uploadHooks.runChecks(req, file);
  if (veto) { dropUpload(); return res.status(413).json({ error: veto }); }

  const ext = path.extname(file.originalname).toLowerCase();
  const previous = Array.isArray(extra.tables) && extra.tables.length
    ? extra.tables.map((t) => t.tableName)
    : (extra.tableName ? [extra.tableName] : []);

  // A brand-new file, and the datasource is pointed at it once the import
  // succeeded. Importing into the live one is not an option: the query path
  // holds it open with external access disabled (so it cannot read a CSV), and
  // DuckDB refuses to reopen a path this process has already opened — even
  // after close(). A fresh path sidesteps both, and leaves the previous data
  // serving reports until the very last moment.
  const oldPath = ds.db_name;
  const newPath = path.join(duckdbDir, `${req.params.id}-${uuidv4().slice(0, 8)}.duckdb`);

  const duckdb = require('duckdb-async');
  const dbInstance = await duckdb.Database.create(newPath);

  try {
    const tables = await importTables({ dbInstance, file, ext, body: req.body });
    dropUpload();

    // Models address tables by name. A monthly export whose filename carries
    // the month arrives under a new name and would silently break every model
    // built on it — so when the old shape leaves no ambiguity, the name the
    // model already knows is kept. Renamed through the handle that just created
    // it, since reopening is exactly what does not work here.
    if (previous.length === 1 && tables.length === 1 && tables[0].tableName !== previous[0]) {
      if (previous[0].includes('"')) throw new Error(`Invalid table name: ${previous[0]}`);
      await dbInstance.run(`ALTER TABLE "${tables[0].tableName}" RENAME TO "${previous[0]}"`);
      tables[0].tableName = previous[0];
    }

    // Shut external access off — irreversibly, which is the point — and hand
    // the live instance to the query path rather than closing it. Closing would
    // strand the new path: this process has opened it, and DuckDB will not open
    // it again. See adoptDuckDBInstance.
    await dbInstance.run('SET enable_external_access=false');
    adoptDuckDBInstance(newPath, dbInstance);

    const primary = tables[0];
    // One statement: the datasource must never name a file whose contents it
    // no longer describes.
    db.prepare('UPDATE datasources SET db_name = ?, extra_config = ? WHERE id = ?').run(newPath, JSON.stringify({
      ...extra,
      sourceFile: file.originalname,
      tableName: primary.tableName,
      rowCount: primary.rowCount,
      tables: tables.map((t) => ({ tableName: t.tableName, rowCount: t.rowCount })),
      fileSize: file.size,
      importedAt: new Date().toISOString(),
    }), req.params.id);

    // Retire the previous file. Closing its instance is what lets Windows
    // delete it; if it still refuses, the file is orphaned but harmless —
    // nothing points at it any more.
    invalidateDatasource(req.params.id);
    await closeDuckDBFile(oldPath);
    for (let attempt = 0; attempt < 3; attempt++) {
      try { fs.rmSync(oldPath, { force: true }); fs.rmSync(`${oldPath}.wal`, { force: true }); break; }
      catch { await new Promise((r) => setTimeout(r, 200)); }
    }

    // Every cached row and materialised rollup describes the previous file.
    queryCache.invalidateDatasource(req.params.id);
    rollupBuilder.dropAllRollupsForDatasource({ datasourceId: req.params.id, orgId: req.organizationId || null })
      .catch((e) => console.warn('[rollup] invalidate on file replace failed:', e.message));

    // Tables the model may no longer resolve. The model editor flags broken
    // references already, but the user deserves to hear it at the moment they
    // caused it rather than the next time they open the model.
    const arrived = new Set(tables.map((t) => t.tableName));
    res.json({
      datasource: {
        id: req.params.id, name: ds.name, db_type: 'duckdb',
        sourceFile: file.originalname,
        tableName: primary.tableName, rowCount: primary.rowCount, tables,
      },
      missingTables: previous.filter((t) => !arrived.has(t)),
    });
  } catch (err) {
    dropUpload();
    // The datasource still points at the old file, which was never touched.
    // All there is to undo is the half-written new one.
    try { await dbInstance.close(); } catch { /* already closed */ }
    await new Promise((r) => setTimeout(r, 200));
    try { fs.rmSync(newPath, { force: true }); } catch { /* orphan, harmless */ }
    try { fs.rmSync(`${newPath}.wal`, { force: true }); } catch { /* ignore */ }
    const rawMsg = String(err && err.message ? err.message : err);
    res.status(500).json({ error: `Import failed: ${rawMsg.replace(/[^\x20-\x7E\r\n\t]/g, '?').slice(0, 500)}` });
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

function sanitizeTableName(name) {
  return name
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/^_+/, '')
    .replace(/_+/g, '_')
    .substring(0, 64) || 'data';
}

module.exports = router;
