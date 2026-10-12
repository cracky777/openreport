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
const { isValidUtf8, writeUtf8Copy, utf8CopyPath } = require('./textFile');
const { detectFec, importFec } = require('./accounting/fec');
const { detectSaft, importSaft } = require('./accounting/saft');
const { detectDatev, importDatev } = require('./accounting/datev');
const { detectSie, importSie } = require('./accounting/sie');
const { detectXaf, importXaf } = require('./accounting/xaf');
const { detectJpk, importJpk } = require('./accounting/jpk');
const { applyAccountMap, booksStats } = require('./accounting/accountMap');
const { importLedger } = require('./accounting/ledger');

// Whitelisted CSV parse options. The client sends opaque tokens; we map them
// here to safe DuckDB fragments so nothing user-supplied is ever interpolated
// raw into the import SQL. An unknown token falls back to auto-detection.
const CSV_DELIMS = { comma: ',', semicolon: ';', tab: '\t', pipe: '|' };
const CSV_DECIMALS = { point: '.', comma: ',' };
const CSV_DATEFORMATS = { dmy_slash: '%d/%m/%Y', mdy_slash: '%m/%d/%Y', iso: '%Y-%m-%d' };

// Database files: whole databases whose tables are copied in through an ATTACH.
// SQLite travels under several extensions and `.db` is also a generic suffix,
// so the magic header is checked at import time rather than trusting the name.
// DuckDB files carry "DUCK" after an 8-byte checksum.
const SQLITE_EXTS = ['.db', '.sqlite', '.sqlite3'];
const DUCKDB_EXTS = ['.duckdb', '.ddb'];
const SQLITE_MAGIC = { offset: 0, bytes: 'SQLite format 3\0' };
const DUCKDB_MAGIC = { offset: 8, bytes: 'DUCK' };
// Plain text: .txt is how a FEC is named, and how many tools name a CSV.
const TEXT_EXTS = ['.csv', '.tsv', '.txt', '.fec'];
// Swedish SIE books travel as .se (SIE 4), .si or .sie.
const SIE_EXTS = ['.se', '.si', '.sie'];
// XML: an audit file (SAF-T, the Dutch XAF, the Polish JPK_KR_PD) only — any other XML is refused, not guessed at.
const ACCEPTED_EXTS = [...TEXT_EXTS, ...SIE_EXTS, '.xlsx', '.xls', '.parquet', '.json', '.xml', '.xaf', ...SQLITE_EXTS, ...DUCKDB_EXTS];

const q = (ident) => `"${String(ident).replace(/"/g, '""')}"`;
const fwd = (p) => p.replace(/\\/g, '/'); // DuckDB needs forward slashes

