import api from './api';
import { appendImportOptions, importKind } from '../components/ImportOptions/ImportOptions';
import { readSheetNames } from './readSheetNames';
import { addFecYearsTo, isBooks, hasFinancePack, booksCompany } from './accountingPack';

const baseName = (name) => name.replace(/\.[^.]+$/, '');

// A dropped File is read from the disk again at the moment it is sent, and
// Chrome refuses one whose modification time moved since the drop
// (net::ERR_UPLOAD_FILE_CHANGED, surfaced as a bare "Network Error"): a
// OneDrive file hydrated by our first read, a workbook Excel autosaves. So
// the bytes are read once, up front, and that copy is what goes out; a file
// that cannot be read any more says so instead.
const UNREADABLE = 'could not be read from your computer: if it lives in OneDrive, make it available on this device; if it is open elsewhere or was moved, drop it again.';
async function snapshot(file) {
  try {
    return new File([await file.arrayBuffer()], file.name, { type: file.type, lastModified: file.lastModified });
  } catch {
    throw new Error(`${file.name} ${UNREADABLE}`);
  }
}
// What a failed request means to the user: the server's reason when it gave
// one; without any, the connection dropped or the file could not be sent.
const reasonOf = (err, file) => err.response?.data?.error
  || (err.message === 'Network Error' ? `${file.name} could not be sent: the connection dropped, or the file ${UNREADABLE}` : err.message);

// Several files at once: each becomes a source of its own, uploaded one after
// the other, with its own import options (`optionsFor(file)`; none = auto-
// detection). A workbook with no sheet chosen imports every sheet.
// Resolves with `[{ file, data } | { file, error }]` in the files' order;
// `onStatus(index, 'importing' | 'done' | 'error', error?)` follows along.
// `freeName`: a source name already taken becomes "name (2)" — the chat has
// no field to rename a file, and a file dropped again was refused for good.
export async function uploadEach(files, { workspaceId, optionsFor, onStatus, freeName = false } = {}) {
  const results = [];
  for (const [i, file] of files.entries()) {
    onStatus?.(i, 'importing');
    try {
      const part = await snapshot(file);
      const options = optionsFor?.(file);
      const sheets = importKind(file.name) === 'excel' && !options?.sheets?.length ? await readSheetNames(part) : [];
      const send = (name) => {
        const form = new FormData();
        form.append('file', part);
        form.append('name', name);
        if (workspaceId) form.append('workspaceId', workspaceId);
        if (options) appendImportOptions(form, options);
        if (sheets.length) form.append('sheets', JSON.stringify(sheets));
        return api.post('/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      };
      let res;
      for (let n = 1; ; n++) {
        try {
          res = await send(n === 1 ? baseName(file.name) : `${baseName(file.name)} (${n})`);
          break;
        } catch (err) {
          if (!freeName || n >= 20 || err.response?.status !== 409) throw err;
        }
      }
      results.push({ file, data: res.data });
      onStatus?.(i, 'done');
    } catch (err) {
      const error = reasonOf(err, file);
      results.push({ file, error });
      onStatus?.(i, 'error', error);
    }
  }
  return results;
}

// Books of one company (FEC or SAF-T, same company number) imported together
// become one source of several fiscal years: the first, with the others
// merged into it. Returns one entry per company whose books have a Finance
// package — the first upload's response and the years it now holds — and
// marks the merged results `mergedInto` (their source is gone).
export async function mergeFecUploads(results) {
  const groups = new Map();
  for (const r of results) {
    if (!isBooks(r.data?.accounting) || r.data.reused) continue;
    // Without a company number (a renamed FEC) the company is unknown: never merged.
    const company = booksCompany(r.data.accounting);
    const key = company ? `${r.data.accounting.kind}:${company}` : r.data.datasource.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const books = [];
  for (const [first, ...rest] of groups.values()) {
    let years = [first.data.accounting.fiscalYear].filter(Boolean);
    for (const r of rest) {
      const merged = await addFecYearsTo(first.data.datasource.id, r.data.datasource.id);
      years = merged.years.map((y) => y.year);
      r.mergedInto = first.data.datasource.id;
    }
    books.push({ ...first.data, accounting: { ...first.data.accounting, years } });
  }
  return books.filter((b) => hasFinancePack(b.accounting));
}

// One model on several imported files: the first is its source, the others
// are linked to it. Open it with `?setup=files`: the model editor ticks every
// table, flags their columns and joins them by column name, as it does for
// tables picked by hand. Resolves with the model's id.
// A name already taken (the same files dropped again) becomes "name (2)".
export async function modelOnFiles(sources, { workspaceId } = {}) {
  const name = sources.length > 1 ? `${sources[0].name} + ${sources.length - 1} more` : sources[0].name;
  let res;
  for (let n = 1; ; n++) {
    try {
      res = await api.post('/models', { name: n === 1 ? name : `${name} (${n})`, datasourceId: sources[0].id, description: '', ...(workspaceId ? { workspaceId } : {}) });
      break;
    } catch (err) {
      if (n >= 20 || err.response?.status !== 409) throw err;
    }
  }
  const modelId = res.data.model.id;
  for (const s of sources.slice(1)) await api.post(`/models/${modelId}/datasources`, { datasourceId: s.id });
  return modelId;
}
