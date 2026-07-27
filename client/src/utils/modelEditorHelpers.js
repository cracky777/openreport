// Pure column-type helpers for the model editor. Extracted verbatim from
// pages/ModelEditor.jsx (LOT 6.3). No React, no component state — they map raw
// database data-types to OpenReport's type vocabulary, normalise the legacy
// 'number' value, and read/write the columnTypes override entries (which are
// either a plain type string or a { type, format } object).

// Whole-number db types (no fractional part). Used to pre-select 'integer'
// when the user creates a Dimension from such a column.
export const isIntegerType = (dataType) => {
  const t = String(dataType || '').toLowerCase();
  return ['integer', 'int', 'int2', 'int4', 'int8', 'bigint', 'smallint',
    'tinyint', 'mediumint', 'serial', 'bigserial', 'smallserial'].includes(t);
};

// Floating / fixed-precision numeric types.
export const isDecimalType = (dataType) => {
  const t = String(dataType || '').toLowerCase();
  return ['numeric', 'decimal', 'real', 'double precision', 'float', 'double',
    'money', 'smallmoney',
    // Postgres interval — durations are aggregable in SQL (SUM/AVG return interval).
    'interval'].includes(t);
};

// Combined check used by the schema canvas to decide whether to expose the
// "M" (Measure) flag on a column.
export const isNumeric = (dataType) => isIntegerType(dataType) || isDecimalType(dataType);

export const isDateType = (dataType) => {
  const t = String(dataType || '').toLowerCase();
  return ['date', 'timestamp', 'timestamptz', 'timestamp with time zone',
    'timestamp without time zone', 'datetime', 'time',
    'smalldatetime', 'datetime2', 'datetimeoffset'].includes(t);
};

export const getColumnType = (dataType) => {
  if (isIntegerType(dataType)) return 'integer';
  if (isDecimalType(dataType)) return 'decimal';
  if (isDateType(dataType)) return 'date';
  return 'string';
};

// Older models stored 'number' as the catch-all numeric type. Normalise it
// to 'decimal' on read so the new dropdown widgets and validators don't
// need to special-case the legacy value. Saving emits the new vocabulary.
export const normalizeStoredType = (t) => (t === 'number' ? 'decimal' : t);

// columnTypes entries can be either a plain string ('date', 'integer', ...)
// or an object { type, format } once the user picks an explicit format
// (relevant for dates: 'dd/mm/yyyy', 'iso', etc.). These two helpers
// normalise reads/writes so the rest of the code can stay simple.
export const readOverride = (entry) => {
  if (!entry) return null;
  if (typeof entry === 'string') return { type: entry, format: 'auto' };
  return { type: entry.type, format: entry.format || 'auto' };
};
// Build the value to store back. Returns null when the override is auto
// (= no override, drop the entry entirely).
export const writeOverride = (type, format) => {
  if (!type || type === 'auto') return null;
  if (!format || format === 'auto') return type;       // simple form
  return { type, format };                              // object form
};

// Encoded chevron used as a CSS background-image so the select looks like a
// real interactive dropdown instead of a flat read-only field.
export const chevronSvg = (color) => `no-repeat right 6px center / 10px url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><path fill='none' stroke='${encodeURIComponent(color)}' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' d='M4 6l4 4 4-4'/></svg>")`;
