// Child process of an import (see fileImport.js): builds one database file,
// answers with its tables, and exits — which is what releases the file.
const { buildDatabase } = require('./fileImport');

process.once('message', async (job) => {
  try {
    const tables = await buildDatabase(job);
    process.send({ ok: true, tables }, () => process.exit(0));
  } catch (err) {
    process.send({ ok: false, error: String(err && err.message ? err.message : err) }, () => process.exit(1));
  }
});
