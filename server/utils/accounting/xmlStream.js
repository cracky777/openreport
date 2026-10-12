// A streaming XML reader for data files (SAF-T), with no dependency: an audit
// file can weigh hundreds of megabytes, more than a string or a DOM should
// hold. It knows elements, text, CDATA and the five entities plus numeric
// references; declarations, comments, processing instructions and DOCTYPE are
// skipped. Names lose their namespace prefix ("n1:Line" → "Line"): SAF-T
// files are written with and without one.
const fs = require('fs');
const { isValidUtf8 } = require('../textFile');

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const decodeEntities = (s) => (s.indexOf('&') < 0 ? s : s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
  if (e[0] === '#') {
    const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : m;
  }
  return ENTITIES[e] ?? m;
}));
const localName = (raw) => {
  const name = raw.split(/[\s/>]/, 1)[0];
  const colon = name.indexOf(':');
  return colon < 0 ? name : name.slice(colon + 1);
};

// The encoding the declaration names, among those a decoder reads.
function encodingOf(head) {
  const m = /^[^<]{0,4}<\?xml[^>]*encoding=["']([\w-]+)["']/i.exec(head);
  const name = m ? m[1].toLowerCase() : 'utf-8';
  if (['windows-1252', 'cp1252', 'iso-8859-1', 'latin1', 'iso-8859-15'].includes(name)) return 'windows-1252';
  return 'utf-8';
}

// End of the tag opening at `i` (index of its '>'), quotes respected; -1 if
// the buffer stops before it.
function tagEnd(buf, i) {
  let quote = null;
  for (let j = i + 1; j < buf.length; j++) {
    const c = buf[j];
    if (quote) { if (c === quote) quote = null; } else if (c === '"' || c === "'") quote = c; else if (c === '>') return j;
  }
  return -1;
}

// Read `filePath`, calling `onOpen(name, depth)`, `onText(text)` and
// `onClose(name, depth)`; `depth` counts from 1 at the root. Resolves once the
// whole file is read.
async function streamXml(filePath, { onOpen, onText, onClose }) {
  const fd = fs.openSync(filePath, 'r');
  const head = Buffer.alloc(256);
  const n = fs.readSync(fd, head, 0, 256, 0);
  fs.closeSync(fd);
  // A file that says UTF-8 and is not (some packages write Windows-1252
  // under that declaration) is read as Windows-1252.
  const declared = encodingOf(head.subarray(0, n).toString('latin1'));
  const decoder = new TextDecoder(declared === 'utf-8' && !isValidUtf8(filePath) ? 'windows-1252' : declared);

  let buf = '';
  let depth = 0;
  const consume = (final) => {
    let i = 0;
    for (;;) {
      const lt = buf.indexOf('<', i);
      if (lt < 0) { if (final && i < buf.length) onText(decodeEntities(buf.slice(i))); i = final ? buf.length : i; break; }
      if (lt > i) onText(decodeEntities(buf.slice(i, lt)));
      i = lt;
      if (buf.startsWith('<!--', i)) {
        const end = buf.indexOf('-->', i + 4);
        if (end < 0) break;
        i = end + 3;
      } else if (buf.startsWith('<![CDATA[', i)) {
        const end = buf.indexOf(']]>', i + 9);
        if (end < 0) break;
        onText(buf.slice(i + 9, end));
        i = end + 3;
      } else if (buf[i + 1] === '?' || buf[i + 1] === '!') {
        const end = buf.indexOf('>', i);
        if (end < 0) break;
        i = end + 1;
      } else {
        const end = tagEnd(buf, i);
        if (end < 0) break;
        if (buf[i + 1] === '/') {
          onClose(localName(buf.slice(i + 2, end)), depth);
          depth--;
        } else {
          const name = localName(buf.slice(i + 1, end));
          depth++;
          onOpen(name, depth);
          if (buf[end - 1] === '/') { onClose(name, depth); depth--; }
        }
        i = end + 1;
      }
    }
    // Text before an unfinished tag waits for the rest; a leading BOM goes.
    buf = buf.slice(i).replace(/^\uFEFF/, '');
  };

  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath, { highWaterMark: 1 << 16 });
    stream.on('data', (chunk) => {
      buf += decoder.decode(chunk, { stream: true });
      try { consume(false); } catch (err) { stream.destroy(); reject(err); }
    });
    stream.on('error', reject);
    stream.on('end', () => {
      buf += decoder.decode();
      try { consume(true); resolve(); } catch (err) { reject(err); }
    });
  });
  if (depth !== 0) throw new Error('The XML file ends before its last element closes');
}

// Read the elements `records` names by their path from the root (local
// names joined by '/') as records: the leaf values below each, keyed by their
// path under it ("DebitAmount/Amount" — Amount alone would not tell a line's
// amount from its tax's), the first value of a key kept. `onRecord(kind,
// values, outer)` once a record closes, `outer` holding the values of the
// records still open around it, by kind (a line's transaction and journal).
async function readRecords(filePath, records, onRecord) {
  const stack = [];
  const open = [];
  let text = '';
  let leaf = 0;
  await streamXml(filePath, {
    onOpen(name, depth) {
      stack.length = depth - 1;
      stack.push(name);
      text = '';
      leaf = depth;
      const kind = records[stack.join('/')];
      if (kind) open.push({ kind, depth, values: {} });
    },
    onText(t) { text += t; },
    onClose(name, depth) {
      const top = open[open.length - 1];
      if (top && top.depth === depth) {
        open.pop();
        onRecord(top.kind, top.values, Object.fromEntries(open.map((r) => [r.kind, r.values])));
      } else if (leaf === depth && top) {
        const key = stack.slice(top.depth, depth).join('/');
        if (!(key in top.values)) top.values[key] = text.trim();
      }
      leaf = 0;
      text = '';
    },
  });
}

// The root element of an XML file and the namespace it declares, from its
// first kilobytes; null when the file is not XML.
function readXmlRoot(filePath) {
  const fd = fs.openSync(filePath, 'r');
  const head = Buffer.alloc(8192);
  const n = fs.readSync(fd, head, 0, head.length, 0);
  fs.closeSync(fd);
  const text = head.subarray(0, n).toString('utf8').replace(/^\uFEFF/, '').replace(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->/g, '').trimStart();
  const m = /^<([\w.:-]+)([^>]*)>/.exec(text);
  if (!m) return null;
  // The namespace of the root's own prefix (or the default one), not merely
  // the first declared: xsi often comes first.
  const prefix = m[1].includes(':') ? `:${m[1].split(':')[0]}` : '';
  const ns = new RegExp(`xmlns${prefix}=["']([^"']+)["']`).exec(m[2]);
  return { name: localName(m[1]), namespace: ns ? ns[1] : '' };
}

module.exports = { streamXml, readRecords, readXmlRoot, decodeEntities };
