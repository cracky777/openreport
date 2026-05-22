import formatNumber, { abbreviateNumber } from './formatNumber';
import { formatDuration } from './formatHuman';

// Shared ECharts datalabel formatter. Three different widgets had
// near-identical copies — Bar's variant additionally honoured a
// `hideZeros` toggle, Line's did not. Now folded into one with
// hideZeros as an explicit option so the call site stays declarative
// at each widget (Pie/Line just omit it; Bar passes hideZeros: true
// when the user enabled the toggle).
//
// `content` ∈ {'name', 'nameValue', 'percent', 'value' (anything else)}.
// `abbrMode` ∈ {'auto', 'thousands', 'millions', null} — feeds
// abbreviateNumber; falls back to formatNumber(value, fmt) when null.
// `fmt` is the user's number format spec (e.g. '0,0.00').
export function buildDataLabel(params, content, abbrMode, fmt, { hideZeros = false, isDuration = false } = {}) {
  if (hideZeros && (params.value === 0 || params.value == null)) return '';
  const numericValue = typeof params.value === 'number' ? params.value : Number(params.value);
  const val = isDuration && Number.isFinite(numericValue)
    ? formatDuration(numericValue)
    : (abbreviateNumber(params.value, abbrMode) ?? formatNumber(params.value, fmt));
  if (content === 'name') return params.name || params.seriesName || '';
  if (content === 'nameValue') return `${params.name || params.seriesName || ''}: ${val}`;
  if (content === 'percent') {
    if (params.percent != null) return params.percent + '%';
    return val;
  }
  return String(val);
}