function sanitizeTableName(name) {
  return name
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/^_+/, '')
    .replace(/_+/g, '_')
    .substring(0, 64) || 'data';
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

  // A French accounting export, whatever its name says: read as the books it
  // is, not as a CSV. A file named .fec that is not one is refused rather than
  // guessed at.
  const fec = TEXT_EXTS.includes(ext) ? detectFec(file.path) : null;
  if (ext === '.fec' && !fec) throw new Error(`${file.originalname} does not start with the FEC header (JournalCode, EcritureDate, CompteNum… separated by tabs or |)`);
  if (fec) {
    const t = uniqueTableName('entries');
    const accounting = await importFec({ dbInstance, filePath: file.path, originalName: file.originalname, fec, tableName: t });
    return { tables: [await describeTable(t)], accounting };
  }
  // A German DATEV bookings export, likewise by its first line.
  const datev = TEXT_EXTS.includes(ext) ? detectDatev(file.path) : null;
  if (datev) {
    const t = uniqueTableName('entries');
    const accounting = await importDatev({ dbInstance, filePath: file.path, originalName: file.originalname, datev, tableName: t });
    return { tables: [await describeTable(t)], accounting };
  }
  // Swedish SIE books, by their first record.
  const sie = TEXT_EXTS.includes(ext) || SIE_EXTS.includes(ext) ? detectSie(file.path) : null;
  if (SIE_EXTS.includes(ext) && !sie) throw new Error(`${file.originalname} does not start like a SIE file (#FLAGGA)`);
  if (sie) {
    const t = uniqueTableName('entries');
    const accounting = await importSie({ dbInstance, filePath: file.path, originalName: file.originalname, tableName: t });
    return { tables: [await describeTable(t)], accounting };
  }
  if (ext === '.xml' || ext === '.xaf') {
    const jpk = detectJpk(file.path);
    if (jpk) {
      const t = uniqueTableName('entries');
      const accounting = await importJpk({ dbInstance, filePath: file.path, originalName: file.originalname, jpk, tableName: t });
      return { tables: [await describeTable(t)], accounting };
    }
    const xaf = detectXaf(file.path);
    if (xaf) {
      const t = uniqueTableName('entries');
      const accounting = await importXaf({ dbInstance, filePath: file.path, originalName: file.originalname, tableName: t });
      return { tables: [await describeTable(t)], accounting };
    }
    const saft = detectSaft(file.path);
    if (!saft) throw new Error(`${file.originalname} is not an accounting audit file: only SAF-T Financial, JPK_KR_PD and XML Auditfile Financieel files can be imported`);
    const t = uniqueTableName('entries');
    const accounting = await importSaft({ dbInstance, filePath: file.path, originalName: file.originalname, saft, tableName: t });
    return { tables: [await describeTable(t)], accounting };
  }

  // Many real-world CSVs (e.g. FAOSTAT, exports from Excel) are Windows-1252 /
  // Latin-1. Without a chosen encoding, the file's bytes decide: UTF-8 when they
  // are valid UTF-8, Windows-1252 otherwise, rewritten as UTF-8 before DuckDB
  // reads it — its own Latin-1 reader refuses the € of an Excel export. Letting
  // DuckDB try UTF-8 on a Latin-1 file and retrying on failure crashed the
  // process about one time in six (a native access violation in duckdb 1.4.2).
  if (TEXT_EXTS.includes(ext)) {
    const t = uniqueTableName(path.basename(file.originalname, ext));
    // Resolve parse options from the whitelisted tokens; absent tokens keep
    // DuckDB's auto-detection.
    const delim = CSV_DELIMS[body.delimiter];  // undefined = auto-detect
    const header = body.hasHeader === 'false' ? 'false' : 'true';
    const decimal = CSV_DECIMALS[body.decimalSeparator];
    const dateformat = CSV_DATEFORMATS[body.dateFormat];

    const optList = [`header=${header}`, 'sample_size=-1'];
    // Only pin the delimiter when explicitly chosen — forcing delim=',' makes
    // the sniffer fail on ';'/tab files ("Delimiter Candidates: ','"). Leaving
    // it out lets DuckDB try all candidates; .tsv keeps a tab prior.
    if (delim) optList.push(`delim='${delim}'`);
    else if (ext === '.tsv') optList.push(`delim='\t'`);
    if (decimal) optList.push(`decimal_separator='${decimal}'`);
    if (dateformat) optList.push(`dateformat='${dateformat}'`);
    const utf8 = body.encoding === 'latin1' || (body.encoding !== 'utf8' && !isValidUtf8(file.path)) ? utf8CopyPath(file.path) : null;
    if (utf8) writeUtf8Copy(file.path, utf8);
    await dbInstance.run(`CREATE TABLE ${q(t)} AS SELECT * FROM read_csv_auto('${utf8 ? fwd(utf8) : filePath}', ${optList.join(', ')})`);
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
  // A general ledger exported to CSV or Excel, read as books when the user
  // said which column is what (accounting/ledger.js).
  if (body.ledger && tables.length) {
    const t = uniqueTableName('entries');
    const accounting = await importLedger({ dbInstance, sourceTable: tables[0].tableName, ledger: body.ledger, tableName: t, originalName: file.originalname });
    for (const raw of tables) await dbInstance.run(`DROP TABLE ${q(raw.tableName)}`);
    return { tables: [await describeTable(t)], accounting };
  }
  return { tables };
}

// Books whose accounts the user placed by hand: place them again in the
// table just written, and let the summary say what the books now hold.
async function mapAccounts(dbInstance, table, accounting, accountMap) {
  if (!accounting || !accountMap || !Object.keys(accountMap).length) return null;
  await applyAccountMap(dbInstance, table, accounting.chart || 'pcg', accountMap);
  return booksStats(dbInstance, table);
}

// Write a new database: the tables `keep.tables` of the previous version
// (`keep.fromPath`), then the uploaded file's. `renameSingleTo`: the name the
// file's one table had before a refresh — models address tables by name, and a
// monthly export whose filename carries the month would otherwise break them.
// Runs in the child process.
async function buildDatabase({ outPath, file, ext, body, keep, renameSingleTo, accountMap }) {
  const duckdb = require('duckdb-async');
  const dbInstance = await duckdb.Database.create(outPath);
  try {
    const kept = keep?.tables || [];
    if (kept.length) {
      await dbInstance.run(`ATTACH '${fwd(keep.fromPath)}' AS prev (READ_ONLY)`);
      for (const t of kept) await dbInstance.run(`CREATE TABLE ${q(t)} AS SELECT * FROM prev.main.${q(t)}`);
      await dbInstance.run('DETACH prev');
    }
    const { tables, accounting = null } = await importTables({ dbInstance, file, ext, body, reserved: kept });
    if (renameSingleTo && tables.length === 1 && tables[0].tableName !== renameSingleTo) {
      await dbInstance.run(`ALTER TABLE ${q(tables[0].tableName)} RENAME TO ${q(renameSingleTo)}`);
      tables[0].tableName = renameSingleTo;
    }
    const stats = await mapAccounts(dbInstance, tables[0]?.tableName, accounting, accountMap);
    const own = stats && Object.values(stats)[0];
    return { tables, accounting: own ? { ...accounting, ...own } : accounting };
  } finally {
    await dbInstance.close();
  }
}

