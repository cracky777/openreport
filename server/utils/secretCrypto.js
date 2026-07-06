/**
 * At-rest encryption for datasource credentials (db_password + the BigQuery
 * service-account key in extra_config.credentials). AES-256-GCM with a random
 * per-value IV; the key comes from DATASOURCE_ENC_KEY (32 bytes, hex or base64).
 *
 * Values are stored as `enc:v1:<base64(iv|tag|ciphertext)>`. Both encrypt() and
 * decrypt() are idempotent/back-compatible: an already-encrypted value passes
 * through encrypt() untouched, and a plaintext (not-yet-migrated) value passes
 * through decrypt() untouched — so connections keep working during migration.
 */

const crypto = require('crypto');

const PREFIX = 'enc:v1:';
const ALG = 'aes-256-gcm';

let cachedKey; // undefined = unresolved, null = not configured, Buffer = ready

function resolveKey() {
  if (cachedKey !== undefined) return cachedKey;
  const raw = process.env.DATASOURCE_ENC_KEY;
  if (!raw) { cachedKey = null; return null; }
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    console.error('[startup] FATAL: DATASOURCE_ENC_KEY must be 32 bytes (64 hex chars, or base64). Generate: openssl rand -hex 32');
    process.exit(1);
  }
  cachedKey = key;
  return key;
}

function isEncrypted(v) {
  return typeof v === 'string' && v.startsWith(PREFIX);
}

function encrypt(plain) {
  if (plain === null || plain === undefined || plain === '') return plain;
  if (isEncrypted(plain)) return plain;
  const key = resolveKey();
  if (!key) throw new Error('DATASOURCE_ENC_KEY not configured — cannot store datasource credentials');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALG, key, iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString('base64');
}

function decrypt(value) {
  if (!isEncrypted(value)) return value;
  const key = resolveKey();
  if (!key) throw new Error('DATASOURCE_ENC_KEY not configured — cannot read datasource credentials');
  const blob = Buffer.from(value.slice(PREFIX.length), 'base64');
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const ct = blob.subarray(28);
  const decipher = crypto.createDecipheriv(ALG, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

function rowHasSecret(r) {
  if (r.db_password && r.db_password !== '') return true;
  if (r.extra_config) {
    try { const c = JSON.parse(r.extra_config); if (c && c.credentials) return true; } catch { /* malformed */ }
  }
  return false;
}

// One-shot boot migration. If any datasource carries a secret (plaintext OR
// already-encrypted) the key becomes mandatory — refuse to start without it,
// since new writes would fail and encrypted rows couldn't be read. Then encrypt
// any secrets still stored in plaintext. Installs with no secrets (e.g. only
// DuckDB file datasources) boot fine without a key.
function migrateDatasourceSecrets(db) {
  let rows;
  try { rows = db.prepare('SELECT id, db_password, extra_config FROM datasources').all(); }
  catch { return; } // table not present yet
  if (!rows.some(rowHasSecret)) return;
  const key = resolveKey();
  if (!key) {
    console.error('[startup] FATAL: DATASOURCE_ENC_KEY is required — datasource credentials are present. Generate: openssl rand -hex 32');
    process.exit(1);
  }
  const upd = db.prepare('UPDATE datasources SET db_password = ?, extra_config = ? WHERE id = ?');
  const tx = db.transaction(() => {
    let n = 0;
    for (const r of rows) {
      let changed = false;
      let pw = r.db_password;
      if (pw && !isEncrypted(pw)) { pw = encrypt(pw); changed = true; }
      let cfgStr = r.extra_config;
      if (cfgStr) {
        try {
          const c = JSON.parse(cfgStr);
          if (c && c.credentials && !isEncrypted(c.credentials)) {
            c.credentials = encrypt(c.credentials);
            cfgStr = JSON.stringify(c);
            changed = true;
          }
        } catch { /* leave malformed config untouched */ }
      }
      if (changed) { upd.run(pw, cfgStr, r.id); n++; }
    }
    if (n) console.log(`[startup] encrypted datasource secrets for ${n} row(s).`);
  });
  tx();
}

module.exports = { encrypt, decrypt, isEncrypted, migrateDatasourceSecrets };
