// What the file pickers offer: every format the import route reads.
export const FILE_IMPORT_ACCEPT = '.csv,.tsv,.txt,.fec,.xml,.xaf,.se,.si,.sie,.xlsx,.xls,.parquet,.json,.db,.sqlite,.sqlite3,.duckdb,.ddb';

// The files an imported source is made of, oldest first. A source imported
// before it could hold several reads as its one file; a live connection has none.
export function sourceFiles(ds) {
  const extra = typeof ds?.extra_config === 'string' ? safeParse(ds.extra_config) : (ds?.extra_config || {});
  if (Array.isArray(extra.files) && extra.files.length) return extra.files;
  return extra.sourceFile ? [{ sourceFile: extra.sourceFile, tables: extra.tables || [] }] : [];
}

// The table names of a file source, as its files list them.
export const tablesOfSource = (ds) => sourceFiles(ds).flatMap((f) => f.tables || []).map((t) => t.tableName);

function safeParse(raw) {
  try { return JSON.parse(raw); } catch { return {}; }
}
