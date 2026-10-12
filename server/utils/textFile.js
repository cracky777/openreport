// Text files of unknown encoding. Exports from French accounting packages and
// from Excel are Windows-1252 more often than UTF-8, and DuckDB's "latin-1"
// reader refuses the bytes 0x80–0x9F that Windows-1252 uses for €, ’ or œ.
const fs = require('fs');

const CHUNK = 1024 * 1024;

// Whether a file's bytes are valid UTF-8, read in chunks — an import can
// weigh hundreds of megabytes.
function isValidUtf8(filePath) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const fd = fs.openSync(filePath, 'r');
  const chunk = Buffer.alloc(CHUNK);
  try {
    for (;;) {
      const n = fs.readSync(fd, chunk, 0, chunk.length, null);
      if (n === 0) break;
      decoder.decode(chunk.subarray(0, n), { stream: true });
    }
    decoder.decode();
    return true;
  } catch {
    return false; // an invalid sequence: not UTF-8
  } finally {
    fs.closeSync(fd);
  }
}

// Where the UTF-8 copy of an upload goes. A fixed name: DuckDB on Windows
// holds a file it has read until its process ends, so the copy is removed by
// whoever removes the upload, once the import process is gone.
const utf8CopyPath = (filePath) => `${filePath}.utf8`;

// Rewrite a Windows-1252 file as UTF-8 at `outPath`. Windows-1252 rather than
// Latin-1: the two agree on every printable byte except 0x80–0x9F, which
// Latin-1 leaves to control characters no text file means.
function writeUtf8Copy(filePath, outPath) {
  const decoder = new TextDecoder('windows-1252');
  const fdIn = fs.openSync(filePath, 'r');
  const fdOut = fs.openSync(outPath, 'w');
  const chunk = Buffer.alloc(CHUNK);
  try {
    for (;;) {
      const n = fs.readSync(fdIn, chunk, 0, chunk.length, null);
      if (n === 0) break;
      fs.writeSync(fdOut, decoder.decode(chunk.subarray(0, n), { stream: true }));
    }
  } finally {
    fs.closeSync(fdIn);
    fs.closeSync(fdOut);
  }
}

// The first line of a text file, decoded, without its BOM or line ending.
function readFirstLine(filePath, maxBytes = 64 * 1024) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(maxBytes);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const head = buf.subarray(0, n);
    const end = head.indexOf(0x0a);
    const line = end >= 0 ? head.subarray(0, end) : head;
    // The UTF-8 decoder drops a leading BOM itself.
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(line); } catch { text = new TextDecoder('windows-1252').decode(line); }
    return text.replace(/\r$/, '');
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = { isValidUtf8, writeUtf8Copy, readFirstLine, utf8CopyPath };
