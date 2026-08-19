// Which data-binding zones each visual type actually consumes, and how a
// widget's binding is projected when the user switches its visual type.
// Single source of truth shared by the query payload (what to fetch) and the
// type-switch transform, so changing visuals keeps the common fields — and
// their order — instead of dropping them.

const LEGEND_TYPES = new Set(['bar', 'line', 'combo', 'scatter']);

export const usesLegend = (type) => LEGEND_TYPES.has(type);
export const usesPivotColumns = (type) => type === 'pivot';

// Canonical, ordered measure list of a widget whatever zones its type
// spreads them across. Zone-specific splits (combo bar/line, scatter
// x/y/size) are unioned with selectedMeasures rather than replacing it:
// a bar with five measures switched to scatter (three roles) and back
// must come back with all five.
export function collectMeasures(type, binding = {}) {
  const selected = binding.selectedMeasures || [];
  if (type === 'scatter') {
    const sm = binding.scatterMeasures || {};
    return [...new Set([...selected, ...[sm.x, sm.y, sm.size].filter(Boolean)])];
  }
  if (type === 'combo') {
    return [...new Set([...selected, ...(binding.comboBarMeasures || []), ...(binding.comboLineMeasures || [])])];
  }
  return selected;
}

const sameSet = (a, b) => a.length === b.length && new Set(a).size === new Set([...a, ...b]).size;

// Project `binding` for a visual-type switch. selectedDimensions /
// selectedMeasures are the canonical carriers and keep their order;
// type-specific splits are preserved when they still cover exactly the
// canonical measures — a round trip combo → bar → combo keeps the user's
// bar/line split — and reseeded from the canonical list otherwise. Unused
// zone keys (legend on a pie, pivot columns on a bar…) deliberately STAY in
// the binding for the same round-trip reason: the query payload only reads
// the zones the current type consumes.
export function transformBinding(oldType, newType, binding = {}) {
  const measures = collectMeasures(oldType, binding);
  const next = { ...binding, selectedMeasures: measures };

  if (newType === 'combo') {
    const cur = [...(binding.comboBarMeasures || []), ...(binding.comboLineMeasures || [])];
    if (!sameSet(cur, measures)) {
      next.comboBarMeasures = measures;
      next.comboLineMeasures = [];
    }
  }
  if (newType === 'scatter') {
    const sm = binding.scatterMeasures || {};
    const roles = [sm.x, sm.y, sm.size].filter(Boolean);
    if (!sameSet(roles, measures)) {
      next.scatterMeasures = {
        ...(measures[0] ? { x: measures[0] } : {}),
        ...(measures[1] ? { y: measures[1] } : {}),
        ...(measures[2] ? { size: measures[2] } : {}),
      };
    }
  }
  return next;
}
