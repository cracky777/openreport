// The separators are the reader's: read from the language of the browser
// that opens the report, never written in a format. A report built in French
// and opened in London reads 1,234.5; the same report in Paris reads 1 234,5.
// (A decimal separator chosen per report missed every visual that did not go
// through the format — "92.48" on a French report.)
const separators = new Map();
export function readerSeparators() {
  const locale = (typeof navigator !== 'undefined' && navigator.language) || undefined;
  if (!separators.has(locale)) {
    let group = ',', decimal = '.';
    try {
      for (const part of new Intl.NumberFormat(locale).formatToParts(1234567.5)) {
        if (part.type === 'group') group = part.value;
        if (part.type === 'decimal') decimal = part.value;
      }
    } catch { /* an unknown locale: the English convention */ }
    // French writes a narrow no-break space, which not every report font has.
    separators.set(locale, { group: /\s/.test(group) ? '\u00a0' : group, decimal });
  }
  return separators.get(locale);
}

// A plain number in the reader's convention (percentages, abbreviations).
export function formatPlain(value, decimals = 1) {
  return Number(value).toFixed(decimals).replace('.', readerSeparators().decimal);
}

// A share as ECharts gives it (12.5), at most `decimals` places, no trailing zeros.
export function formatShare(value, decimals = 2) {
  return String(Number(Number(value).toFixed(decimals))).replace('.', readerSeparators().decimal);
}

// Format a number per its measure format: { decimals, thousandSep, prefix, suffix }.
// `thousandSep: ''` keeps its meaning (no grouping); any other value groups
// with the reader's separator.
export default function formatNumber(value, format) {
  if (value == null || isNaN(value)) return String(value ?? '');
  if (!format) return value.toLocaleString();

  const decimals = format.decimals ?? 0;
  const { group, decimal } = readerSeparators();
  const thousandSep = format.thousandSep === '' ? '' : group;
  const prefix = format.prefix ?? '';
  const suffix = format.suffix ?? '';

  // Format with decimals
  const fixed = Number(value).toFixed(decimals);

  // Split integer and decimal parts
  const [intPart, decPart] = fixed.split('.');

  // Add thousand separators
  let formatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, thousandSep);

  if (decPart !== undefined) {
    formatted += decimal + decPart;
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
    if (abs >= 1e9) return formatPlain(value / 1e9) + 'B';
    if (abs >= 1e6) return formatPlain(value / 1e6) + 'M';
    if (abs >= 1e3) return formatPlain(value / 1e3) + 'K';
    return String(value).replace('.', readerSeparators().decimal);
  }
  if (mode === 'K') return formatPlain(value / 1e3) + 'K';
  if (mode === 'M') return formatPlain(value / 1e6) + 'M';
  if (mode === 'B') return formatPlain(value / 1e9) + 'B';
  return String(value).replace('.', readerSeparators().decimal);
}
