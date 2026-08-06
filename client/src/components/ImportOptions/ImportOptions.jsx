
// Parse options for the file-import flow. Every field defaults to 'auto', which
// means "send nothing" so the server keeps its existing auto-detection — the
// panel is purely additive. Tokens here MUST match the whitelist maps in
// server/routes/fileUpload.js (values are mapped server-side, never interpolated
// raw into SQL).
export const DEFAULT_IMPORT_OPTIONS = {
  delimiter: 'auto', decimalSeparator: 'auto', dateFormat: 'auto', encoding: 'auto', hasHeader: true,
};

// Append the non-default options onto a FormData before uploading.
export function appendImportOptions(formData, o) {
  if (!o) return;
  if (o.delimiter && o.delimiter !== 'auto') formData.append('delimiter', o.delimiter);
  if (o.decimalSeparator && o.decimalSeparator !== 'auto') formData.append('decimalSeparator', o.decimalSeparator);
  if (o.dateFormat && o.dateFormat !== 'auto') formData.append('dateFormat', o.dateFormat);
  if (o.encoding && o.encoding !== 'auto') formData.append('encoding', o.encoding);
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

// CSV/TSV parse options, always visible. Controlled via `value`/`onChange` so
// the owning page can append the options to its upload FormData.
export default function ImportOptions({ value, onChange }) {
  const v = value || DEFAULT_IMPORT_OPTIONS;
  const set = (k, val) => onChange({ ...v, [k]: val });
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
