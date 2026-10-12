import { useCallback, useState } from 'react';
import {
  TbFileTypeCsv, TbFileSpreadsheet, TbJson, TbDatabase, TbFileText, TbFileCertificate, TbFileUnknown,
} from 'react-icons/tb';
import { DEFAULT_IMPORT_OPTIONS, importKind } from '../components/ImportOptions/ImportOptions';

// One file of a selection, told apart from a same-named one.
export const fileKey = (f) => `${f.name}-${f.size}-${f.lastModified || 0}`;

const isFec = (name) => /^\d{9}FEC\d{8}/i.test(name) || String(name).toLowerCase().endsWith('.fec');

// The look of a file in a list, from its name: the kind of data it holds
// reads before the name itself.
export function typeOf(name) {
  const ext = String(name || '').toLowerCase().split('.').pop();
  if (isFec(name)) return { Icon: TbFileCertificate, color: '#e2762e', label: 'French FEC' };
  // XML is only taken as an audit file (SAF-T, XAF).
  if (ext === 'xml') return { Icon: TbFileCertificate, color: '#e2762e', label: 'Audit file' };
  if (ext === 'xaf') return { Icon: TbFileCertificate, color: '#e2762e', label: 'XAF' };
  if (['se', 'si', 'sie'].includes(ext)) return { Icon: TbFileCertificate, color: '#e2762e', label: 'SIE' };
  if (ext === 'csv' || ext === 'tsv') return { Icon: TbFileTypeCsv, color: '#16a34a', label: 'CSV' };
  if (ext === 'txt') return { Icon: TbFileText, color: '#64748b', label: 'Text' };
  if (ext === 'xlsx' || ext === 'xls') return { Icon: TbFileSpreadsheet, color: '#15803d', label: 'Excel' };
  if (ext === 'json') return { Icon: TbJson, color: '#d97706', label: 'JSON' };
  if (['parquet', 'db', 'sqlite', 'sqlite3', 'duckdb', 'ddb'].includes(ext)) return { Icon: TbDatabase, color: '#0891b2', label: ext === 'parquet' ? 'Parquet' : 'Database' };
  return { Icon: TbFileUnknown, color: '#64748b', label: 'File' };
}

// Which import options a file has: a CSV's parsing, a workbook's sheets. A
// FEC is read by its own rules, and Parquet, JSON or a database describe
// themselves.
export const optionsKind = (file) => (isFec(file.name) ? 'other' : importKind(file.name));

// A workbook whose sheets are known but none is ticked: nothing to import.
export const missingSheets = (files, optionsFor) => files.some((f) => {
  const o = optionsFor(f);
  return optionsKind(f) === 'excel' && o._sheetNames?.length > 0 && !(o.sheets?.length);
});

// The import options of each file of a selection, by fileKey.
export function useFileOptions() {
  const [byKey, setByKey] = useState({});
  const setFor = useCallback((key, next) => setByKey((all) => ({
    ...all, [key]: typeof next === 'function' ? next(all[key] || DEFAULT_IMPORT_OPTIONS) : next,
  })), []);
  const optionsFor = useCallback((file) => byKey[fileKey(file)] || DEFAULT_IMPORT_OPTIONS, [byKey]);
  return { byKey, setFor, optionsFor };
}
