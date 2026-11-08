/**
 * Receives the daily ping of self-hosted instances (utils/telemetry.js) and
 * answers with the latest release. Mounted only where OPENREPORT_TELEMETRY_COLLECTOR=1
 * (our hosted server); every other instance has no such route.
 *
 * One row per instance, overwritten at each ping: what it runs now, first and
 * last seen. The caller's IP is never stored — not even the country — and
 * anything outside the expected shape is refused rather than trimmed.
 */
const express = require('express');
const db = require('../db');
const { version: APP_VERSION } = require('../package.json');

const RELEASES_URL = 'https://api.github.com/repos/cracky777/openreport/releases/latest';
const RELEASE_TTL_MS = 6 * 60 * 60 * 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,6}(-[0-9A-Za-z.]{1,20})?$/;
const DB_KIND = /^[a-z0-9_-]{1,24}$/;
const INSTALLS = new Set(['docker', 'source']);

db.exec(`CREATE TABLE IF NOT EXISTS telemetry_instances (
  instance_id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  install TEXT NOT NULL,
  databases TEXT NOT NULL,
  ai INTEGER NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL
)`);

function validPing(b) {
  if (!b || typeof b !== 'object') return null;
  const keys = Object.keys(b);
  if (keys.length !== 5) return null;
  if (!UUID.test(String(b.instanceId))) return null;
  if (!VERSION.test(String(b.version))) return null;
  if (!INSTALLS.has(b.install)) return null;
  if (!Array.isArray(b.databases) || b.databases.length > 20 || !b.databases.every((d) => typeof d === 'string' && DB_KIND.test(d))) return null;
  if (typeof b.ai !== 'boolean') return null;
  return { instanceId: b.instanceId, version: b.version, install: b.install, databases: [...new Set(b.databases)].sort(), ai: b.ai };
}

let release = { version: null, at: 0 };
async function latestRelease({ fetchImpl = fetch } = {}) {
  if (release.version && Date.now() - release.at < RELEASE_TTL_MS) return release.version;
  try {
    const res = await fetchImpl(RELEASES_URL, { headers: { Accept: 'application/vnd.github+json' } });
    const tag = res.ok ? String((await res.json()).tag_name || '').replace(/^v/, '') : '';
    if (/^\d+\.\d+\.\d+$/.test(tag)) release = { version: tag, at: Date.now() };
  } catch { /* GitHub unreachable: answer with what we know */ }
  return release.version || APP_VERSION;
}

function createRouter({ fetchImpl } = {}) {
  const router = express.Router();
  router.post('/ping', async (req, res) => {
    const p = validPing(req.body);
    if (!p) return res.status(400).json({ error: 'Invalid ping' });
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO telemetry_instances (instance_id, version, install, databases, ai, first_seen, last_seen)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(instance_id) DO UPDATE SET version = excluded.version, install = excluded.install,
        databases = excluded.databases, ai = excluded.ai, last_seen = excluded.last_seen
    `).run(p.instanceId, p.version, p.install, JSON.stringify(p.databases), p.ai ? 1 : 0, now, now);
    res.json({ latest: await latestRelease({ fetchImpl }) });
  });
  return router;
}

module.exports = { createRouter, validPing };
