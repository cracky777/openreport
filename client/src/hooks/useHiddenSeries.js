import { useState, useCallback } from 'react';

// Per-widget "which series are hidden by the legend click?" state.
// Lived as a 6-line copy in Bar/Line/Pie/Combo/Scatter — same Set + same
// toggle. Kept the same name on purpose so the move into a hook is a
// strict refactor (call sites unchanged: `const { hiddenSeries, toggleSeries } = useHiddenSeries()`).
//
// The hidden set is widget-local — switching pages or re-rendering on a
// data refresh resets it. That's intentional: a freshly-fetched binding
// shouldn't carry forward stale legend hides from a previous slice.
export function useHiddenSeries() {
  const [hiddenSeries, setHiddenSeries] = useState(new Set());
  const toggleSeries = useCallback((name) => {
    setHiddenSeries((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }, []);
  return { hiddenSeries, toggleSeries };
}
