// Turning an uploaded file into the DuckDB database behind a file datasource.
//
// Every import writes a NEW database file, in a child process
// (fileImportWorker.js), and the server only ever opens those files read-only.
// Two reasons. On Windows the DuckDB driver does not let go of a file it has
// written, even after close(), until garbage collection: a file written in
// this process could not be opened again, by the query path or by a model
// that reads several sources. And read-only files can be opened by any number
// of instances at once — one per source, plus one per model combining several.
// The child also keeps file parsing, with filesystem access switched on, out
// of the process that serves queries.
const path = require('path');
const fs = require('fs');
const { fork } = require('child_process');
const { v4: uuidv4 } = require('uuid');

// Whitelisted CSV parse options. The client sends opaque tokens; we map them
// here to safe DuckDB fragments so nothing user-supplied is ever interpolated
// raw into the import SQL. An unknown token falls back to auto-detection.
const CSV_DELIMS = { comma: ',', semicolon: ';', tab: '\t', pipe: '|' };
const CSV_DECIMALS = { point: '.', comma: ',' };
const CSV_ENCODINGS = { utf8: 'utf-8', latin1: 'latin-1' };
const CSV_DATEFORMATS = { dmy_slash: '%d/%m/%Y', mdy_slash: '%m/%d/%Y', iso: '%Y-%m-%d' };

// Database files: whole databases whose tables are copied in through an ATTACH.
// SQLite travels under several extensions and `.db` is also a generic suffix,
// so the magic header is checked at import time rather than trusting the name.
// DuckDB files carry "DUCK" after an 8-byte checksum.
const SQLITE_EXTS = ['.db', '.sqlite', '.sqlite3'];
const DUCKDB_EXTS = ['.duckdb', '.ddb'];
const SQLITE_MAGIC = { offset: 0, bytes: 'SQLite format 3\0' };
const DUCKDB_MAGIC = { offset: 8, bytes: 'DUCK' };
const ACCEPTED_EXTS = ['.csv', '.xlsx', '.xls', '.parquet', '.json', '.tsv', ...SQLITE_EXTS, ...DUCKDB_EXTS];

const q = (ident) => `"${String(ident).replace(/"/g, '""')}"`;
const fwd = (p) => p.replace(/\\/g, '/'); // DuckDB needs forward slashes

function sanitizeTableName(name) {
  return name
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/^_+/, '')
    .replace(/_+/g, '_')
    .substring(0, 64) || 'data';
}

// Whether a file's bytes are valid UTF-8, read in chunks — an import can
// weigh hundreds of megabytes.
function isValidUtf8(filePath) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const fd = fs.openSync(filePath, 'r');
  const chunk = Buffer.alloc(1024 * 1024);
  try {
    for (;;) {
      const n = fs.readSync(fd, chunk, 0, chunk.length, null);
      if (n === 0) break;
      decoder.decode(chunk.subarray(0, n), { stream: true });
    }
    decoder.decode();
    return true;
  } catch {
    return false; // an invalid sequence: not UTF-8
  } finally {
    fs.closeSync(fd);
  }
}

function hasMagic(filePath, { offset, bytes }) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const head = Buffer.alloc(bytes.length);
    const n = fs.readSync(fd, head, 0, head.length, offset);
    return n === head.length && head.toString('latin1') === bytes;
  } finally {
    fs.closeSync(fd);
  }
}

