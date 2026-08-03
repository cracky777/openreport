// Column-type override popover for the schema canvas — a fixed-position HTML
// overlay (not SVG) that floats at the click point with a type <select>,
// optional date-format select, a "Test format" validation action and its
// result. Extracted verbatim from SchemaCanvas.jsx (LOT 6.3). Self-contained:
// renders nothing until `typePopover` is set; all its styles are popover-only.
const _hs29 = { position: 'fixed', inset: 0, zIndex: 50 };
const _hs30 = { fontWeight: 600, marginBottom: 4, color: 'var(--text-primary)' };
const _hs31 = { fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 };
const _hs32 = {
  width: '100%', padding: '4px 6px',
  border: '1px solid var(--border-default)', borderRadius: 4,
  fontSize: 12, marginBottom: 8,
};
const _hs33 = {
  width: '100%', padding: '4px 6px',
  border: '1px solid var(--border-default)', borderRadius: 4,
  fontSize: 11, marginBottom: 8,
};
const _hs34 = { marginTop: 8, fontSize: 11 };
const _hs35 = { color: 'var(--state-danger)' };
const _hs36 = { color: 'var(--text-muted)', marginTop: 4, wordBreak: 'break-all' };
const _hs37 = { marginTop: 10, textAlign: 'right' };
const _hs38 = { padding: '4px 12px', fontSize: 11, border: '1px solid var(--border-default)', borderRadius: 4, background: 'transparent', cursor: 'pointer', color: 'var(--text-secondary)' };

export default function ColumnTypePopover({
  typePopover, setTypePopover, columnTypes,
  validatingColumn, validationResults,
  onColumnTypeChange, onValidateColumnType,
}) {
  if (!typePopover) return null;
  const key = `${typePopover.table}.${typePopover.column}`;
  const rawEntry = columnTypes && columnTypes[key];
  // Normalise the entry to {type, format} no matter how it was stored.
  const entry = !rawEntry
    ? { type: 'auto', format: 'auto' }
    : (typeof rawEntry === 'string'
      ? { type: rawEntry, format: 'auto' }
      : { type: rawEntry.type || 'auto', format: rawEntry.format || 'auto' });
  const current = entry.type === 'number' ? 'decimal' : entry.type;
  const currentFormat = entry.format || 'auto';
  const isValidating = validatingColumn === key;
  const result = validationResults?.[key];
  const VW = 240;
  // Position the popover near the click point, but keep it on-screen.
  const left = Math.min(typePopover.screenX, window.innerWidth - VW - 16);
  const top = Math.min(typePopover.screenY + 8, window.innerHeight - 280);
  return (
    <>
      <div
        onClick={() => setTypePopover(null)}
        style={_hs29}
      />
      <div
        style={{
          position: 'fixed', left, top, zIndex: 51,
          width: VW,
          background: 'var(--bg-panel)',
          border: '1px solid var(--border-default)',
          borderRadius: 8,
          boxShadow: '0 8px 24px rgba(15,23,42,0.18)',
          padding: 12, fontSize: 12,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={_hs30}>
          Override column type
        </div>
        <div style={_hs31}>
          <code>{typePopover.column}</code> · native <code>{typePopover.dataType}</code>
        </div>
        <select
          value={current}
          onChange={(e) => {
            onColumnTypeChange?.(typePopover.table, typePopover.column, e.target.value, currentFormat);
          }}
          style={_hs32}
        >
          <option value="auto">auto (use native)</option>
          <option value="string">string</option>
          <option value="integer">integer (no decimals)</option>
          <option value="decimal">decimal (. or , as separator)</option>
          <option value="date">date</option>
          <option value="boolean">boolean</option>
        </select>
        {current === 'date' && (
          <select
            value={currentFormat}
            onChange={(e) => onColumnTypeChange?.(typePopover.table, typePopover.column, 'date', e.target.value)}
            style={_hs33}
            title="Expected date format in this column"
          >
            <option value="auto">auto (try ISO / EU / US)</option>
            <option value="iso">ISO (YYYY-MM-DD)</option>
            <option value="dd/mm/yyyy">DD/MM/YYYY (FR)</option>
            <option value="mm/dd/yyyy">MM/DD/YYYY (US)</option>
            <option value="dd-mm-yyyy">DD-MM-YYYY</option>
            <option value="dd.mm.yyyy">DD.MM.YYYY</option>
            <option value="yyyymmdd">YYYYMMDD</option>
          </select>
        )}
        {current !== 'auto' && (
          <button
            type="button"
            className="btn-hover"
            disabled={isValidating || !onValidateColumnType}
            onClick={() => onValidateColumnType?.(typePopover.table, typePopover.column, current, currentFormat)}
            style={{
              width: '100%', padding: '5px 8px', fontSize: 12,
              background: 'transparent', border: '1px solid var(--border-default)',
              borderRadius: 4, cursor: isValidating ? 'wait' : 'pointer',
              color: 'var(--text-secondary)',
            }}
          >
            {isValidating ? 'Testing…' : 'Test format on 100k rows'}
          </button>
        )}
        {result && (
          <div style={_hs34}>
            {result.error ? (
              <span style={_hs35}>Error: {result.error}</span>
            ) : (
              <>
                <div style={{ color: result.validRatio >= 0.95 ? 'var(--state-success, #16a34a)' : 'var(--state-warning, #92400e)' }}>
                  {result.validRatio >= 0.95 ? '✓' : '!'} {Math.round((result.validRatio || 0) * 100)}% valid ({result.validCount}/{result.sampleSize} rows)
                </div>
                {result.invalidExamples?.length > 0 && (
                  <div style={_hs36}>
                    Invalid examples: {result.invalidExamples.slice(0, 3).map((v) => v == null ? 'NULL' : `"${v}"`).join(', ')}
                  </div>
                )}
              </>
            )}
          </div>
        )}
        <div style={_hs37}>
          <button
            type="button"
            className="btn-hover"
            onClick={() => setTypePopover(null)}
            style={_hs38}
          >
            Close
          </button>
        </div>
      </div>
    </>
  );
}
