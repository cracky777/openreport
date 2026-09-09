/**
 * A cell's value as a number, or NaN when it simply is not one.
 *
 * A measure is free to return text: a formatted duration ("164j 08:02:17"), a
 * label, a status. The scorecard used to pull the DIGITS out of such a string —
 * `String(v).replace(/[^\d.-]/g, '')` — which turned that duration into
 * 80217 and rendered it, right-aligned, as a number. The user saw a figure
 * they had never computed.
 *
 * So only what a number can actually be written with is tolerated: the spaces
 * that separate thousands, and a comma standing in for the decimal point.
 * Anything else left over means the value is text, and text is shown as text.
 * Drivers hand back plain forms — a PostgreSQL NUMERIC arrives as "1234.56" —
 * so nothing legitimate is lost.
 */
export function toNumber(value) {
  if (typeof value === 'number') return value;
  if (value == null) return NaN;
  const trimmed = String(value).trim();
  if (!trimmed) return NaN;
  // Both conventions for writing the same number: "1,234.56" separates its
  // thousands with the comma, "1 234,56" uses it as the decimal point. Which
  // one it is can only be told from whether a dot is there too. Older saves
  // hold values in either form (this rule comes from the gauge, which had to
  // read them back).
  const hasDot = trimmed.includes('.');
  const hasComma = trimmed.includes(',');
  let cleaned = trimmed.replace(/[\s\u00a0']/g, '');
  if (hasComma && hasDot) cleaned = cleaned.replace(/,/g, '');
  else if (hasComma) cleaned = cleaned.replace(',', '.');
  return /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(cleaned) ? parseFloat(cleaned) : NaN;
}