// Copy every user table of a database file into the instance's own tables, one
// DuckDB table per source table. Views are left out: they may reference
// functions DuckDB lacks (SQLite) or other attached databases, and the model
// layer is where derived tables belong anyway. Tables outside `main` keep
// their schema as a prefix so two same-named tables cannot collide.
async function copyAttachedTables({ dbInstance, filePath, attachOptions, uniqueTableName, describeTable }) {
  await dbInstance.run(`ATTACH '${filePath}' AS src (${attachOptions})`);
  try {
    const rows = await dbInstance.all(
      "SELECT schema_name, table_name FROM duckdb_tables() WHERE database_name = 'src' AND NOT internal ORDER BY schema_name, table_name"
    );
    const found = rows.filter((r) => !r.table_name.startsWith('sqlite_'));
    if (!found.length) throw new Error('The database file contains no tables');
    const tables = [];
    for (const { schema_name: schema, table_name: table } of found) {
      const t = uniqueTableName(schema === 'main' ? table : `${schema}_${table}`);
      await dbInstance.run(`CREATE TABLE ${q(t)} AS SELECT * FROM src.${q(schema)}.${q(table)}`);
      tables.push(await describeTable(t));
    }
    return tables;
  } finally {
    // The imported file is deleted right after; the database must not depend on it.
    try { await dbInstance.run('DETACH src'); } catch { /* the import error, if any, is the one to report */ }
  }
}

// The sqlite extension is a core DuckDB extension but is not bundled with the
// binary: LOAD succeeds once it sits in the extension directory, and the first
// import on a fresh install needs one INSTALL — which needs network. When both
// fail the error names the cause, since DuckDB's own message only says the
// extension could not be found.
async function loadSqliteExtension(dbInstance) {
  try { await dbInstance.run('LOAD sqlite'); return; } catch { /* not installed yet — try INSTALL */ }
  try {
    await dbInstance.run('INSTALL sqlite');
    await dbInstance.run('LOAD sqlite');
  } catch (err) {
    throw new Error(`SQLite import needs the DuckDB "sqlite" extension, which could not be installed (network required on first use): ${err.message}`);
  }
}

