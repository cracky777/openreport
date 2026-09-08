// Format a number per its measure format: { decimals, thousandSep, prefix, suffix }.
export default function formatNumber(value, format) {
  if (value == null || isNaN(value)) return String(value ?? '');
  if (!format) return value.toLocaleString();

  const decimals = format.decimals ?? 0;
  const thousandSep = format.thousandSep ?? ' ';
  // The thousands separator was configurable, the decimal one hardcoded to '.',
  // so a report set to the French convention read "1 234.56" — two number
  // conventions in one widget. Now configurable; the default stays '.' because
  // deriving it from thousandSep would silently reformat every report already
  // written.
  const decimalSep = format.decimalSep ?? '.';
  const prefix = format.prefix ?? '';
  const suffix = format.suffix ?? '';

  // Format with decimals
  const fixed = Number(value).toFixed(decimals);

  // Split integer and decimal parts
  const [intPart, decPart] = fixed.split('.');

  // Add thousand separators
  let formatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, thousandSep);

  if (decPart !== undefined) {
    formatted += decimalSep + decPart;
  }

  return `${prefix}${formatted}${suffix}`;
}

/**
 * Abbreviate a number (K, M, B).
 *
 * `format` is the measure's own spec: its prefix and suffix are what make the
 * number mean something ("€1.2M", "1.2M kWh"). Abbreviating used to drop them,
 * so turning on "thousands" silently unlabelled every figure on the chart.
 * Decimals and separators are the abbreviation's business, not the format's.
 *
 * @param {number} value
 * @param {'none'|'auto'|'K'|'M'|'B'} mode
 * @param {{prefix?: string, suffix?: string}} [format]
 * @returns {string|null} null when no abbreviation applies, so callers can fall
 *   back to the full formatNumber.
 */
export function abbreviateNumber(value, mode = 'none', format = null) {
  const abbreviated = abbreviateRaw(value, mode);
  if (abbreviated == null) return null;
  if (!format) return abbreviated;
  return `${format.prefix ?? ''}${abbreviated}${format.suffix ?? ''}`;
}

function abbreviateRaw(value, mode) {
  if (value == null || isNaN(value) || mode === 'none') return null;
  const abs = Math.abs(value);
  if (mode === 'auto') {
    if (abs >= 1e9) return (value / 1e9).toFixed(1) + 'B';
    if (abs >= 1e6) return (value / 1e6).toFixed(1) + 'M';
    if (abs >= 1e3) return (value / 1e3).toFixed(1) + 'K';
    return String(value);
  }
  if (mode === 'K') return (value / 1e3).toFixed(1) + 'K';
  if (mode === 'M') return (value / 1e6).toFixed(1) + 'M';
  if (mode === 'B') return (value / 1e9).toFixed(1) + 'B';
  return String(value);
}
