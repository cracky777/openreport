/**
 * Anonymous usage ping of a self-hosted instance, on by default.
 *
 * Once a day the instance tells openreport.io that it exists and which version
 * it runs, and learns in return whether a newer release is out (shown in Admin).
 * What is sent is `payload()` and nothing else: a random id made here, the
 * version, how it was installed, the KINDS of databases connected and whether
 * the AI is on. Never a name, an address, a host, a table, a number of users or
 * a line of data. The admin turns it off in Admin › Settings, the operator with
 * OPENREPORT_TELEMETRY=0 (which also hides the switch). The cloud edition and
 * the public demo never ping: they are ours.
 */
const crypto = require('crypto');
const fs = require('fs');
const db = require('../db');
const { getSetting, setSetting, publicAiConfig } = require('./settingsHelper');
const { version: APP_VERSION } = require('../package.json');

const DEFAULT_URL = 'https://app.openreport.io/api/telemetry/ping';
const FIRST_PING_MS = 60 * 1000;
const EVERY_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 10 * 1000;
const OFF_VALUES = new Set(['0', 'false', 'off', 'no']);

// Why the switch is out of the admin's hands, or null when it is theirs.
function forcedOff() {
  if (OFF_VALUES.has(String(process.env.OPENREPORT_TELEMETRY || '').trim().toLowerCase())) return 'env';
  if (process.env.OPENREPORT_CLOUD === '1' || process.env.OPENREPORT_DEMO === '1') return 'hosted';
  return null;
}

function isEnabled() {
  return !forcedOff() && getSetting('telemetry_enabled', true) !== false;
}

function setEnabled(on) {
  setSetting('telemetry_enabled', !!on);
}

function instanceId() {
  const stored = getSetting('telemetry_instance_id', null);
  if (typeof stored === 'string' && stored) return stored;
  const id = crypto.randomUUID();
  setSetting('telemetry_instance_id', id);
  return id;
}

function databaseKinds() {
  try {
    return db.prepare('SELECT DISTINCT db_type FROM datasources WHERE db_type IS NOT NULL ORDER BY db_type')
      .all().map((r) => String(r.db_type));
  } catch { return []; /* fresh install: the table may not be there yet */ }
}

function payload() {
  return {
    instanceId: instanceId(),
    version: APP_VERSION,
    install: fs.existsSync('/.dockerenv') ? 'docker' : 'source',
    databases: databaseKinds(),
    ai: !!publicAiConfig().enabled,
  };
}

// a > b for x.y.z versions; a pre-release tag never counts as newer.
function isNewer(a, b) {
  const parse = (v) => String(v || '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  }
  return false;
}

async function ping({ fetchImpl = fetch } = {}) {
  if (!isEnabled()) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(process.env.OPENREPORT_TELEMETRY_URL || DEFAULT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload()),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const body = await res.json();
    const latest = typeof body?.latest === 'string' && /^\d+\.\d+\.\d+$/.test(body.latest) ? body.latest : null;
    if (latest) setSetting('telemetry_latest', { version: latest, checkedAt: new Date().toISOString() });
    return latest;
  } catch {
    return null; // offline, firewalled, or our server down: the instance never notices
  } finally {
    clearTimeout(timer);
  }
}

function start() {
  if (forcedOff() || process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) return;
  setTimeout(() => { ping(); }, FIRST_PING_MS).unref();
  setInterval(() => { ping(); }, EVERY_MS).unref();
}

function status() {
  const latest = getSetting('telemetry_latest', null);
  const enabled = isEnabled();
  return {
    enabled,
    forcedOff: forcedOff(),
    current: APP_VERSION,
    latest: enabled && latest?.version ? latest.version : null,
    updateAvailable: enabled && !!latest?.version && isNewer(latest.version, APP_VERSION),
    sent: payload(),
  };
}

module.exports = { payload, ping, start, status, isEnabled, setEnabled, forcedOff, isNewer };
