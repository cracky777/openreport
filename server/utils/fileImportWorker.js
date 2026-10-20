// Child process of an import (see fileImport.js): builds one database file,
// answers with its tables (and accounting summary), and exits — which is what releases the file.
// A job of kind 'mergeFec' merges two imported books databases instead, one of
// kind 'reclassify' places a source's accounts anew (accountMap.js), one of
// kind 'shape' reshapes one table of a file (fileShape.js).
const { buildDatabase, mergeFecDatabases, reclassifyDatabase, shapeDatabase } = require('./fileImport');

process.once('message', async (job) => {
  try {
    const run = { mergeFec: mergeFecDatabases, reclassify: reclassifyDatabase, shape: shapeDatabase }[job.kind] || buildDatabase;
    const { tables, accounting, years, stats } = await run(job);
    process.send({ ok: true, tables, accounting, years, stats }, () => process.exit(0));
  } catch (err) {
    process.send({ ok: false, error: String(err && err.message ? err.message : err) }, () => process.exit(1));
  }
});
