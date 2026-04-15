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
