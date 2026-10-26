// Dev runner: restarts the server when its source changes. Not `node --watch`:
// on Windows it restarts on any event of a watched folder, and NTFS updates a
// file's last-access time when it is read (once an hour) — the first import of
// the hour forks utils/fileImportWorker.js, the read alone restarted the server
// mid-request and the upload ended in a 502. Here a change counts only when the
// file's content time moved past the server's start.
const { fork } = require('child_process');
const fs = require('fs');
const path = require('path');

const WATCHED = ['index.js', 'routes', 'utils', 'db', 'middleware', 'cloud'];
let child = null;
let startedAt = 0;
let timer = null;

function start() {
  startedAt = Date.now();
  child = fork(path.join(__dirname, 'index.js'), process.argv.slice(2), { cwd: __dirname });
}

function restart() {
  console.log('[dev] source changed, restarting the server');
  if (!child || child.exitCode !== null || child.signalCode !== null) return start();
  child.once('exit', start);
  child.kill('SIGTERM');
}

function changed(file) {
  try {
    return fs.statSync(file).mtimeMs > startedAt;
  } catch {
    return true; // deleted or renamed
  }
}

for (const entry of WATCHED) {
  const target = path.join(__dirname, entry);
  if (!fs.existsSync(target)) continue;
  const isDir = fs.statSync(target).isDirectory();
  fs.watch(target, { recursive: isDir }, (_event, name) => {
    const file = isDir ? path.join(target, String(name || '')) : target;
    if (!changed(file)) return;
    clearTimeout(timer);
    timer = setTimeout(restart, 300);
  });
}

start();
process.on('SIGINT', () => { child?.kill('SIGINT'); process.exit(0); });
