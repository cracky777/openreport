/**
 * Format a number according to measure format settings.
 * @param {number} value - The number to format
 * @param {object} format - { decimals, thousandSep, prefix, suffix }
 * @returns {string}
 */
export default function formatNumber(value, format) {
  if (value == null || isNaN(value)) return String(value ?? '');
  if (!format) return value.toLocaleString();

  const decimals = format.decimals ?? 0;
  const thousandSep = format.thousandSep ?? ' ';
  const prefix = format.prefix ?? '';
  const suffix = format.suffix ?? '';

  // Format with decimals
  const fixed = Number(value).toFixed(decimals);

  // Split integer and decimal parts
  const [intPart, decPart] = fixed.split('.');

  // Add thousand separators
  let formatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, thousandSep);

  if (decPart !== undefined) {
    formatted += '.' + decPart;
  }

  return `${prefix}${formatted}${suffix}`;
}

/**
 * Abbreviate a number (K, M, B).
 * @param {number} value
 * @param {'none'|'auto'|'K'|'M'|'B'} mode
 * @returns {string}
 */
export function abbreviateNumber(value, mode = 'none') {
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
