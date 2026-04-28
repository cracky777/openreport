/**
 * Date helpers for chart axis handling.
 */

// Date hierarchy levels
export const DATE_LEVELS = ['year', 'month', 'day'];

// Month names for sorting
const MONTH_ORDER = {
  'january': 1, 'february': 2, 'march': 3, 'april': 4, 'may': 5, 'june': 6,
  'july': 7, 'august': 8, 'september': 9, 'october': 10, 'november': 11, 'december': 12,
  'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'jun': 6, 'jul': 7, 'aug': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12,
  'janvier': 1, 'février': 2, 'mars': 3, 'avril': 4, 'mai': 5, 'juin': 6,
  'juillet': 7, 'août': 8, 'septembre': 9, 'octobre': 10, 'novembre': 11, 'décembre': 12,
};

const DAY_ORDER = {
  'monday': 1, 'tuesday': 2, 'wednesday': 3, 'thursday': 4, 'friday': 5, 'saturday': 6, 'sunday': 7,
  'mon': 1, 'tue': 2, 'wed': 3, 'thu': 4, 'fri': 5, 'sat': 6, 'sun': 7,
  'lundi': 1, 'mardi': 2, 'mercredi': 3, 'jeudi': 4, 'vendredi': 5, 'samedi': 6, 'dimanche': 7,
};

/**
 * Check if a dimension is date-related (date type or date part).
 */
export function isDateDimension(dim) {
  return dim?.type === 'date' || !!dim?.datePart;
}

/**
 * Get the date part type of a dimension.
 */
export function getDatePart(dim) {
  if (dim?.datePart) return dim.datePart;
  if (dim?.type === 'date') return 'full_date';
  return null;
}

/**
 * Sort labels chronologically based on the date part type.
 */
export function sortDateLabels(labels, values, datePart) {
  if (!datePart || !labels || labels.length === 0) return { labels, values };

  const indices = labels.map((_, i) => i);

  indices.sort((a, b) => {
    const la = String(labels[a]).trim().toLowerCase();
    const lb = String(labels[b]).trim().toLowerCase();

    // Month names
    if (datePart === 'name_month') {
      return (MONTH_ORDER[la] || 99) - (MONTH_ORDER[lb] || 99);
    }
    // Day names
    if (datePart === 'name_day') {
      return (DAY_ORDER[la] || 99) - (DAY_ORDER[lb] || 99);
    }
    // Numeric parts (year, month number, week, day of week)
    if (['num_year', 'num_month', 'num_week', 'num_day_of_week'].includes(datePart)) {
      return (Number(labels[a]) || 0) - (Number(labels[b]) || 0);
    }
    // Full date — parse as date
    if (datePart === 'full_date') {
      const da = new Date(labels[a]);
      const db = new Date(labels[b]);
      if (!isNaN(da) && !isNaN(db)) return da - db;
    }
    // Fallback: string compare
    return String(labels[a]).localeCompare(String(labels[b]));
  });

  const sortedLabels = indices.map((i) => labels[i]);
  const sortedValues = values ? indices.map((i) => values[i]) : null;
  return { labels: sortedLabels, values: sortedValues, indices };
}

/**
 * Sort multi-series data chronologically.
 */
export function sortDateSeries(labels, series, datePart) {
  if (!datePart || !labels || labels.length === 0) return { labels, series };

  const { labels: sortedLabels, indices } = sortDateLabels(labels, null, datePart);
  const sortedSeries = series ? series.map((s) => ({
    ...s,
    values: indices.map((i) => s.values[i]),
  })) : null;

  return { labels: sortedLabels, series: sortedSeries };
}

/**
 * Format a date label for the axis based on the date part.
 */
export function formatDateLabel(label, datePart) {
  if (!datePart) return label;

  if (datePart === 'full_date') {
    const d = new Date(label);
    if (!isNaN(d)) return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  if (datePart === 'name_month' || datePart === 'name_day') {
    // Trim whitespace (TO_CHAR pads with spaces)
    return String(label).trim();
  }
  return label;
}
