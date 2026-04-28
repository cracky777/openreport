/**
 * Calculate optimal label rotation based on available width and label lengths.
 * Returns 0 (horizontal), 30 (slight diagonal), 45 (diagonal), or 60 (steep diagonal).
 */
export function calcLabelRotation(labels, chartWidth, isHorizontalBar = false) {
  if (isHorizontalBar || !labels || !Array.isArray(labels) || labels.length <= 1) return 0;

  // Estimate available width per label
  const widthPerLabel = (chartWidth || 400) / labels.length;

  // Estimate max label length in characters
  const lengths = labels.map((l) => String(l || '').length);
  const maxLabelLen = lengths.length > 0 ? Math.max(...lengths) : 0;
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

/**
 * Calculate bottom grid margin based on label rotation and max label length.
 */
export function calcBottomMargin(rotation, labels, defaultMargin = 35) {
  if (rotation === 0) return defaultMargin;
  const maxLen = Math.max(...(labels || ['']).map((l) => String(l).length));
  const charHeight = 6; // approximate
  const extraHeight = Math.sin((rotation * Math.PI) / 180) * maxLen * charHeight;
  return Math.min(defaultMargin + extraHeight, 120);
}
