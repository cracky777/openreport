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

export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n < 1024 ** 4) return `${(n / (1024 ** 3)).toFixed(2)} GB`;
  return `${(n / (1024 ** 4)).toFixed(2)} TB`;
}
