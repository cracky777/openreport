import { useLayoutEffect, useState } from 'react';

// ECharts paints on a canvas, so a chart can't say `var(--text-primary)` the way
// the rest of the UI does: the colour has to be a literal at option-build time.
// The report theme lives as CSS custom properties on a `[data-theme]` wrapper
// above the widget (Viewer and Editor both set them inline), so we read them
// back from the widget's computed style once it is mounted. Fallbacks are the
// light theme. `panel` is the card a chart is drawn on; `track` what sits empty
// on it (a gauge's track, a map's land without a value) — the surfaces the
// server colours with (colorScheme.js SURFACES), so a visual left to its
// defaults looks in a dark report as it did in Let's Talk.
const FALLBACK = { text: '#0f172a', grid: '#e2e8f0', panel: '#ffffff', strong: '#cbd5e1' };
const VARS = { text: '--text-primary', grid: '--border-default', panel: '--bg-panel', strong: '--border-strong' };

const isDark = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return false;
  const n = parseInt(m[1], 16);
  return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) < 128;
};

const withTrack = (t) => ({ ...t, track: isDark(t.panel) ? t.strong : t.grid });

export function readChartTheme(el) {
  if (!el || typeof getComputedStyle !== 'function') return withTrack(FALLBACK);
  const cs = getComputedStyle(el);
  const out = {};
  for (const [key, name] of Object.entries(VARS)) {
    out[key] = cs.getPropertyValue(name).trim() || FALLBACK[key];
  }
  return withTrack(out);
}

const same = (a, b) => Object.keys(VARS).every((k) => a[k] === b[k]);

// Returns `[theme, rootRef]`; put `rootRef` on the widget's root element. A
// callback ref (rather than a ref object) so the read happens when the root
// actually mounts — widgets render an empty state first and only mount the
// chart once data arrives. The observer re-reads when the Editor swaps the
// theme, which rewrites the wrapper's `data-theme` and inline variables.
export function useChartTheme() {
  const [el, setEl] = useState(null);
  const [theme, setTheme] = useState(() => withTrack(FALLBACK));
  useLayoutEffect(() => {
    if (!el) return undefined;
    const apply = () => {
      const next = readChartTheme(el);
      setTheme((prev) => (same(prev, next) ? prev : next));
    };
    apply();
    const host = el.closest('[data-theme]');
    if (!host || typeof MutationObserver === 'undefined') return undefined;
    const observer = new MutationObserver(apply);
    observer.observe(host, { attributes: true, attributeFilter: ['data-theme', 'style'] });
    return () => observer.disconnect();
  }, [el]);
  return [theme, setEl];
}
