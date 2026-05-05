// Axis sort key resolution. The DropZone "axis sort" sorts by the dim value;
// for date-part dimensions (Year/Month Name/etc.) we want chronological order
// rather than alphabetical, which means mapping month/day name strings to
// their natural index. Numeric date parts (num_year, num_month, ...) are
// already comparable as numbers but arrive as strings in some dialects, so
// we coerce them too.

const MONTH_NAMES = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6,
  juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12,
};

const DAY_NAMES = {
  monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 0,
  mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 0,
  lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6, dimanche: 0,
};

// Strip diacritics + lowercase for locale-tolerant lookup.
const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

export function getAxisSortKey(value, dimDef) {
  if (value == null || value === '') return null;
  const dp = dimDef?.datePart;
  if (dp) {
    if (dp.startsWith('num_')) {
      const n = Number(value);
      return Number.isFinite(n) ? n : value;
    }
    if (dp === 'name_month') {
      const k = MONTH_NAMES[norm(value)];
      return k != null ? k : value;
    }
    if (dp === 'name_day') {
      const k = DAY_NAMES[norm(value)];
      return k != null ? k : value;
    }
  }
  if (dimDef?.type === 'integer' || dimDef?.type === 'decimal' || dimDef?.type === 'number') {
    const n = Number(value);
    return Number.isFinite(n) ? n : value;
  }
  if (dimDef?.type === 'date') {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : String(value);
  }
  return String(value);
}

export function compareAxisValues(a, b, dimDef, dir = 'asc') {
  const ka = getAxisSortKey(a, dimDef);
  const kb = getAxisSortKey(b, dimDef);
  // Nulls always sort to the end regardless of direction.
  if (ka == null && kb == null) return 0;
  if (ka == null) return 1;
  if (kb == null) return -1;
  let cmp;
  if (typeof ka === 'number' && typeof kb === 'number') cmp = ka - kb;
  else cmp = String(ka).localeCompare(String(kb), undefined, { numeric: true });
  return dir === 'desc' ? -cmp : cmp;
}