// Several fiscal years of the same books in one source, one table: the
// target's rows minus the years the incoming file brings (a newer export of a
// year replaces it) or that `replaceYears` names, plus the incoming rows. The
// target's other tables are copied as they are. Runs in the child process.
async function mergeFecDatabases({ outPath, targetPath, incomingPath, table, replaceYears = [], chart, accountMap }) {
  const duckdb = require('duckdb-async');
  const dbInstance = await duckdb.Database.create(outPath);
  try {
    await dbInstance.run(`ATTACH '${fwd(targetPath)}' AS t (READ_ONLY)`);
    await dbInstance.run(`ATTACH '${fwd(incomingPath)}' AS i (READ_ONLY)`);
    const columnsOf = async (dbName) => (await dbInstance.all(
      "SELECT column_name FROM duckdb_columns() WHERE database_name = ? AND schema_name = 'main' AND table_name = ?", dbName, table,
    )).map((r) => r.column_name);
    // Books imported before fiscal years were recorded cannot be told apart.
    if (!(await columnsOf('t')).includes('FiscalYear')) throw new Error('These books were imported before fiscal years were recorded: refresh the source with its FEC file first');
    if (!(await columnsOf('i')).includes('FiscalYear')) throw new Error('The file added is not a FEC');
    const others = (await dbInstance.all("SELECT table_name FROM duckdb_tables() WHERE database_name = 't' AND schema_name = 'main'"))
      .map((r) => r.table_name).filter((n) => n !== table);
    for (const n of others) await dbInstance.run(`CREATE TABLE ${q(n)} AS SELECT * FROM t.main.${q(n)}`);
    const incomingYears = (await dbInstance.all(`SELECT DISTINCT FiscalYear FROM i.main.${q(table)}`)).map((r) => r.FiscalYear);
    const dropped = [...new Set([...incomingYears, ...replaceYears].map(Number).filter(Number.isInteger))];
    await dbInstance.run(`CREATE TABLE ${q(table)} AS
      SELECT * FROM t.main.${q(table)} ${dropped.length ? `WHERE FiscalYear NOT IN (${dropped.join(', ')})` : ''}
      UNION ALL BY NAME SELECT * FROM i.main.${q(table)}
      ORDER BY EcritureDate, JournalCode, EcritureNum`);
    // An account renamed from one year to the next must stay one account when
    // years are compared side by side: every year shows the latest label.
    await dbInstance.run(`UPDATE ${q(table)} SET Account = latest.Account
      FROM (SELECT CompteNum, arg_max(Account, FiscalYear) AS Account FROM ${q(table)} GROUP BY CompteNum) AS latest
      WHERE ${q(table)}.CompteNum = latest.CompteNum AND ${q(table)}.Account <> latest.Account`);
    await dbInstance.run('DETACH t');
    await dbInstance.run('DETACH i');
    const stats = await mapAccounts(dbInstance, table, { chart }, accountMap);
    const years = await dbInstance.all(`SELECT FiscalYear AS year, COUNT(*)::INTEGER AS rows FROM ${q(table)} GROUP BY 1 ORDER BY 1`);
    const tables = [];
    for (const n of [...others, table]) {
      const [{ cnt }] = await dbInstance.all(`SELECT COUNT(*)::INTEGER AS cnt FROM ${q(n)}`);
      tables.push({ tableName: n, rowCount: cnt });
    }
    return { tables, years, stats };
  } finally {
    await dbInstance.close();
  }
}

// The same books with accounts placed anew (`accountMap`): a copy of the
// source's file, the map applied to its books' table. Runs in the child
// process, like every write of a source's file.
async function reclassifyDatabase({ outPath, sourcePath, table, chart, accountMap }) {
  const duckdb = require('duckdb-async');
  const dbInstance = await duckdb.Database.create(outPath);
  try {
    await dbInstance.run(`ATTACH '${fwd(sourcePath)}' AS s (READ_ONLY)`);
    const names = (await dbInstance.all("SELECT table_name FROM duckdb_tables() WHERE database_name = 's' AND schema_name = 'main'")).map((r) => r.table_name);
    for (const n of names) await dbInstance.run(`CREATE TABLE ${q(n)} AS SELECT * FROM s.main.${q(n)}`);
    await dbInstance.run('DETACH s');
    await applyAccountMap(dbInstance, table, chart, accountMap);
    return { stats: await booksStats(dbInstance, table) };
  } finally {
    await dbInstance.close();
  }
}

// Run buildDatabase in a child process; resolves with the new file's tables
// and, for a book of accounts, what the import learnt about it.
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
      if (reply?.ok) return resolve({ tables: reply.tables, accounting: reply.accounting, years: reply.years, stats: reply.stats });
      fs.rmSync(job.outPath, { force: true });
      fs.rmSync(`${job.outPath}.wal`, { force: true });
      // No reply at all: the process died inside DuckDB (a native crash) — the
      // server itself is untouched, which is why imports run apart.
      reject(new Error(reply?.error || `The file could not be read (the import process stopped, code ${code})${stderr ? `: ${stderr.slice(0, 300)}` : ''}. Choosing its encoding or separator in the import options may help.`));
    });
    child.send(job);
  });
}

module.exports = { buildDatabase, mergeFecDatabases, reclassifyDatabase, buildDatabaseInChild, ACCEPTED_EXTS };
