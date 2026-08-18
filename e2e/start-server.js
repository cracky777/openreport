// Boots the real server for the e2e run, on a data directory wiped at every
// start. The suite asserts on counts and on navigation, so it must not inherit
// a report or a session from the previous run.
//
// Requiring index.js in-process rather than spawning keeps Playwright's
// webServer teardown able to kill it on Windows, where a detached child of a
// shell survives the signal.
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '.tmp', 'data');
fs.rmSync(DATA_DIR, { recursive: true, force: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

// Set before the require: server/index.js loads the repo's .env through dotenv,
// which never overwrites a variable already present.
process.env.OPENREPORT_DATA_DIR = DATA_DIR;
process.env.PORT = process.env.E2E_PORT || '3210';
process.env.NODE_ENV = 'development';
process.env.SESSION_SECRET = 'e2e-session-secret-only-for-this-suite';
process.env.INTERNAL_TOKEN_SECRET = 'e2e-internal-token-secret-distinct-one';
process.env.DATASOURCE_ENC_KEY = 'a'.repeat(64);
delete process.env.OPENREPORT_CLOUD;

require('../server/index.js');
