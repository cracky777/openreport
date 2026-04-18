const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { requireAuth } = require('../middleware/auth');
const db = require('../db');

const router = express.Router();

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

// Upload file → import into DuckDB → create datasource
router.post('/', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const file = req.file;
  const ext = path.extname(file.originalname).toLowerCase();
  const name = req.body.name || path.basename(file.originalname, ext);
  const tableName = sanitizeTableName(path.basename(file.originalname, ext));

  // Check if a datasource with the same source file already exists
  const existing = db.prepare("SELECT id, name, extra_config FROM datasources WHERE user_id = ? AND extra_config LIKE ?")
    .get(req.user.id, `%"sourceFile":"${file.originalname}"%`);
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

  let dbInstance;
  try {
    const duckdb = require('duckdb-async');
    dbInstance = await duckdb.Database.create(duckdbPath);

    // Import based on file type
    const filePath = file.path.replace(/\\/g, '/'); // DuckDB needs forward slashes
    let importSQL;

    if (ext === '.csv' || ext === '.tsv') {
      const delimiter = ext === '.tsv' ? '\t' : ',';
      importSQL = `CREATE TABLE "${tableName}" AS SELECT * FROM read_csv_auto('${filePath}', delim='${delimiter}', header=true, sample_size=-1)`;
    } else if (ext === '.xlsx' || ext === '.xls') {
      // Convert Excel to CSV via xlsx library, then import CSV into DuckDB
      const XLSX = require('xlsx');
      const workbook = XLSX.readFile(file.path);
      const sheetName = workbook.SheetNames[0];
      const csvContent = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]);
      const csvPath = file.path + '.csv';
      fs.writeFileSync(csvPath, csvContent, 'utf-8');
      const csvPathFwd = csvPath.replace(/\\/g, '/');
      importSQL = `CREATE TABLE "${tableName}" AS SELECT * FROM read_csv_auto('${csvPathFwd}', header=true, sample_size=-1)`;
      // Clean up temp CSV after import
      await dbInstance.run(importSQL);
      try { fs.unlinkSync(csvPath); } catch { /* ignore */ }
      importSQL = null; // Already executed
    } else if (ext === '.parquet') {
      importSQL = `CREATE TABLE "${tableName}" AS SELECT * FROM read_parquet('${filePath}')`;
    } else if (ext === '.json') {
      importSQL = `CREATE TABLE "${tableName}" AS SELECT * FROM read_json_auto('${filePath}')`;
    } else {
      throw new Error(`Unsupported file type: ${ext}`);
    }

    if (importSQL) await dbInstance.run(importSQL);

    // Get row count (convert BigInt to Number)
    const countResult = await dbInstance.all(`SELECT COUNT(*) as cnt FROM "${tableName}"`);
    const rowCount = Number(countResult[0]?.cnt || 0);

    // Get columns info (convert any BigInt values)
    const columnsRaw = await dbInstance.all(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '${tableName}' ORDER BY ordinal_position`);
    const columns = columnsRaw.map((c) => {
      const obj = {};
      for (const [k, v] of Object.entries(c)) obj[k] = typeof v === 'bigint' ? Number(v) : v;
      return obj;
    });

    await dbInstance.close();

    // Clean up uploaded file (data is now in DuckDB)
    try { fs.unlinkSync(file.path); } catch { /* ignore */ }

    // Create datasource entry
    db.prepare(`
      INSERT INTO datasources (id, user_id, name, db_type, host, port, db_name, db_user, db_password, extra_config)
      VALUES (?, ?, ?, 'duckdb', '', 0, ?, '', '', ?)
    `).run(dsId, req.user.id, name, duckdbPath, JSON.stringify({
      sourceFile: file.originalname,
      tableName,
      rowCount,
      importedAt: new Date().toISOString(),
    }));

    res.status(201).json({
      datasource: {
        id: dsId,
        name,
        db_type: 'duckdb',
        db_name: duckdbPath,
        sourceFile: file.originalname,
        tableName,
        rowCount,
        columns,
      },
    });
  } catch (err) {
    // Close DuckDB before cleanup
    try { if (dbInstance) await dbInstance.close(); } catch { /* ignore */ }
    // Cleanup on error
    try { fs.unlinkSync(file.path); } catch { /* ignore */ }
    // Wait a bit for file handle release on Windows
    await new Promise((r) => setTimeout(r, 200));
    try { fs.unlinkSync(duckdbPath); } catch { /* ignore */ }
    try { fs.unlinkSync(duckdbPath + '.wal'); } catch { /* ignore */ }
    res.status(500).json({ error: `Import failed: ${err.message}` });
  }
});

// List uploaded file datasources
router.get('/', requireAuth, (req, res) => {
  const sources = db.prepare("SELECT * FROM datasources WHERE user_id = ? AND db_type = 'duckdb' AND extra_config LIKE '%sourceFile%'").all(req.user.id);
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
