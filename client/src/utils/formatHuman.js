// Tiny formatters for human-friendly admin / cache UI.
//
// `formatDuration` decides the unit on its own:
//   < 60s        → "Xs"
//   60s ≤ X < 1h → "Xmin" (rounded to integer)
//   ≥ 1h         → "Xh" with at most 1 decimal so 25 200s shows as "7h"
//                  and 30 600s shows as "8.5h" instead of a noisy "8h30m"
//
// `formatBytes` mirrors the size-in-cells column in the file uploader
// (1 KB = 1024 bytes). Caps at TB which is overkill for the in-memory
// cache but keeps the helper honest if it gets reused elsewhere.
export function formatDuration(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}min`;
  const h = s / 3600;
  // Drop the decimal for whole hours so 24h doesn't display as 24.0h.
  return Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`;
}

// Test whether a column (referenced by its display label) is a duration
// column — i.e. the underlying measure has `dataType: 'interval'` so the
// server emits its value as EPOCH seconds and widgets should render it
// as "1h" / "30min" / "45s" rather than the raw number. Returns false
// (no-op) when `durationCols` is missing/empty, so the helper is safe to
// drop into existing formatters without an outer guard.
export function isDurationCol(label, durationCols) {
  return Array.isArray(durationCols) && durationCols.includes(label);
}

// Format `val` as a duration if its column is an interval, otherwise
// invoke `fallback()` for the normal numeric formatting path. Designed
// to slot into the one-liner formatter callbacks ECharts wants:
//   formatter: (v) => formatMaybeDuration(v, measureName, durationCols, () => formatNumber(v, fmt))
export function formatMaybeDuration(val, label, durationCols, fallback) {
  if (isDurationCol(label, durationCols) && typeof val === 'number') return formatDuration(val);
  return fallback();
}

export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n < 1024 ** 4) return `${(n / (1024 ** 3)).toFixed(2)} GB`;
  return `${(n / (1024 ** 4)).toFixed(2)} TB`;
}
