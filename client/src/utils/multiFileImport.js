import api from './api';
import { appendImportOptions, importKind } from '../components/ImportOptions/ImportOptions';
import { readSheetNames } from './readSheetNames';
import { addFecYearsTo, isBooks, hasFinancePack, booksCompany } from './accountingPack';

const baseName = (name) => name.replace(/\.[^.]+$/, '');

// Several files at once: each becomes a source of its own, uploaded one after
// the other, with its own import options (`optionsFor(file)`; none = auto-
// detection). A workbook with no sheet chosen imports every sheet.
// Resolves with `[{ file, data } | { file, error }]` in the files' order;
// `onStatus(index, 'importing' | 'done' | 'error', error?)` follows along.
export async function uploadEach(files, { workspaceId, optionsFor, onStatus } = {}) {
  const results = [];
  for (const [i, file] of files.entries()) {
    onStatus?.(i, 'importing');
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('name', baseName(file.name));
      if (workspaceId) form.append('workspaceId', workspaceId);
      const options = optionsFor?.(file);
      if (options) appendImportOptions(form, options);
      if (importKind(file.name) === 'excel' && !options?.sheets?.length) {
        const sheets = await readSheetNames(file);
        if (sheets.length) form.append('sheets', JSON.stringify(sheets));
      }
      const res = await api.post('/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      results.push({ file, data: res.data });
      onStatus?.(i, 'done');
    } catch (err) {
      const error = err.response?.data?.error || err.message;
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
export async function modelOnFiles(sources, { workspaceId } = {}) {
  const name = sources.length > 1 ? `${sources[0].name} + ${sources.length - 1} more` : sources[0].name;
  const res = await api.post('/models', { name, datasourceId: sources[0].id, description: '', ...(workspaceId ? { workspaceId } : {}) });
  const modelId = res.data.model.id;
  for (const s of sources.slice(1)) await api.post(`/models/${modelId}/datasources`, { datasourceId: s.id });
  return modelId;
}
