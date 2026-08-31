const path = require('path');
const { Pool, Client } = require('pg');
const mysql = require('mysql2/promise');
const { decrypt } = require('./secretCrypto');
const { quoteLiteral } = require('./sqlDialect');

// Process-wide DuckDB cache. One open file lock per path — concurrent
// callers share the same resolved Database instance, and concurrent
// FIRST-time callers share the in-flight open promise so the file is
// only opened once even under burst load.
// Module-local (not globalThis) so the cache is testable — require()
// caching already gives module-singleton semantics. The graceful-shutdown
// path in `server/index.js` walks them via `closeAllDuckDB()`.
const _duckdbInstances = new Map();
const _duckdbPromises = new Map();

// Where a DuckDB-backed datasource is allowed to live. `db_name` is a filesystem
// path, and nothing stopped it from naming another user's cube — or any path the
// process can write. The import pipeline is the only thing that should ever pick
// this path, and it always picks one here.
const DUCKDB_DIR = path.resolve(__dirname, '..', 'data', 'duckdb');

function assertDuckDBPath(dbName) {
  if (!dbName) return ':memory:';
  const resolved = path.resolve(dbName);
  const inside = resolved === DUCKDB_DIR || resolved.startsWith(DUCKDB_DIR + path.sep);
  if (!inside) throw new Error('DuckDB datasource path is outside the managed directory');
  return resolved;
}

// Hand an already-open DuckDB instance to the query path.
//
// A path this process has opened cannot be opened a second time — not even
// after close(). The import pipeline has to open its file with external access
// enabled (it reads a CSV), so if it then let go, the next query would find the
// path poisoned. It gives us the live instance instead, having first turned
// external access off for good — that setting is one-way, which is what makes
// this safe: the query path inherits a handle it could not re-open, already
// unable to read the server's filesystem.
function adoptDuckDBInstance(dbPath, instance) {
  _duckdbPromises.delete(dbPath);
  _duckdbInstances.set(dbPath, instance);
}

// Close and forget ONE DuckDB file. Used when a datasource stops pointing at a
// path (a re-imported file gets a new one): the old instance would otherwise
// hold the handle until process exit, and on Windows that keeps the obsolete
// file undeletable.
async function closeDuckDBFile(dbPath) {
  const db = _duckdbInstances.get(dbPath);
  _duckdbInstances.delete(dbPath);
  _duckdbPromises.delete(dbPath);
  if (!db) return;
  try { await db.close(); } catch { /* already gone */ }
}

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

