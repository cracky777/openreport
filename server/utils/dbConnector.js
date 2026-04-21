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
    return {
      query: async (sql) => { const result = await pool.query(sql); return result.rows; },
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
    return {
      query: async (sql) => { const [rows] = await getPool().query(sql); return rows; },
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
      connectionTimeout: 5000,
      pool: { max: 5 },
    };
    let poolPromise;
    const getPool = () => { if (!poolPromise) poolPromise = sql.connect(config); return poolPromise; };
    return {
      query: async (q) => { const pool = await getPool(); const result = await pool.request().query(q); return result.recordset; },
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

    return {
      query: async (q) => { const [rows] = await bigquery.query({ query: q, location: extra.location || 'US' }); return rows; },
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
    return {
      query: async (q) => { const db = await getDb(); return convertValues(await db.all(q)); },
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
