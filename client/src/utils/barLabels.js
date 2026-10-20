// Where a bar's data label goes, in words that follow the bar whatever its
// direction: `top` the outside of its end, `insideTop` inside its end,
// `inside` its middle, `insideBottom` inside its base, `auto` (the default)
// outside its end when there is room for the text there, inside its end
// otherwise. ECharts names sides of the screen instead: 'top' put the label of
// a horizontal bar ABOVE it, between two bars (Mutuelle Horizon).

const SIDES = {
  vertical: { end: 'top', insideEnd: 'insideTop', base: 'insideBottom' },
  verticalInverse: { end: 'bottom', insideEnd: 'insideBottom', base: 'insideTop' },
  horizontal: { end: 'right', insideEnd: 'insideRight', base: 'insideLeft' },
  horizontalInverse: { end: 'left', insideEnd: 'insideLeft', base: 'insideRight' },
};

/** The ECharts label position of a placement on bars of this direction ('auto' resolved by the caller). */
export function echartsPosition(placement, direction = 'vertical') {
  const side = SIDES[direction] || SIDES.vertical;
  if (placement === 'inside') return 'inside';
  if (placement === 'insideTop') return side.insideEnd;
  if (placement === 'insideBottom') return side.base;
  return side.end;
}

// 'outside' is the pie's word, saved on bars by a design card: the end.
export const placementOf = (config) => {
  const p = config?.dataLabelPosition;
  return !p || p === 'outside' ? 'auto' : p;
};

/**
 * `auto`, item by item: outside the end of the bar when the text fits
 * between the end and the edge of the plot, else inside its end when the bar
 * is long enough, else outside anyway (a short bar near the edge).
 * @param {{ values: number[], texts: string[], max: number, length: number, textWidth: (s: string) => number, along: boolean }} p
 *   `length`: the plot's size along the bars, in px; `along`: the text runs along the bar (horizontal
 *   bars) — on vertical bars it is the text's height that has to fit.
 * @returns {('outside'|'inside')[]}
 */
export function autoPlacements({ values, texts, max, length, textWidth, textHeight = 12, along }) {
  return values.map((v, i) => {
    const bar = max > 0 ? (Math.abs(v) / max) * length : 0;
    const need = (along ? textWidth(texts[i] || '') : textHeight) + 8;
    if (length - bar >= need) return 'outside';
    return bar >= need ? 'inside' : 'outside';
  });
}

// The ink that reads on a bar of this color: a label inside the bar sits on it.
export function inkOn(hex, fallback) {
  if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) return fallback;
  const c = (i) => parseInt(hex.slice(i, i + 2), 16);
  const lum = (0.299 * c(1) + 0.587 * c(3) + 0.114 * c(5)) / 255;
  return lum < 0.6 ? '#ffffff' : '#1f2937';
}

// A nice top for the value axis, set by the chart itself so `auto` knows how
// long each bar will be drawn.
export function niceMax(max) {
  if (!(max > 0)) return undefined;
  const step = 10 ** Math.floor(Math.log10(max));
  const n = max / step;
  const nice = n <= 1 ? 1 : n <= 1.2 ? 1.2 : n <= 1.5 ? 1.5 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 3 ? 3 : n <= 4 ? 4 : n <= 5 ? 5 : n <= 6 ? 6 : n <= 8 ? 8 : 10;
  return nice * step;
}

let measureCtx = null;
/** Width in px of a label in this font (canvas measure; a rough count where there is no canvas). */
export function measureText(text, fontSize = 10, fontFamily = 'sans-serif') {
  try {
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
    measureCtx.font = `${fontSize}px ${fontFamily || 'sans-serif'}`;
    return measureCtx.measureText(String(text)).width;
  } catch {
    return String(text).length * fontSize * 0.6;
  }
}