function buildConnector(datasource) {
  const { db_type, host, port, db_name, db_user, extra_config } = datasource;
  // Credentials are encrypted at rest — decrypt here, at the single point of use.
  // decrypt() passes plaintext through, so /test (unsaved, plaintext) still works.
  const db_password = decrypt(datasource.db_password);
  const extra = extra_config ? (typeof extra_config === 'string' ? JSON.parse(extra_config) : extra_config) : {};
  if (extra.credentials) extra.credentials = decrypt(extra.credentials);

  // ─── PostgreSQL / Azure PostgreSQL / Amazon Redshift ───
  // Redshift speaks the PostgreSQL wire protocol, so `pg` drives it unchanged.
  // Only three things differ: the default port, the extra system schemas its
  // catalog exposes, and the SQL dialect (handled in utils/sqlBuilder).
  if (db_type === 'postgres' || db_type === 'azure_postgres' || db_type === 'redshift') {
    const pgConfig = {
      host,
      port: port || (db_type === 'redshift' ? 5439 : 5432),
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
      // Resolves as soon as the client is acquired, so cancel() can wait for
      // the backend PID without busy-polling.
      let markClientReady;
      const clientReady = new Promise((res) => { markClientReady = res; });
      const promise = (async () => {
        client = await pool.connect();
        markClientReady();
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
        // Bounded wait for the client to be acquired (else we have no PID to cancel).
        await Promise.race([clientReady, new Promise((r) => setTimeout(r, 500))]);
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
        // Redshift's catalog carries two system schemas PostgreSQL doesn't have;
        // listed here rather than in the shared NOT IN so a real PG database with
        // a user schema called `catalog_history` still shows it. Spectrum
        // external tables live in svv_external_tables, not information_schema,
        // so they are not listed.
        const hidden = db_type === 'redshift'
          ? ['pg_catalog', 'information_schema', 'pg_internal', 'catalog_history']
          : ['pg_catalog', 'information_schema'];
        const placeholders = hidden.map((_, i) => `$${i + 1}`).join(', ');
        const result = await pool.query(`
          SELECT table_schema, table_name FROM information_schema.tables
          WHERE table_schema NOT IN (${placeholders}) AND table_type = 'BASE TABLE'
          ORDER BY table_schema, table_name
        `, hidden);
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
    // An on-prem named instance (SERVER\SQLEXPRESS) listens on a port the SQL
    // Browser hands out at connect time, so there is none to configure — and
    // passing one alongside instanceName makes tedious skip the lookup and dial
    // the wrong port. Azure SQL never has named instances.
    const instanceName = String(extra.instanceName || '').trim();
    const config = {
      server: host,
      ...(instanceName ? {} : { port: port || 1433 }),
      database: db_name,
      user: db_user,
      password: db_password,
      options: {
        // Always encrypt. An on-prem SQL Server ships a self-signed certificate,
        // which is why the trust opt-out exists — but waiving the certificate
        // check is not the same as sending credentials in clear, and only the
        // former is on offer.
        encrypt: true,
        // Same opt-out as pg/mysql, same key. Hardcoded to true, no SQL Server
        // certificate was ever verified: credentials and results travelled to
        // whoever answered, unauthenticated.
        trustServerCertificate: !!extra.allowSelfSignedCert,
        ...(instanceName ? { instanceName } : {}),
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

    // The project that OWNS the data is not always the one that PAYS for the
    // job. Reading `bigquery-public-data.thelook_ecommerce` means running the
    // job in your own project against tables in Google's, and a single project
    // field cannot say that: pointing it at the public project makes BigQuery
    // try to create the job there, where nobody has the right to.
    //
    // So a dataset written `project.dataset` names its own project, and the
    // connection's Project ID keeps its real job: billing and quota. A plain
    // `dataset` still means "in my project", as before.
    const rawDataset = extra.dataset || db_name;
    const dot = String(rawDataset).indexOf('.');
    const dataProject = dot > 0 ? rawDataset.slice(0, dot) : bqOptions.projectId;
    const dataset = dot > 0 ? rawDataset.slice(dot + 1) : rawDataset;
    const datasetRef = () => bigquery.dataset(dataset, { projectId: dataProject });

    // Location is OPTIONAL, and defaulting it to 'US' was wrong: BigQuery
    // refuses a job whose region does not match the dataset's, and it says so
    // with "Not found: Dataset <project>:<name>" — which reads like a missing
    // dataset, not a misplaced query. Any dataset outside the US (a GA4 export
    // in the EU, say) was unreachable, while the connection test passed because
    // `SELECT 1` references no dataset and runs anywhere.
    //
    // Omitted, the API infers the location from the tables the query names.
    // Only pass it when the connection states one.
    //
    // `defaultDataset` is what makes the models portable. Every other backend
    // resolves a bare table name against a current database or schema;
    // BigQuery has no such notion at connection level and refuses the query
    // outright — "Table \"data_2\" must be qualified with a dataset". The
    // models store table names as the introspection returned them (bare, from
    // `dataset(...).getTables()`), so the dataset is stated here instead, once,
    // rather than glued onto every table in every FROM and JOIN. A name that
    // already carries its own `dataset.table` still wins over this default.
    const jobOptions = (opts) => {
      const o = { ...opts };
      if (extra.location) o.location = extra.location;
      if (dataset) o.defaultDataset = { datasetId: dataset, projectId: dataProject };
      return o;
    };

    // Cancellable variant — uses createQueryJob so we have a Job handle to
    // cancel via the BigQuery jobs.cancel API. Without this an aborted
    // request still bills the user for the full job.
    const queryCancellable = (q, opts = {}) => {
      const timeoutMs = Number(opts.timeoutMs) || 0;
      let job = null;
      let canceled = false;
      const promise = (async () => {
        const jobOpts = jobOptions({ query: q });
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
      query: async (q) => { const [rows] = await bigquery.query(jobOptions({ query: q })); return rows; },
      queryCancellable,
      // BigQuery `CREATE TABLE AS SELECT` is supported but slow and billed per
      // bytes-scanned. Source-mode rollups on BQ are intentionally allowed for
      // power users who accept the cost; the duckdb default avoids it.
      executeDDL: async (q) => { await bigquery.query(jobOptions({ query: q })); },
      testConnection: async () => { await bigquery.query({ query: 'SELECT 1' }); return true; },
      getTables: async () => {
        const [tables] = await datasetRef().getTables();
        return tables.map((t) => t.id);
      },
      getColumns: async (tableName) => {
        const [metadata] = await datasetRef().table(tableName).getMetadata();
        return (metadata.schema?.fields || []).map((f) => ({
          column_name: f.name,
          data_type: f.type.toLowerCase(),
          is_nullable: f.mode !== 'REQUIRED' ? 'YES' : 'NO',
        }));
      },
      close: () => {},
    };
  }

  // ─── Databricks ───
  if (db_type === 'databricks') {
    const { DBSQLClient } = require('@databricks/sql');
    // Le chemin HTTP désigne l'entrepôt SQL (ou le cluster) : deux entrepôts du
    // même workspace ne diffèrent que par lui. Sans, la connexion s'ouvre sur
    // rien. Le jeton d'accès personnel tient lieu de mot de passe.
    const httpPath = String(extra.httpPath || '').trim();
    const connectOptions = { host, path: httpPath, token: db_password || '' };

    // Une session par requête serait payée d'un aller-retour à chaque visuel ;
    // une session partagée, ouverte à la demande et reconstruite si elle tombe.
    let sessionPromise = null;
    const getSession = () => {
      if (!sessionPromise) {
        sessionPromise = (async () => {
          const client = new DBSQLClient();
          await client.connect(connectOptions);
          const session = await client.openSession({
            // Unity Catalog nomme en trois niveaux (catalogue.schéma.table).
            // Poser les deux premiers ici, c'est permettre au modèle de ne
            // nommer que la table, comme sur les autres moteurs.
            ...(extra.catalog ? { initialCatalog: extra.catalog } : {}),
            ...(extra.schema ? { initialSchema: extra.schema } : {}),
          });
          return { client, session };
        })().catch((err) => { sessionPromise = null; throw err; });
      }
      return sessionPromise;
    };

    // `runAsync` rend la main avant la fin : c'est ce qui laisse une prise pour
    // annuler. Sans lui, l'opération ne serait connue qu'une fois terminée.
    const runStatement = async (sqlText, onOperation) => {
      const { session } = await getSession();
      const op = await session.executeStatement(sqlText, { runAsync: true });
      if (onOperation) onOperation(op);
      try {
        return await op.fetchAll();
      } finally {
        try { await op.close(); } catch { /* déjà fermée par un cancel */ }
      }
    };

    const queryCancellable = (sqlText, opts = {}) => {
      const timeoutMs = Number(opts.timeoutMs) || 0;
      let op = null;
      let canceled = false;
      const promise = runStatement(sqlText, (o) => {
        op = o;
        if (canceled) { try { o.cancel(); } catch { /* déjà partie */ } }
      });
      const cancel = async () => {
        if (canceled) return;
        canceled = true;
        // Databricks n'expose pas de délai d'exécution par requête : le seul
        // levier est cette annulation, et le garde-fou JS qui la déclenche.
        try { if (op) await op.cancel(); } catch (e) { console.warn('[databricks cancel]', e.message); }
      };
      return withTimeout({ promise, cancel }, timeoutMs);
    };

    const defaultSchema = extra.schema || 'default';
    return {
      query: (sqlText) => runStatement(sqlText),
      queryCancellable,
      executeDDL: async (sqlText) => { await runStatement(sqlText); },
      testConnection: async () => { await runStatement('SELECT 1'); return true; },
      getTables: async () => {
        const rows = await runStatement(`
          SELECT table_schema, table_name FROM information_schema.tables
          WHERE table_schema <> 'information_schema'
          ORDER BY table_schema, table_name
        `);
        return rows.map((r) => (r.table_schema === defaultSchema ? r.table_name : `${r.table_schema}.${r.table_name}`));
      },
      getColumns: async (tableName) => {
        const parts = String(tableName).split('.');
        const schema = parts.length > 1 ? parts[0] : defaultSchema;
        const table = parts.length > 1 ? parts[1] : parts[0];
        // Le driver Thrift n'expose pas de liaison de paramètres sur laquelle on
        // puisse compter d'une version à l'autre ; l'échappement du dialecte est
        // la garantie qui reste, et c'est celle que le reste du code utilise.
        const rows = await runStatement(
          'SELECT column_name, full_data_type AS data_type, is_nullable'
          + ' FROM information_schema.columns'
          + ` WHERE table_schema = ${quoteLiteral(schema, 'databricks')}`
          + ` AND table_name = ${quoteLiteral(table, 'databricks')}`
          + ' ORDER BY ordinal_position',
        );
        return rows;
      },
      close: async () => {
        if (!sessionPromise) return;
        const held = sessionPromise;
        sessionPromise = null;
        try { const { client, session } = await held; await session.close(); await client.close(); }
        catch { /* déjà tombée */ }
      },
    };
  }

  // ─── ClickHouse ───
  if (db_type === 'clickhouse') {
    const { createClient } = require('@clickhouse/client');
    // ClickHouse écoute l'interface HTTP sur 8123 en clair et 8443 en TLS. Deux
    // ports pour un même serveur : le défaut suit donc la case, sinon activer
    // le TLS ferait taper au mauvais endroit sans autre symptôme qu'un timeout.
    const secure = !!extra.secure;
    const proto = secure ? 'https' : 'http';
    const resolvedPort = port || (secure ? 8443 : 8123);
    const client = createClient({
      url: `${proto}://${host}:${resolvedPort}`,
      username: db_user || 'default',
      password: db_password || '',
      database: db_name || 'default',
      application: 'OpenReport',
    });

    const rowsOf = async (sqlText, opts = {}) => {
      const rs = await client.query({ query: sqlText, format: 'JSONEachRow', ...opts });
      return rs.json();
    };

    const queryCancellable = (sqlText, opts = {}) => {
      const timeoutMs = Number(opts.timeoutMs) || 0;
      const controller = new AbortController();
      const promise = rowsOf(sqlText, {
        abort_signal: controller.signal,
        // Coupure côté serveur en plus de l'abandon côté client : sans elle,
        // abandonner la réponse HTTP laisse la requête finir sur le cluster.
        ...(timeoutMs > 0
          ? { clickhouse_settings: { max_execution_time: Math.max(1, Math.round(timeoutMs / 1000)) } }
          : {}),
      });
      return withTimeout({ promise, cancel: () => controller.abort() }, timeoutMs);
    };

    // La « base » de ClickHouse est ce que les autres moteurs appellent schéma :
    // une table de la base courante se nomme nue, les autres se qualifient.
    const defaultDb = db_name || 'default';
    return {
      query: (sqlText) => rowsOf(sqlText),
      queryCancellable,
      executeDDL: async (sqlText) => { await client.command({ query: sqlText }); },
      testConnection: async () => { await client.ping(); return true; },
      getTables: async () => {
        const rows = await rowsOf(`
          SELECT database, name FROM system.tables
          WHERE database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')
            AND NOT is_temporary
          ORDER BY database, name
        `);
        return rows.map((r) => (r.database === defaultDb ? r.name : `${r.database}.${r.name}`));
      },
      getColumns: async (tableName) => {
        const parts = String(tableName).split('.');
        const database = parts.length > 1 ? parts[0] : defaultDb;
        const table = parts.length > 1 ? parts[1] : parts[0];
        const rows = await rowsOf(
          'SELECT name AS column_name, type AS data_type FROM system.columns'
          + ' WHERE database = {db:String} AND table = {tbl:String} ORDER BY position',
          { query_params: { db: database, tbl: table } },
        );
        // ClickHouse n'a pas de colonne « nullable » : la nullabilité fait
        // partie du type, écrit Nullable(...).
        return rows.map((r) => ({ ...r, is_nullable: /^Nullable\(/.test(r.data_type) ? 'YES' : 'NO' }));
      },
      close: () => client.close(),
    };
  }

  // ─── Snowflake ───
  if (db_type === 'snowflake') {
    const snowflake = require('snowflake-sdk');
    // Le SDK journalise abondamment sur stdout via winston dès le premier
    // appel. Sans ça, une seule requête noie la sortie du serveur.
    try { snowflake.configure({ logLevel: 'OFF' }); } catch { /* SDK trop ancien */ }

    // Snowflake ne se joint pas par hôte/port : l'identifiant de compte porte
    // la région et le cloud. L'entrepôt (warehouse) est le calcul, distinct de
    // la base — sans lui, toute requête est refusée faute de ressource assignée.
    const connOptions = {
      account: extra.account || host,
      username: db_user,
      password: db_password,
      database: db_name,
      application: 'OpenReport',
    };
    if (extra.warehouse) connOptions.warehouse = extra.warehouse;
    if (extra.schema) connOptions.schema = extra.schema;
    if (extra.role) connOptions.role = extra.role;

    // 10 plutôt que les 20 du pool PG : chez Snowflake la concurrence est
    // absorbée par l'entrepôt, pas par le nombre de sessions ouvertes.
    let pool;
    const getPool = () => {
      if (!pool) pool = snowflake.createPool(connOptions, { max: 10, min: 0 });
      return pool;
    };

    // `execute` rend le statement, seul objet porteur du cancel. On le remonte
    // à l'appelant pour que queryCancellable puisse l'annuler côté serveur.
    const exec = (conn, sqlText, { binds, onStatement } = {}) => new Promise((resolve, reject) => {
      const stmt = conn.execute({
        sqlText,
        ...(binds ? { binds } : {}),
        complete: (err, _s, rows) => (err ? reject(err) : resolve(rows || [])),
      });
      if (onStatement) onStatement(stmt);
    });

    const queryCancellable = (sqlText, opts = {}) => {
      const timeoutMs = Number(opts.timeoutMs) || 0;
      let stmt = null;
      let canceled = false;
      const promise = getPool().use(async (conn) => {
        if (canceled) throw new Error('Query canceled');
        // Best-effort, comme le SET statement_timeout de PG : un rôle restreint
        // peut refuser l'ALTER SESSION, et le garde-fou JS reste la vraie limite.
        if (timeoutMs > 0) {
          try { await exec(conn, `ALTER SESSION SET STATEMENT_TIMEOUT_IN_SECONDS = ${Math.max(1, Math.round(timeoutMs / 1000))}`); }
          catch (e) { console.warn('[snowflake statement_timeout]', e.message); }
        }
        return exec(conn, sqlText, { onStatement: (st) => { stmt = st; } });
      });
      const cancel = () => {
        if (canceled) return;
        canceled = true;
        try { if (stmt && typeof stmt.cancel === 'function') stmt.cancel(() => {}); }
        catch (e) { console.warn('[snowflake cancel]', e.message); }
      };
      return withTimeout({ promise, cancel }, timeoutMs);
    };

    // Snowflake plie les noms non cités en MAJUSCULES : sans alias cités en
    // minuscules, les lignes reviendraient en TABLE_NAME / DATA_TYPE et le
    // reste de l'application, qui lit `table_name`, ne verrait rien.
    const run = (sqlText, binds) => getPool().use((conn) => exec(conn, sqlText, { binds }));
    return {
      query: run,
      queryCancellable,
      executeDDL: async (sqlText) => { await run(sqlText); },
      testConnection: async () => { await run('SELECT 1'); return true; },
      getTables: async () => {
        const rows = await run(`
          SELECT table_schema AS "table_schema", table_name AS "table_name"
          FROM information_schema.tables
          WHERE table_type = 'BASE TABLE' AND table_schema <> 'INFORMATION_SCHEMA'
          ORDER BY table_schema, table_name
        `);
        return rows.map((r) => (r.table_schema === 'PUBLIC' ? r.table_name : `${r.table_schema}.${r.table_name}`));
      },
      getColumns: async (tableName) => {
        const parts = String(tableName).split('.');
        const schema = parts.length > 1 ? parts[0] : 'PUBLIC';
        const table = parts.length > 1 ? parts[1] : parts[0];
        return run(`
          SELECT column_name AS "column_name", data_type AS "data_type", is_nullable AS "is_nullable"
          FROM information_schema.columns
          WHERE table_schema = ? AND table_name = ?
          ORDER BY ordinal_position
        `, [schema, table]);
      },
      close: async () => { if (pool) { await pool.drain(); await pool.clear(); pool = null; } },
    };
  }

  // ─── DuckDB ───
  if (db_type === 'duckdb') {
    const duckdb = require('duckdb-async');
    const dbPath = assertDuckDBPath(db_name);
    const getDb = async () => {
      if (_duckdbInstances.has(dbPath)) return _duckdbInstances.get(dbPath);
      if (!_duckdbPromises.has(dbPath)) {
        // Open with external filesystem access disabled: the user query path
        // (POST /datasources/:id/query) only reads tables already materialised
        // in this .duckdb file, never the server FS. This blocks arbitrary file
        // reads via read_text/read_csv/read_parquet/glob in a SELECT. The import
        // pipeline uses its own separate instance (fileUpload.js) and is untouched.
        const p = duckdb.Database.create(dbPath, { enable_external_access: 'false' }).then((db) => {
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

// Connector cache — pg/mysql/mssql pools are expensive to spin up, and a single
// dashboard refresh calls createConnection once per widget. Cache the whole
// connector by datasource.id so those share ONE pool instead of opening N.
// Ephemeral connections (no id — the /test endpoint builds from req.body) are
// never cached and keep their real close(). A cached connector's close() is a
// no-op: the pool lives until invalidateDatasource() or process exit. DuckDB is
// already instance-cached internally, so caching its connector is harmless.
const _connectorCache = new Map();

function createConnection(datasource) {
  const id = datasource && datasource.id;
  if (id && _connectorCache.has(id)) return _connectorCache.get(id);
  const conn = buildConnector(datasource);
  if (id) {
    conn._teardown = conn.close;
    conn.close = () => {}; // shared pool — real teardown only via invalidateDatasource
    _connectorCache.set(id, conn);
  }
  return conn;
}

// Evict + tear down a datasource's cached connector. Call whenever its
// connection params change or it's deleted. No-op for an uncached id.
function invalidateDatasource(id) {
  const conn = _connectorCache.get(id);
  if (!conn) return;
  _connectorCache.delete(id);
  try {
    const r = conn._teardown && conn._teardown();
    if (r && typeof r.then === 'function') r.catch(() => {});
  } catch { /* already closed */ }
}

module.exports = { createConnection, invalidateDatasource, closeAllDuckDB, closeDuckDBFile, adoptDuckDBInstance };
