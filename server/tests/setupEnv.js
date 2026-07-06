// Runs before each test file (jest setupFiles). Points the metadata DB at a
// fresh throwaway dir and provides the secrets the app modules require at load,
// so tests never touch the real server/data or need a .env.
const os = require('os');
const path = require('path');
const fs = require('fs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openreport-test-'));
process.env.OPENREPORT_DATA_DIR = dir;
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-session-secret-0123456789abcd';
process.env.INTERNAL_TOKEN_SECRET = 'test-internal-secret-0123456789abcd';
process.env.DATASOURCE_ENC_KEY = 'a'.repeat(64); // 32 bytes hex
