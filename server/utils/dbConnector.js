const { Pool, Client } = require('pg');
const mysql = require('mysql2/promise');

// Process-wide DuckDB cache. One open file lock per path — concurrent
// callers share the same resolved Database instance, and concurrent
// FIRST-time callers share the in-flight open promise so the file is
// only opened once even under burst load.
// Module-local (not globalThis) so the cache is testable — require()
// caching already gives module-singleton semantics. The graceful-shutdown
// path in `server/index.js` walks them via `closeAllDuckDB()`.
const _duckdbInstances = new Map();
const _duckdbPromises = new Map();

async function closeAllDuckDB(log = () => {}) {
  for (const [path, db] of _duckdbInstances.entries()) {
    try { await db.close(); log(`closed ${path}`); }
    catch (err) { log(`failed to close ${path}: ${err.message}`); }
  }
  _duckdbInstances.clear();
  _duckdbPromises.clear();
}

// Wrap a `{ promise, cancel }` pair with a timeout safety net so we always
// abort the underlying query when the deadline passes — even if the
// dialect's native timeout doesn't fire (DuckDB has none, BigQuery's
// jobTimeoutMs is best-effort, etc.). When the timeout trips we set
// `timedOut` *before* invoking cancel, so the post-throw branch can
// distinguish a timeout from a user-initiated cancel and surface a
// `TIMEOUT` error code that the UI uses for its warning banner.
function withTimeout({ promise, cancel }, timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return { promise, cancel };
  let timedOut = false;
  let timer = null;
  const wrapped = (async () => {
    timer = setTimeout(() => {
      timedOut = true;
      try { cancel(); } catch { /* best-effort */ }
    }, timeoutMs);
    try {
      return await promise;
    } catch (err) {
      if (timedOut) {
        const e = new Error(`Query timed out after ${Math.round(timeoutMs / 1000)}s`);
        e.code = 'TIMEOUT';
        e.timeoutMs = timeoutMs;
        throw e;
      }
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  })();
  return { promise: wrapped, cancel };
}

function createConnection(datasource) {
  const { db_type, host, port, db_name, db_user, db_password, extra_config } = datasource;
  const extra = extra_config ? (typeof extra_config === 'string' ? JSON.parse(extra_config) : extra_config) : {};

  // ─── PostgreSQL / Azure PostgreSQL ───
  if (db_type === 'postgres' || db_type === 'azure_postgres') {
    const pgConfig = {
      host,
      port: port || 5432,
      database: db_name,
      user: db_user,
      password: db_password,
      // Bumped from 5 → 20 so a multi-widget refresh doesn't starve the
      // pool. Each visual takes one slot for the duration of its query;
      // five was tight as soon as a report had >5 widgets fetching at once.
      max: 20,
      connectionTimeoutMillis: 10_000,
      // Verify the server certificate by default; opt out per-datasource
      // (extra_config.allowSelfSignedCert) for on-prem servers with a
      // self-signed / internal-CA cert.
      ssl: db_type === 'azure_postgres'
        ? { rejectUnauthorized: true }
        : { rejectUnauthorized: !extra.allowSelfSignedCert },
    };
    const pool = new Pool(pgConfig);
    // Prevent unhandled errors on idle clients (e.g. ECONNRESET) from crashing the Node process
    pool.on('error', (err) => {
      console.error('[pg pool error]', err.message);
    });
    // Cancellable variant — acquires its own client so we know the backend
    // PID and can fire a separate `pg_cancel_backend` against it. Without
    // this the SQL keeps running server-side after a client abort and the
    // DB connection stays busy until the query finishes naturally.
    const queryCancellable = (sqlText, opts = {}) => {
      const timeoutMs = Number(opts.timeoutMs) || 0;
      let client = null;
      let canceled = false;
      const promise = (async () => {
        client = await pool.connect();
        try {
          if (canceled) throw new Error('Query canceled');
          // Native PG enforcement is best-effort: some hosted/restricted
          // PG accounts (Azure PG read-only roles, RDS Proxy with
          // statement-rewrite filtering, etc.) refuse `SET statement_timeout`
          // and would propagate that error and 500 the visual. We swallow
          // it — the withTimeout wrapper still enforces the deadline by
          // firing pg_cancel_backend.
          if (timeoutMs > 0) {
            try { await client.query(`SET statement_timeout = ${Math.round(timeoutMs)}`); }
            catch (e) { console.warn('[pg statement_timeout]', e.message); }
          }
          const result = await client.query(sqlText);
          return result.rows;
        } finally {
          try { client.release(canceled ? new Error('canceled') : undefined); }
          catch { /* already released */ }
        }
      })();
      const cancel = async () => {
        if (canceled) return;
        canceled = true;
        for (let i = 0; i < 20 && !client; i++) {
          await new Promise((r) => setTimeout(r, 25));
        }
        const pid = client?.processID;
        if (!pid) return;
        // Use a one-shot pg.Client (NOT the shared pool) so a refresh
        // burst that fires N cancels at once doesn't eat N slots out
        // of the main query pool and starve incoming visual queries.
        const cancelClient = new Client(pgConfig);
        try {
          await cancelClient.connect();
          await cancelClient.query('SELECT pg_cancel_backend($1)', [pid]);
        } catch (e) {
          console.warn('[pg cancel]', e.message);
        } finally {
          try { await cancelClient.end(); } catch { /* already closed */ }
        }
      };
      return withTimeout({ promise, cancel }, timeoutMs);
    };
    return {
      query: async (sql) => { const result = await pool.query(sql); return result.rows; },
      queryCancellable,
      // executeDDL bypasses the SELECT-only gate enforced at the HTTP layer
      // (routes/datasources.js). Reserved for in-process callers — currently
      // the rollup builder, which materialises pre-aggregated tables inside
      // the source DB when the datasource opts into storage_mode = 'source'.
      executeDDL: async (sql) => { await pool.query(sql); },
      testConnection: async () => { const client = await pool.connect(); client.release(); return true; },
      getTables: async () => {
        const result = await pool.query(`
          SELECT table_schema, table_name FROM information_schema.tables
          WHERE table_schema NOT IN ('pg_catalog', 'information_schema') AND table_type = 'BASE TABLE'
          ORDER BY table_schema, table_name
        `);
        return result.rows.map((r) => r.table_schema === 'public' ? r.table_name : `${r.table_schema}.${r.table_name}`);
      },
      getColumns: async (tableName) => {
        const parts = tableName.split('.');
        const schema = parts.length > 1 ? parts[0] : 'public';
        const table = parts.length > 1 ? parts[1] : parts[0];
        const result = await pool.query(`
          SELECT column_name, data_type, is_nullable FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position
        `, [schema, table]);
        return result.rows;
      },
      close: () => pool.end(),
    };
  }

  // ─── MySQL ───
  if (db_type === 'mysql') {
    const mysqlConfig = {
      host, port: port || 3306, database: db_name, user: db_user, password: db_password,
      waitForConnections: true, connectionLimit: 20,
      // Verify the server certificate by default; opt out per-datasource
      // (extra_config.allowSelfSignedCert) for self-signed / internal-CA certs.
      ssl: { rejectUnauthorized: !extra.allowSelfSignedCert }, connectTimeout: 10_000,
    };
    let pool;
    const getPool = () => {
      if (!pool) pool = mysql.createPool(mysqlConfig);
      return pool;
    };
    // Cancellable variant — uses KILL QUERY <threadId> on a sibling
    // connection to abort the in-flight query without taking down the pool.
    const queryCancellable = (sqlText, opts = {}) => {
      const timeoutMs = Number(opts.timeoutMs) || 0;
      let conn = null;
      let canceled = false;
      const promise = (async () => {
        conn = await getPool().getConnection();
        try {
          if (canceled) throw new Error('Query canceled');
          // MySQL 5.7.8+ — kills SELECT statements that exceed the limit.
          // Older servers ignore the SESSION variable silently, so we
          // still rely on the withTimeout safety net for portability.
          if (timeoutMs > 0) {
            try { await conn.query(`SET SESSION MAX_EXECUTION_TIME = ${Math.round(timeoutMs)}`); }
            catch { /* unsupported on old MySQL — fall back to withTimeout */ }
          }
          const [rows] = await conn.query(sqlText);
          return rows;
        } finally {
          try { conn.release(); } catch { /* destroyed */ }
        }
      })();
      const cancel = async () => {
        if (canceled || !conn) return;
        canceled = true;
        const threadId = conn.threadId;
        if (!threadId) return;
        // Same rationale as the PG branch — use a one-shot connection
        // (NOT the shared pool) so a burst of cancels doesn't starve
        // the pool of slots reserved for live visual queries.
        let killConn;
        try {
          killConn = await mysql.createConnection(mysqlConfig);
          await killConn.query(`KILL QUERY ${threadId}`);
        } catch (e) {
          console.warn('[mysql cancel]', e.message);
        } finally {
          try { if (killConn) await killConn.end(); } catch { /* already closed */ }
        }
      };
      return withTimeout({ promise, cancel }, timeoutMs);
    };
    return {
      query: async (sql) => { const [rows] = await getPool().query(sql); return rows; },
      queryCancellable,
      executeDDL: async (sql) => { await getPool().query(sql); },
      testConnection: async () => { const conn = await getPool().getConnection(); conn.release(); return true; },
      getTables: async () => { const [rows] = await getPool().query('SHOW TABLES'); return rows.map((r) => Object.values(r)[0]); },
      getColumns: async (tableName) => {
        const [rows] = await getPool().query(`
          SELECT column_name, data_type, is_nullable FROM information_schema.columns
          WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position
        `, [db_name, tableName]);
        return rows;
      },
      close: () => pool?.end(),
    };
  }

  // ─── Azure SQL Database (MS SQL) ───
  if (db_type === 'azure_sql' || db_type === 'mssql') {
    const sql = require('mssql');
    // mssql defaults requestTimeout to 15s — way too short for analytical
    // workloads. Allow tuning via env so a slow report doesn't get killed
    // mid-flight, and bump the floor to 10 minutes by default.
    const requestTimeoutMs = parseInt(process.env.MSSQL_REQUEST_TIMEOUT_MS || '600000', 10);
    const connectionTimeoutMs = parseInt(process.env.MSSQL_CONNECTION_TIMEOUT_MS || '15000', 10);
    const config = {
      server: host,
      port: port || 1433,
      database: db_name,
      user: db_user,
      password: db_password,
      options: {
        encrypt: true,
        trustServerCertificate: db_type === 'mssql',
      },
      connectionTimeout: connectionTimeoutMs,
      requestTimeout: requestTimeoutMs,
      pool: { max: 5 },
    };
    let poolPromise;
    const getPool = () => { if (!poolPromise) poolPromise = sql.connect(config); return poolPromise; };
    // Cancellable variant — mssql Request has a built-in .cancel() that
    // sends an attention token; the in-flight query unwinds with an
    // ECANCEL error which we translate to a clean "Query canceled".
    const queryCancellable = (sqlText, opts = {}) => {
      const timeoutMs = Number(opts.timeoutMs) || 0;
      let request = null;
      let canceled = false;
      const promise = (async () => {
        const pool = await getPool();
        request = pool.request();
        // Per-request override of the connection-level requestTimeout.
        // Setting 0 means "no driver-level timeout" — fine because
        // withTimeout below still cancels on the configured deadline.
        if (timeoutMs > 0) request.timeout = Math.round(timeoutMs);
        if (canceled) throw new Error('Query canceled');
        const result = await request.query(sqlText);
        return result.recordset;
      })();
      const cancel = () => {
        if (canceled) return;
        canceled = true;
        try { request?.cancel(); } catch (e) {
          console.warn('[mssql cancel]', e.message);
        }
      };
      return withTimeout({ promise, cancel }, timeoutMs);
    };
    return {
      query: async (q) => { const pool = await getPool(); const result = await pool.request().query(q); return result.recordset; },
      queryCancellable,
      executeDDL: async (q) => { const pool = await getPool(); await pool.request().query(q); },
      testConnection: async () => { await getPool(); return true; },
      getTables: async () => {
        const pool = await getPool();
        const result = await pool.request().query(`
          SELECT TABLE_SCHEMA, TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
          WHERE TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_SCHEMA, TABLE_NAME
        `);
        return result.recordset.map((r) => r.TABLE_SCHEMA === 'dbo' ? r.TABLE_NAME : `${r.TABLE_SCHEMA}.${r.TABLE_NAME}`);
      },
      getColumns: async (tableName) => {
        const pool = await getPool();
        const parts = tableName.split('.');
        const schema = parts.length > 1 ? parts[0] : 'dbo';
        const table = parts.length > 1 ? parts[1] : parts[0];
        const result = await pool.request()
          .input('schema', schema).input('table', table)
          .query(`SELECT COLUMN_NAME as column_name, DATA_TYPE as data_type, IS_NULLABLE as is_nullable
            FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @table ORDER BY ORDINAL_POSITION`);
        return result.recordset;
      },
      close: async () => { if (poolPromise) { const p = await poolPromise; await p.close(); poolPromise = null; } },
    };
  }

  // ─── Google BigQuery ───
  if (db_type === 'bigquery') {
    const { BigQuery } = require('@google-cloud/bigquery');
    // extra_config should contain: projectId, keyFilename or credentials JSON
    const bqOptions = { projectId: extra.projectId || db_name };
    if (extra.keyFilename) bqOptions.keyFilename = extra.keyFilename;
    if (extra.credentials) bqOptions.credentials = typeof extra.credentials === 'string' ? JSON.parse(extra.credentials) : extra.credentials;
    const bigquery = new BigQuery(bqOptions);
    const dataset = extra.dataset || db_name;

    // Cancellable variant — uses createQueryJob so we have a Job handle to
    // cancel via the BigQuery jobs.cancel API. Without this an aborted
    // request still bills the user for the full job.
    const queryCancellable = (q, opts = {}) => {
      const timeoutMs = Number(opts.timeoutMs) || 0;
      let job = null;
      let canceled = false;
      const promise = (async () => {
        const jobOpts = { query: q, location: extra.location || 'US' };
        if (timeoutMs > 0) jobOpts.jobTimeoutMs = String(Math.round(timeoutMs));
        const [createdJob] = await bigquery.createQueryJob(jobOpts);
        job = createdJob;
        if (canceled) { try { await job.cancel(); } catch {} throw new Error('Query canceled'); }
        const [rows] = await job.getQueryResults();
        return rows;
      })();
      const cancel = async () => {
        if (canceled) return;
        canceled = true;
        if (!job) return;
        try { await job.cancel(); }
        catch (e) { console.warn('[bigquery cancel]', e.message); }
      };
      return withTimeout({ promise, cancel }, timeoutMs);
    };
    return {
      query: async (q) => { const [rows] = await bigquery.query({ query: q, location: extra.location || 'US' }); return rows; },
      queryCancellable,
      // BigQuery `CREATE TABLE AS SELECT` is supported but slow and billed per
      // bytes-scanned. Source-mode rollups on BQ are intentionally allowed for
      // power users who accept the cost; the duckdb default avoids it.
      executeDDL: async (q) => { await bigquery.query({ query: q, location: extra.location || 'US' }); },
      testConnection: async () => { await bigquery.query({ query: 'SELECT 1' }); return true; },
      getTables: async () => {
        const [tables] = await bigquery.dataset(dataset).getTables();
        return tables.map((t) => t.id);
      },
      getColumns: async (tableName) => {
        const [metadata] = await bigquery.dataset(dataset).table(tableName).getMetadata();
        return (metadata.schema?.fields || []).map((f) => ({
          column_name: f.name,
          data_type: f.type.toLowerCase(),
          is_nullable: f.mode !== 'REQUIRED' ? 'YES' : 'NO',
        }));
      },
      close: () => {},
    };
  }

  // ─── DuckDB ───
  if (db_type === 'duckdb') {
    const duckdb = require('duckdb-async');
    const dbPath = db_name || ':memory:';
    const getDb = async () => {
      if (_duckdbInstances.has(dbPath)) return _duckdbInstances.get(dbPath);
      if (!_duckdbPromises.has(dbPath)) {
        const p = duckdb.Database.create(dbPath).then((db) => {
          _duckdbInstances.set(dbPath, db);
          _duckdbPromises.delete(dbPath);
          return db;
        }).catch((err) => {
          _duckdbPromises.delete(dbPath);
          throw err;
        });
        _duckdbPromises.set(dbPath, p);
      }
      return _duckdbPromises.get(dbPath);
    };
    // Convert BigInt to Number and Date to ISO string in all results
    const convertValues = (rows) => rows.map((r) => {
      const obj = {};
      for (const [k, v] of Object.entries(r)) {
        if (typeof v === 'bigint') obj[k] = Number(v);
        else if (v instanceof Date) obj[k] = v.toISOString().split('T')[0];
        else obj[k] = v;
      }
      return obj;
    });
    // Cancellable variant — duckdb-async exposes interrupt() at the database
    // level which aborts any pending query on shared connections. Best-effort
    // since the interrupt is global (no per-request isolation).
    const queryCancellable = (q, opts = {}) => {
      const timeoutMs = Number(opts.timeoutMs) || 0;
      let canceled = false;
      let db = null;
      const promise = (async () => {
        db = await getDb();
        if (canceled) throw new Error('Query canceled');
        return convertValues(await db.all(q));
      })();
      const cancel = async () => {
        if (canceled) return;
        canceled = true;
        try { if (db && typeof db.interrupt === 'function') db.interrupt(); }
        catch (e) { console.warn('[duckdb cancel]', e.message); }
      };
      // DuckDB has no native statement timeout — the withTimeout wrapper
      // is what actually enforces the deadline by calling interrupt().
      return withTimeout({ promise, cancel }, timeoutMs);
    };
    return {
      query: async (q) => { const db = await getDb(); return convertValues(await db.all(q)); },
      queryCancellable,
      executeDDL: async (q) => { const db = await getDb(); await db.run(q); },
      testConnection: async () => { const db = await getDb(); await db.all('SELECT 1'); return true; },
      getTables: async () => {
        const db = await getDb();
        const rows = await db.all("SELECT table_name FROM information_schema.tables WHERE table_schema = 'main' AND table_type = 'BASE TABLE' ORDER BY table_name");
        return rows.map((r) => r.table_name);
      },
      getColumns: async (tableName) => {
        const db = await getDb();
        const rows = await db.all(`SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = ? ORDER BY ordinal_position`, tableName);
        return convertValues(rows);
      },
      close: () => { /* keep cached instance alive */ },
    };
  }

  throw new Error(`Unsupported database type: ${db_type}`);
}

module.exports = { createConnection, closeAllDuckDB };
