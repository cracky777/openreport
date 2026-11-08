// What the collector has heard from self-hosted instances (routes/telemetry.js).
// Run on the collector host: `cd server && node scripts/telemetryStats.js` (in Docker,
// where the working directory is /app: `docker compose exec app node server/scripts/telemetryStats.js`).
const db = require('../db');

const since = (days) => new Date(Date.now() - days * 864e5).toISOString();
let rows;
try {
  rows = db.prepare('SELECT * FROM telemetry_instances').all();
} catch {
  console.log('No ping received yet (the collector is off, or nobody has pinged).');
  process.exit(0);
}

const active = (days) => rows.filter((r) => r.last_seen >= since(days));
const tally = (list, keyOf) => {
  const counts = {};
  for (const r of list) for (const k of [].concat(keyOf(r))) counts[k] = (counts[k] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ') || '-';
};

const month = active(30);
console.log(`Instances ever seen: ${rows.length}`);
console.log(`Active last 7 days:  ${active(7).length}`);
console.log(`Active last 30 days: ${month.length}`);
console.log(`New last 30 days:    ${rows.filter((r) => r.first_seen >= since(30)).length}`);
console.log('Over the last 30 days:');
console.log(`  versions:  ${tally(month, (r) => r.version)}`);
console.log(`  install:   ${tally(month, (r) => r.install)}`);
console.log(`  databases: ${tally(month, (r) => JSON.parse(r.databases))}`);
console.log(`  AI on:     ${month.filter((r) => r.ai).length} of ${month.length}`);
