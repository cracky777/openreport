const { Pool } = require('pg');
const mysql = require('mysql2/promise');

function createConnection(datasource) {
  const { db_type, host, port, db_name, db_user, db_password, extra_config } = datasource;
  const extra = extra_config ? (typeof extra_config === 'string' ? JSON.parse(extra_config) : extra_config) : {};

  // ─── PostgreSQL / Azure PostgreSQL ───
  if (db_type === 'postgres' || db_type === 'azure_postgres') {
    const pool = new Pool({
      host,
      port: port || 5432,
      database: db_name,
      user: db_user,
      password: db_password,
      max: 5,
      connectionTimeoutMillis: 5000,
      ssl: db_type === 'azure_postgres' ? { rejectUnauthorized: true } : { rejectUnauthorized: false },
    });
    // Prevent unhandled errors on idle clients (e.g. ECONNRESET) from crashing the Node process
    pool.on('error', (err) => {
      console.error('[pg pool error]', err.message);
    });
    // Cancellable variant — acquires its own client so we know the backend
    // PID and can fire a separate `pg_cancel_backend` against it. Without
    // this the SQL keeps running server-side after a client abort and the
    // DB connection stays busy until the query finishes naturally.
    const queryCancellable = (sqlText) => {
      let client = null;
      let canceled = false;
      const promise = (async () => {
        client = await pool.connect();
        try {
          if (canceled) throw new Error('Query canceled');
          const result = await client.query(sqlText);
          return result.rows;
        } finally {
          // Pass an err arg only when truly aborted so a normal release
          // returns the connection to the pool instead of destroying it.
          try { client.release(canceled ? new Error('canceled') : undefined); }
          catch { /* already released */ }
        }
      })();
      const cancel = async () => {
        if (canceled) return;
        canceled = true;
        // Client may not yet be set if cancel raced with pool.connect() —
        // wait briefly so we have a PID to send pg_cancel_backend against.
        // 500ms ceiling: long enough to cover a slow connection acquire,
        // short enough that a runaway pool doesn't stall the cancel.
        for (let i = 0; i < 20 && !client; i++) {
          await new Promise((r) => setTimeout(r, 25));
        }
        const pid = client?.processID;
        if (!pid) return;
        try {
          const cancelClient = await pool.connect();
          try { await cancelClient.query('SELECT pg_cancel_backend($1)', [pid]); }
          finally { cancelClient.release(); }
        } catch (e) {
          console.warn('[pg cancel]', e.message);
        }
      };
      return { promise, cancel };
    };
    return {
      query: async (sql) => { const result = await pool.query(sql); return result.rows; },
      queryCancellable,
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
    let pool;
    const getPool = () => {
      if (!pool) {
        pool = mysql.createPool({
          host, port: port || 3306, database: db_name, user: db_user, password: db_password,
          waitForConnections: true, connectionLimit: 5, ssl: { rejectUnauthorized: false }, connectTimeout: 5000,
        });
      }
      return pool;
    };
    // Cancellable variant — uses KILL QUERY <threadId> on a sibling
    // connection to abort the in-flight query without taking down the pool.
    const queryCancellable = (sqlText) => {
      let conn = null;
      let canceled = false;
      const promise = (async () => {
        conn = await getPool().getConnection();
        try {
          if (canceled) throw new Error('Query canceled');
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
        try {
          const killConn = await getPool().getConnection();
          try { await killConn.query(`KILL QUERY ${threadId}`); }
          finally { killConn.release(); }
        } catch (e) {
          console.warn('[mysql cancel]', e.message);
        }
      };
      return { promise, cancel };
    };
    return {
      query: async (sql) => { const [rows] = await getPool().query(sql); return rows; },
      queryCancellable,
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
    const queryCancellable = (sqlText) => {
      let request = null;
      let canceled = false;
      const promise = (async () => {
        const pool = await getPool();
        request = pool.request();
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
      return { promise, cancel };
    };
    return {
      query: async (q) => { const pool = await getPool(); const result = await pool.request().query(q); return result.recordset; },
      queryCancellable,
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
    const queryCancellable = (q) => {
      let job = null;
      let canceled = false;
      const promise = (async () => {
        const [createdJob] = await bigquery.createQueryJob({ query: q, location: extra.location || 'US' });
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
      return { promise, cancel };
    };
    return {
      query: async (q) => { const [rows] = await bigquery.query({ query: q, location: extra.location || 'US' }); return rows; },
      queryCancellable,
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
    // Global cache: one instance per file path to avoid lock conflicts
    // Cache the PROMISE (not the resolved value) so concurrent callers share the same open call
    if (!global._duckdbInstances) global._duckdbInstances = {};
    if (!global._duckdbPromises) global._duckdbPromises = {};
    const dbPath = db_name || ':memory:';
    const getDb = async () => {
      if (global._duckdbInstances[dbPath]) return global._duckdbInstances[dbPath];
      if (!global._duckdbPromises[dbPath]) {
        global._duckdbPromises[dbPath] = duckdb.Database.create(dbPath).then((db) => {
          global._duckdbInstances[dbPath] = db;
          return db;
        }).catch((err) => {
          delete global._duckdbPromises[dbPath];
          throw err;
        });
      }
      return global._duckdbPromises[dbPath];
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
    const queryCancellable = (q) => {
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
      return { promise, cancel };
    };
    return {
      query: async (q) => { const db = await getDb(); return convertValues(await db.all(q)); },
      queryCancellable,
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

module.exports = { createConnection };
