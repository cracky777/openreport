/**
 * Calculate optimal label rotation based on available width and label lengths.
 * Returns 0 (horizontal), 30 (slight diagonal), 45 (diagonal), or 60 (steep diagonal).
 */
export function calcLabelRotation(labels, chartWidth, isHorizontalBar = false) {
  if (isHorizontalBar || !labels || !Array.isArray(labels) || labels.length <= 1) return 0;

  // Estimate available width per label
  const widthPerLabel = (chartWidth || 400) / labels.length;

  const maxLabelLen = Math.max(...labels.map((l) => String(l || '').length));
  if (maxLabelLen === 0) return 0;

  // Approximate pixel width per character (depends on font size ~12px)
  const charWidth = 7;
  const labelPixelWidth = maxLabelLen * charWidth;

  // If labels fit comfortably, no rotation needed
  if (labelPixelWidth < widthPerLabel * 0.8) return 0;

  // If labels are a bit too wide, slight rotation
  if (labelPixelWidth < widthPerLabel * 1.5) return 30;

  // If labels are much too wide, steeper rotation
  if (labelPixelWidth < widthPerLabel * 2.5) return 45;

  // Very long labels or many labels
  return 60;
}

// A round step at or above `v`: 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8 or 10 × a
// power of ten. Finer than the usual 1-2-5 ladder so a data max of 1320
// lands on 5 × 300 rather than 5 × 500 with the bars in the bottom half.
const NICE_STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
function niceCeil(v) {
  if (!(v > 0)) return 0;
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  return (NICE_STEPS.find((s) => m <= s) ?? 10) * p;
}

/**
 * Extents for a combo's two value axes so that their ticks coincide: both
 * axes are cut into the same number of steps, so every horizontal grid line
 * (drawn for the left axis) meets a label on the right one. Left to itself,
 * each axis picked its own round interval and the right labels floated
 * between the lines.
 *
 * `leftMax` / `rightMax` are the data maxima with headroom; an interval the
 * author pinned in the Axes section is kept and the other side follows it.
 * A side without data comes back undefined and stays on ECharts' defaults.
 */
export function alignDualAxes({ leftMax, rightMax, leftInterval, rightInterval, splits = 5 }) {
  const none = { max: undefined, interval: undefined };
  if (!(leftMax > 0) || !(rightMax > 0)) return { left: none, right: none };
  let li = leftInterval > 0 ? leftInterval : null;
  let ri = rightInterval > 0 ? rightInterval : null;
  // The step count comes from a pinned interval when there is one; with both
  // pinned, the side needing more steps sets it. Otherwise the left axis is
  // cut into round steps and the right one follows with as many.
  let n;
  if (li && ri) n = Math.max(Math.ceil(leftMax / li), Math.ceil(rightMax / ri));
  else if (li) n = Math.ceil(leftMax / li);
  else if (ri) n = Math.ceil(rightMax / ri);
  else {
    li = niceCeil(leftMax / splits);
    n = Math.ceil(leftMax / li);
  }
  if (!li) li = niceCeil(leftMax / n);
  if (!ri) ri = niceCeil(rightMax / n);
  return {
    left: { max: li * n, interval: li },
    right: { max: ri * n, interval: ri },
  };
}

/**
 * Axis-line options for a colour picked in the Axes section. Unset, the axis
 * keeps ECharts' defaults (a value axis draws no line at all); picking a colour
 * also shows the line, since a colour nobody can see is not a choice.
 */
export function axisLineStyle(color) {
  return color ? { axisLine: { show: true, lineStyle: { color } } } : {};
}

/**
 * Calculate bottom grid margin based on label rotation and max label length.
 */
export function calcBottomMargin(rotation, labels, defaultMargin = 35, fontSize = 11) {
  if (rotation === 0) return defaultMargin;
  const maxLen = Math.max(...(labels || ['']).map((l) => String(l).length));
  // Height a tilted label takes below the axis: its width projected on the
  // vertical, plus its own line height. Glyphs of a sans-serif run about 0.6
  // of the font size wide. A negative tilt leans the other way but takes the
  // same height.
  const rad = (Math.abs(rotation) * Math.PI) / 180;
  const textWidth = maxLen * fontSize * 0.6;
  const labelHeight = Math.sin(rad) * textWidth + Math.cos(rad) * fontSize;
  // The default margin already holds one flat line of labels; only what
  // sticks out below it is added. Capped so a very long label at 90° cannot
  // swallow the plot on a short widget.
  return Math.min(defaultMargin + Math.max(0, labelHeight - fontSize), 180);
}