// Import an uploaded file into the tables of an open DuckDB instance.
//
// Shared by every import on purpose: the parsing rules are the contract
// between a file and its tables, and letting "first import" drift from "same
// file, new data" would make a refresh silently reshape the model built on it.
// `reserved`: names the database already holds (the tables of a source's other
// files), which the new tables go around.
async function importTables({ dbInstance, file, ext, body, reserved = [] }) {
  // Each imported unit becomes a DuckDB table; a spreadsheet can yield
  // several (one per selected sheet), a flat file one.
  const filePath = fwd(file.path);
  const tables = []; // { tableName, rowCount, columns }
  const usedTableNames = new Set(reserved);
  const uniqueTableName = (base) => {
    const s = sanitizeTableName(base);
    let candidate = s, i = 2;
    while (usedTableNames.has(candidate)) candidate = `${s}_${i++}`;
    usedTableNames.add(candidate);
    return candidate;
  };
  const describeTable = async (t) => {
    const cnt = await dbInstance.all(`SELECT COUNT(*) as cnt FROM ${q(t)}`);
    const cols = await dbInstance.all(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '${t}' ORDER BY ordinal_position`);
    return { tableName: t, rowCount: Number(cnt[0]?.cnt || 0), columns: cols };
  };

  // Many real-world CSVs (e.g. FAOSTAT, exports from Excel) are Windows-1252 /
  // Latin-1. Without a chosen encoding, the file's bytes decide: UTF-8 when they
  // are valid UTF-8, Latin-1 otherwise. Letting DuckDB try UTF-8 on a Latin-1
  // file and retrying on failure crashed the process about one time in six
  // (a native access violation in duckdb 1.4.2).
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
    const encoding = chosenEnc || (isValidUtf8(file.path) ? null : 'latin-1');
    if (encoding) optList.push(`encoding='${encoding}'`);
    await dbInstance.run(`CREATE TABLE ${q(t)} AS SELECT * FROM read_csv_auto('${filePath}', ${optList.join(', ')})`);
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
      const t = uniqueTableName(sheetName);
      await dbInstance.run(`CREATE TABLE ${q(t)} AS SELECT * FROM read_csv_auto('${fwd(csvPath)}', header=${header}, sample_size=-1)`);
      try { fs.unlinkSync(csvPath); } catch { /* scratch dir */ }
      tables.push(await describeTable(t));
    }
  } else if (ext === '.parquet') {
    const t = uniqueTableName(path.basename(file.originalname, ext));
    await dbInstance.run(`CREATE TABLE ${q(t)} AS SELECT * FROM read_parquet('${filePath}')`);
    tables.push(await describeTable(t));
  } else if (ext === '.json') {
    const t = uniqueTableName(path.basename(file.originalname, ext));
    await dbInstance.run(`CREATE TABLE ${q(t)} AS SELECT * FROM read_json_auto('${filePath}')`);
    tables.push(await describeTable(t));
  } else if (SQLITE_EXTS.includes(ext)) {
    // Copied through the sqlite extension so declared column types survive.
    if (!hasMagic(file.path, SQLITE_MAGIC)) throw new Error(`${file.originalname} is not a SQLite database`);
    await loadSqliteExtension(dbInstance);
    tables.push(...await copyAttachedTables({ dbInstance, filePath, attachOptions: 'TYPE SQLITE, READ_ONLY', uniqueTableName, describeTable }));
  } else if (DUCKDB_EXTS.includes(ext)) {
    // Copied rather than adopted as-is: the datasource file must be one the
    // import wrote, served with external access switched off.
    if (!hasMagic(file.path, DUCKDB_MAGIC)) throw new Error(`${file.originalname} is not a DuckDB database`);
    tables.push(...await copyAttachedTables({ dbInstance, filePath, attachOptions: 'READ_ONLY', uniqueTableName, describeTable }));
  } else {
    throw new Error(`Unsupported file type: ${ext}`);
  }
  return tables;
}

// Write a new database: the tables `keep.tables` of the previous version
// (`keep.fromPath`), then the uploaded file's. `renameSingleTo`: the name the
// file's one table had before a refresh — models address tables by name, and a
// monthly export whose filename carries the month would otherwise break them.
// Runs in the child process.
async function buildDatabase({ outPath, file, ext, body, keep, renameSingleTo }) {
  const duckdb = require('duckdb-async');
  const dbInstance = await duckdb.Database.create(outPath);
  try {
    const kept = keep?.tables || [];
    if (kept.length) {
      await dbInstance.run(`ATTACH '${fwd(keep.fromPath)}' AS prev (READ_ONLY)`);
      for (const t of kept) await dbInstance.run(`CREATE TABLE ${q(t)} AS SELECT * FROM prev.main.${q(t)}`);
      await dbInstance.run('DETACH prev');
    }
    const tables = await importTables({ dbInstance, file, ext, body, reserved: kept });
    if (renameSingleTo && tables.length === 1 && tables[0].tableName !== renameSingleTo) {
      await dbInstance.run(`ALTER TABLE ${q(tables[0].tableName)} RENAME TO ${q(renameSingleTo)}`);
      tables[0].tableName = renameSingleTo;
    }
    return tables;
  } finally {
    await dbInstance.close();
  }
}

// Run buildDatabase in a child process; resolves with the new file's tables.
// On failure the half-written file is removed — the child has exited, so
// nothing holds it.
function buildDatabaseInChild(job) {
  return new Promise((resolve, reject) => {
    // No inherited flags: under `node --watch` the child would watch and never exit.
    const child = fork(path.join(__dirname, 'fileImportWorker.js'), [], { execArgv: [], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    let stderr = '';
    let reply = null;
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('message', (m) => { reply = m; });
    child.on('error', reject);
    // 'close', not 'exit': 'exit' may come before the child's last message is
    // read, and a finished import was then taken for a failure — its file deleted.
    // 'close' waits for the process to end AND for its IPC channel to drain.
    child.on('close', (code) => {
      if (reply?.ok) return resolve(reply.tables);
      fs.rmSync(job.outPath, { force: true });
      fs.rmSync(`${job.outPath}.wal`, { force: true });
      // No reply at all: the process died inside DuckDB (a native crash) — the
      // server itself is untouched, which is why imports run apart.
      reject(new Error(reply?.error || `The file could not be read (the import process stopped, code ${code})${stderr ? `: ${stderr.slice(0, 300)}` : ''}. Choosing its encoding or separator in the import options may help.`));
    });
    child.send(job);
  });
}

module.exports = { buildDatabase, buildDatabaseInChild, ACCEPTED_EXTS };
