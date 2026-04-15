const { Pool } = require('pg');
const mysql = require('mysql2/promise');

function createConnection(datasource) {
  const { db_type, host, port, db_name, db_user, db_password } = datasource;

  if (db_type === 'postgres') {
    const pool = new Pool({
      host,
      port: port || 5432,
      database: db_name,
      user: db_user,
      password: db_password,
      max: 5,
      connectionTimeoutMillis: 5000,
      ssl: { rejectUnauthorized: false },
    });
    return {
      query: async (sql) => {
        const result = await pool.query(sql);
        return result.rows;
      },
      testConnection: async () => {
        const client = await pool.connect();
        client.release();
        return true;
      },
      getTables: async () => {
        const result = await pool.query(`
          SELECT table_schema, table_name
          FROM information_schema.tables
          WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
            AND table_type = 'BASE TABLE'
          ORDER BY table_schema, table_name
        `);
        return result.rows.map((r) =>
          r.table_schema === 'public' ? r.table_name : `${r.table_schema}.${r.table_name}`
        );
      },
      getColumns: async (tableName) => {
        const parts = tableName.split('.');
        const schema = parts.length > 1 ? parts[0] : 'public';
        const table = parts.length > 1 ? parts[1] : parts[0];
        const result = await pool.query(`
          SELECT column_name, data_type, is_nullable
          FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = $2
          ORDER BY ordinal_position
        `, [schema, table]);
        return result.rows;
      },
      close: () => pool.end(),
    };
  }

  if (db_type === 'mysql') {
    let pool;
    const getPool = () => {
      if (!pool) {
        pool = mysql.createPool({
          host,
          port: port || 3306,
          database: db_name,
          user: db_user,
          password: db_password,
          waitForConnections: true,
          connectionLimit: 5,
          ssl: { rejectUnauthorized: false },
          connectTimeout: 5000,
        });
      }
      return pool;
    };
    return {
      query: async (sql) => {
        const [rows] = await getPool().query(sql);
        return rows;
      },
      testConnection: async () => {
        const conn = await getPool().getConnection();
        conn.release();
        return true;
      },
      getTables: async () => {
        const [rows] = await getPool().query('SHOW TABLES');
        return rows.map((r) => Object.values(r)[0]);
      },
      getColumns: async (tableName) => {
        const [rows] = await getPool().query(`
          SELECT column_name, data_type, is_nullable
          FROM information_schema.columns
          WHERE table_schema = ? AND table_name = ?
          ORDER BY ordinal_position
        `, [db_name, tableName]);
        return rows;
      },
      close: () => pool?.end(),
    };
  }

  throw new Error(`Unsupported database type: ${db_type}`);
}

module.exports = { createConnection };
