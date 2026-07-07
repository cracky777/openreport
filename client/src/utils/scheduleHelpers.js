// Cron / timezone helpers for report schedule editors. Pure, no React.
// Relocated verbatim from Dashboard.jsx (LOT 6.3 Phase 1).

export const TIMEZONE_OPTIONS = (() => {
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.supportedValuesOf === 'function') {
      const all = Intl.supportedValuesOf('timeZone');
      if (Array.isArray(all) && all.length > 0) return all;
    }
  } catch { /* fall through */ }
  return [
    'UTC',
    'Europe/Paris', 'Europe/London', 'Europe/Berlin', 'Europe/Madrid', 'Europe/Rome',
    'Europe/Amsterdam', 'Europe/Brussels', 'Europe/Zurich', 'Europe/Lisbon',
    'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
    'America/Toronto', 'America/Sao_Paulo',
    'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Singapore', 'Asia/Dubai', 'Asia/Kolkata',
    'Australia/Sydney', 'Pacific/Auckland',
  ];
})();

export function timeToCron(timeStr) {
  const [h, m] = (timeStr || '09:00').split(':').map((n) => parseInt(n, 10) || 0);
  return `${Math.max(0, Math.min(59, m))} ${Math.max(0, Math.min(23, h))} * * *`;
}

export function cronToTime(cron) {
  const parts = (cron || '').trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hour, day, mon, dow] = parts;
  if (day !== '*' || mon !== '*' || dow !== '*') return null;
  if (!/^\d+$/.test(min) || !/^\d+$/.test(hour)) return null;
  const mn = Number(min); const hn = Number(hour);
  if (mn < 0 || mn > 59 || hn < 0 || hn > 23) return null;
  return `${String(hn).padStart(2, '0')}:${String(mn).padStart(2, '0')}`;
}

export function formatCronHuman(cron) {
  const t = cronToTime(cron);
  return t ? `Daily at ${t}` : cron;
}
