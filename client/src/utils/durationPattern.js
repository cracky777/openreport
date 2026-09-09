/**
 * Renders a number of seconds through a pattern the REPORT AUTHOR writes.
 *
 * A duration only has one honest place to be formatted, and it is here: a
 * measure that formats itself in SQL returns a string, and a string has no
 * position on an axis, no order in a sort and no total. So the measure returns
 * seconds and its display shape travels with it, into every visual.
 *
 * The pattern is the author's, not ours — which is the whole point:
 *
 *   DDj HH:MM:SS   164j 08:02:17
 *   D"j" H"h"MM    164j 8h02
 *   [H]:MM:SS      3944:02:17     (hours never roll over into days)
 *
 * Tokens, doubled to pad to two digits:
 *   D / DD    days
 *   H / HH    hours within the day     M / MM  minutes within the hour
 *   S / SS    seconds within the minute
 *   [D] [H] [M] [S]   the whole duration in that unit, nothing carried over
 *
 * Anything else is printed as-is, and text between double quotes is always
 * literal — which is how a pattern can contain an H or an S of its own.
 * Padding never truncates: 164 days stay 164 under DD, where a naive pad
 * would have shown 16.
 */

const UNIT_SECONDS = { D: 86400, H: 3600, M: 60, S: 1 };
// What each token shows once the larger units have taken their share.
const REMAINDER = { D: null, H: 86400, M: 3600, S: 60 };

const pad = (n, width) => {
  const s = String(Math.abs(n));
  return (n < 0 ? '-' : '') + (s.length >= width ? s : '0'.repeat(width - s.length) + s);
};

/** True when this format asks for a duration rather than a plain number. */
export function isDurationFormat(format) {
  return typeof format?.duration === 'string' && format.duration.trim() !== '';
}

export function formatDurationPattern(seconds, pattern) {
  const total = Math.floor(Math.abs(Number(seconds) || 0));
  const sign = (Number(seconds) || 0) < 0 ? '-' : '';
  const src = String(pattern || '');
  let out = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    // Quoted text is literal, so a pattern can spell out "Heures" without its
    // letters being read as tokens.
    if (ch === '"') {
      const end = src.indexOf('"', i + 1);
      if (end === -1) { out += src.slice(i + 1); break; }
      out += src.slice(i + 1, end);
      i = end + 1;
      continue;
    }
    // [X] — the whole duration in that unit.
    if (ch === '[' && src[i + 2] === ']' && UNIT_SECONDS[src[i + 1]]) {
      out += String(Math.floor(total / UNIT_SECONDS[src[i + 1]]));
      i += 3;
      continue;
    }
    if (UNIT_SECONDS[ch]) {
      let width = 0;
      while (src[i + width] === ch) width += 1;
      const unit = UNIT_SECONDS[ch];
      const carried = REMAINDER[ch];
      const value = Math.floor((carried === null ? total : total % carried) / unit);
      out += pad(value, width);
      i += width;
      continue;
    }
    out += ch;
    i += 1;
  }
  return sign + out;
}
