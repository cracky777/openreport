import { fontStack, loadGoogleFont } from '../utils/googleFonts';

// Resolve the font-stack CSS string for each requested config key and
// kick off the Fontsource load for any that aren't cached yet.
//
// Called as: `useChartFonts(config, ['dataLabel', 'xAxisLabel', 'yAxisLabel', 'title'])`
// → returns `{ dataLabel: '<stack>'|undefined, xAxisLabel: ..., ... }`
// (undefined when the corresponding `<key>FontFamily` is absent — ECharts
// then falls back to its chart-wide default, which is what we want; passing
// an empty string would force ECharts to render in its placeholder face).
//
// Behaviour preserved verbatim from the prior per-widget loops: loadGoogleFont
// fires DURING render. That's a render-time side effect, but it's idempotent
// (Set-based dedup inside googleFonts.js) and the async import resolves
// regardless of whether the call site is render-body or useEffect — keeping
// the existing semantics so this stays a pure code move.
export function useChartFonts(config, keys) {
  const out = {};
  for (const key of keys) {
    const fam = config?.[`${key}FontFamily`];
    if (fam) loadGoogleFont(fam);
    out[key] = fam ? fontStack(fam) : undefined;
  }
  return out;
}
