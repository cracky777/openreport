// A .pbit is a zip with no data and no credentials. Two files matter:
//   DataModelSchema         — the tabular model (TMSL JSON, UTF-16LE with BOM)
//   Report/Layout           — legacy report format (one JSON, UTF-16LE)
//   Report/definition/**    — PBIR format (one JSON file per page / visual)
// A .pbix stores the model as a compressed VertiPaq blob instead, which this
// reader cannot open — hence the format check on DataModelSchema.
const AdmZip = require('adm-zip');

const MAX_ENTRY_BYTES = 64 * 1024 * 1024;

function decodeJson(buf) {
  let text;
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) text = buf.slice(2).toString('utf16le');
  else if (buf.length >= 2 && buf[1] === 0 && buf[0] !== 0) text = buf.toString('utf16le');
  else text = buf.toString('utf8');
  return JSON.parse(text.replace(/^\uFEFF/, ''));
}

function openPbit(buffer) {
  let zip;
  try {
    zip = new AdmZip(buffer);
  } catch (e) {
    throw new Error('Not a valid .pbit file (zip archive expected)');
  }
  const entries = new Map();
  for (const e of zip.getEntries()) {
    if (e.isDirectory) continue;
    entries.set(e.entryName.replace(/\\/g, '/'), e);
  }
  const read = (name) => {
    const e = entries.get(name);
    if (!e) return null;
    if (e.header.size > MAX_ENTRY_BYTES) throw new Error(`Entry too large: ${name}`);
    return e.getData();
  };
  const readJson = (name) => {
    const buf = read(name);
    return buf ? decodeJson(buf) : null;
  };
  const list = (prefix) => [...entries.keys()].filter((k) => k.startsWith(prefix));
  // The custom visuals packaged in the template (Report/CustomVisuals/<type>/):
  // { <visualType>: displayName }. A visual on a page whose type is one of
  // these is third-party code, not a Power BI visual.
  const customVisuals = () => {
    const out = {};
    for (const key of list('Report/CustomVisuals/')) {
      const m = key.match(/^Report\/CustomVisuals\/([^/]+)\/resources\/.*\.pbiviz\.json$/);
      if (!m) continue;
      let name = m[1];
      try { const j = readJson(key); name = (j && j.visual && j.visual.displayName) || name; } catch { /* unreadable manifest: the type id names it */ }
      out[m[1]] = name;
    }
    return out;
  };

  const schema = readJson('DataModelSchema');
  if (!schema || !schema.model) {
    throw new Error(entries.has('DataModel')
      ? 'This file embeds a compressed data model (.pbix). Save it as a template (.pbit) from Power BI Desktop and retry.'
      : 'DataModelSchema not found — is this a Power BI template (.pbit)?');
  }
  const reportFormat = entries.has('Report/definition/pages/pages.json') ? 'pbir'
    : entries.has('Report/Layout') ? 'legacy' : null;

  return { schema, reportFormat, read, readJson, list, customVisuals };
}

module.exports = { openPbit, decodeJson };
