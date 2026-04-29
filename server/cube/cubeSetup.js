const { CubejsServerCore } = require('@cubejs-backend/server-core');
const PostgresDriver = require('@cubejs-backend/postgres-driver');
const MySQLDriver = require('@cubejs-backend/mysql-driver');
const metaDb = require('../db');

function getDriverForDatasource(datasource) {
  if (datasource.db_type === 'postgres') {
    return new PostgresDriver({
      host: datasource.host,
      port: datasource.port,
      database: datasource.db_name,
      user: datasource.db_user,
      password: datasource.db_password,
      ssl: { rejectUnauthorized: false },
    });
  }
  if (datasource.db_type === 'mysql') {
    return new MySQLDriver({
      host: datasource.host,
      port: datasource.port,
      database: datasource.db_name,
      user: datasource.db_user,
      password: datasource.db_password,
    });
  }
  throw new Error(`Unsupported database type: ${datasource.db_type}`);
}

function setupCube(app) {
  const core = new CubejsServerCore({
    dbType: ({ dataSource }) => {
      const ds = metaDb.prepare('SELECT * FROM datasources WHERE id = ?').get(dataSource);
      return ds?.db_type || 'postgres';
    },
    driverFactory: ({ dataSource }) => {
      const ds = metaDb.prepare('SELECT * FROM datasources WHERE id = ?').get(dataSource);
      if (!ds) throw new Error(`Datasource ${dataSource} not found`);
      return getDriverForDatasource(ds);
    },
    repositoryFactory: ({ dataSource }) => ({
      dataSchemaFiles: async () => {
        // Generate dynamic schema from datasource tables
        const ds = metaDb.prepare('SELECT * FROM datasources WHERE id = ?').get(dataSource);
        if (!ds) return [];

        try {
          const { createConnection } = require('../utils/dbConnector');
          const conn = createConnection(ds);
          const tables = await conn.getTables();
          const schemas = [];

          for (const table of tables) {
            const columns = await conn.getColumns(table);
            const dimensions = {};
            const measures = {};

            columns.forEach((col) => {
              const colName = col.column_name;
              const isNumeric = ['integer', 'bigint', 'numeric', 'decimal', 'real',
                'double precision', 'float', 'int', 'smallint', 'tinyint',
                'mediumint', 'double', 'interval'].includes(col.data_type.toLowerCase());

              dimensions[colName] = {
                sql: `\`${colName}\``,
                type: isNumeric ? 'number' : 'string',
              };

              if (isNumeric) {
                measures[`${colName}_sum`] = { sql: `\`${colName}\``, type: 'sum' };
                measures[`${colName}_avg`] = { sql: `\`${colName}\``, type: 'avg' };
              }
            });

            measures['count'] = { type: 'count' };

            const cubeSchema = `cube(\`${table}\`, {
  sql: \`SELECT * FROM ${table}\`,
  dimensions: ${JSON.stringify(dimensions, null, 2)},
  measures: ${JSON.stringify(measures, null, 2)},
});`;

            schemas.push({ fileName: `${table}.js`, content: cubeSchema });
          }

          conn.close();
          return schemas;
        } catch (err) {
          console.error('Error generating Cube.js schema:', err.message);
          return [];
        }
      },
    }),
    apiSecret: process.env.CUBEJS_API_SECRET || 'open-report-dev-secret',
    telemetry: false,
  });

  core.initApp(app);
  return core;
}

module.exports = { setupCube };
