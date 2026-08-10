
// Import options for the file-import flow. CSV/TSV parse fields default to
// 'auto' (send nothing → server keeps its auto-detection); Excel gets sheet
// selection instead. Tokens here MUST match the whitelist maps in
// server/routes/fileUpload.js (values are mapped server-side, never interpolated
// raw into SQL).
export const DEFAULT_IMPORT_OPTIONS = {
  delimiter: 'auto', decimalSeparator: 'auto', dateFormat: 'auto', encoding: 'auto', hasHeader: true, sheets: [],
};

// Classify a file by name → drives which options are relevant.
export function importKind(fileName) {
  const ext = (fileName || '').toLowerCase().split('.').pop();
  if (ext === 'csv' || ext === 'tsv') return 'csv';
  if (ext === 'xlsx' || ext === 'xls') return 'excel';
  return 'other';
}

// Append the non-default options onto a FormData before uploading.
export function appendImportOptions(formData, o) {
  if (!o) return;
  if (o.delimiter && o.delimiter !== 'auto') formData.append('delimiter', o.delimiter);
  if (o.decimalSeparator && o.decimalSeparator !== 'auto') formData.append('decimalSeparator', o.decimalSeparator);
  if (o.dateFormat && o.dateFormat !== 'auto') formData.append('dateFormat', o.dateFormat);
  if (o.encoding && o.encoding !== 'auto') formData.append('encoding', o.encoding);
  if (Array.isArray(o.sheets) && o.sheets.length) formData.append('sheets', JSON.stringify(o.sheets));
  // header is on by default server-side; only send when the user turned it off.
  if (o.hasHeader === false) formData.append('hasHeader', 'false');
}

const SEP_OPTS = [['auto', 'Auto-detect'], ['comma', 'Comma ( , )'], ['semicolon', 'Semicolon ( ; )'], ['tab', 'Tab'], ['pipe', 'Pipe ( | )']];
const DEC_OPTS = [['auto', 'Auto-detect'], ['point', 'Point ( . )'], ['comma', 'Comma ( , )']];
const DATE_OPTS = [['auto', 'Auto-detect'], ['dmy_slash', 'DD/MM/YYYY'], ['mdy_slash', 'MM/DD/YYYY'], ['iso', 'YYYY-MM-DD']];
const ENC_OPTS = [['auto', 'Auto-detect'], ['utf8', 'UTF-8'], ['latin1', 'Latin-1 / Windows-1252']];

const wrapStyle = { marginTop: 8, fontSize: 13 };
const titleStyle = { color: 'var(--text-secondary)', fontSize: 13, fontWeight: 500 };
const gridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginTop: 8 };
const labelStyle = { display: 'block', marginBottom: 4, color: 'var(--text-secondary)', fontSize: 12 };
const selectStyle = {
  width: '100%', padding: '6px 8px', borderRadius: 6, fontSize: 13,
  border: '1px solid var(--border-default)', background: 'var(--bg-input)', color: 'var(--text-primary)',
};
const checkRowStyle = { display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-primary)', alignSelf: 'end' };
const hintStyle = { gridColumn: '1 / -1', color: 'var(--text-disabled)', fontSize: 12 };
const sheetListStyle = { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 };
const sheetChipStyle = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 6,
  border: '1px solid var(--border-default)', background: 'var(--bg-input)', color: 'var(--text-primary)', cursor: 'pointer',
};

function Select({ label, value, options, onChange }) {
  return (
    <label>
      <span style={labelStyle}>{label}</span>
      <select style={selectStyle} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([val, text]) => <option key={val} value={val}>{text}</option>)}
      </select>
    </label>
  );
}

// Import options, always visible. `kind` ('csv' | 'excel' | 'other') selects
// which controls show; `sheetNames` lists a workbook's tabs for Excel files.
export default function ImportOptions({ value, onChange, kind = 'csv', sheetNames = [] }) {
  const v = value || DEFAULT_IMPORT_OPTIONS;
  const set = (k, val) => onChange({ ...v, [k]: val });

  if (kind === 'excel') {
    const selected = Array.isArray(v.sheets) ? v.sheets : [];
    const toggle = (name) => set('sheets', selected.includes(name) ? selected.filter((s) => s !== name) : [...selected, name]);
    return (
      <div style={wrapStyle}>
        <div style={titleStyle}>Excel import options</div>
        {sheetNames.length === 0 ? (
          <div style={{ ...hintStyle, marginTop: 8 }}>Reading sheets…</div>
        ) : (
          <>
            <div style={{ ...labelStyle, marginTop: 8 }}>Sheets to import</div>
            <div style={sheetListStyle}>
              {sheetNames.map((name) => (
                <label key={name} style={sheetChipStyle}>
                  <input type="checkbox" checked={selected.includes(name)} onChange={() => toggle(name)} />
                  {name}
                </label>
              ))}
            </div>
          </>
        )}
        <label style={{ ...checkRowStyle, marginTop: 10 }}>
          <input type="checkbox" checked={v.hasHeader} onChange={(e) => set('hasHeader', e.target.checked)} />
          First row is header
        </label>
      </div>
    );
  }

  if (kind !== 'csv') return null; // parquet / json are self-describing

  return (
    <div style={wrapStyle}>
      <div style={titleStyle}>CSV import options</div>
      <div style={gridStyle}>
        <Select label="Column separator" value={v.delimiter} options={SEP_OPTS} onChange={(x) => set('delimiter', x)} />
        <Select label="Decimal separator" value={v.decimalSeparator} options={DEC_OPTS} onChange={(x) => set('decimalSeparator', x)} />
        <Select label="Date format" value={v.dateFormat} options={DATE_OPTS} onChange={(x) => set('dateFormat', x)} />
        <Select label="Text encoding" value={v.encoding} options={ENC_OPTS} onChange={(x) => set('encoding', x)} />
        <label style={checkRowStyle}>
          <input type="checkbox" checked={v.hasHeader} onChange={(e) => set('hasHeader', e.target.checked)} />
          First row is header
        </label>
        <div style={hintStyle}>Applies to CSV / TSV files. Leave on Auto-detect unless the import looks wrong.</div>
      </div>
    </div>
  );
}
