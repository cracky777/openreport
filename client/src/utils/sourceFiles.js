// What the file pickers offer: every format the import route reads.
export const FILE_IMPORT_ACCEPT = '.csv,.xlsx,.xls,.parquet,.json,.tsv,.db,.sqlite,.sqlite3,.duckdb,.ddb';

// The files an imported source is made of, oldest first. A source imported
// before it could hold several reads as its one file; a live connection has none.
export function sourceFiles(ds) {
  const extra = typeof ds?.extra_config === 'string' ? safeParse(ds.extra_config) : (ds?.extra_config || {});
  if (Array.isArray(extra.files) && extra.files.length) return extra.files;
  return extra.sourceFile ? [{ sourceFile: extra.sourceFile, tables: extra.tables || [] }] : [];
}

function safeParse(raw) {
  try { return JSON.parse(raw); } catch { return {}; }
}
