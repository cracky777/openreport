// Whether the two columns of a join can be compared. Most engines refuse to
// match a text column with a number (DuckDB tries to cast the text and fails
// on the first word, Postgres has no such operator), and the error only
// surfaced when a report ran — long after the join was drawn.
//
// A database type is read as a family: number, text or date. A type none of
// these patterns recognise gives no family and never raises a warning: a false
// alarm on some dialect's exotic type would teach users to ignore this one.
// Mirror of server/utils/joinTypes.js (the model validation): keep the two in step.

const FAMILIES = [
  // Before "number": INTERVAL is not one, TIMESTAMP must not match "int".
  ['date', /^(date|datetime|datetime2|smalldatetime|datetimeoffset|time|timestamp)\b|^timestamp(tz)?$|^timestamp with(out)? time zone$/],
  ['number', /^(u?(tiny|small|medium|big|huge)?int(eger)?\d*|u?int\d+|int64|serial|bigserial|smallserial|numeric|decimal|number|real|float\d*|double( precision)?|money|smallmoney|bignumeric)\b/],
  ['text', /^(n?(var)?char|character( varying)?|n?text|string|varchar2|nvarchar2|clob|tinytext|mediumtext|longtext|bpchar|citext)\b/],
];

export function typeFamily(dataType) {
  const t = String(dataType || '').trim().toLowerCase();
  if (!t) return null;
  for (const [family, re] of FAMILIES) if (re.test(t)) return family;
  return null;
}

// The two families when they are known and differ, else null.
export function joinTypeMismatch(fromType, toType) {
  const a = typeFamily(fromType);
  const b = typeFamily(toType);
  return a && b && a !== b ? { from: a, to: b } : null;
}
