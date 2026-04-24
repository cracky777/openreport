import { useRef, useMemo, useEffect } from 'react';

// Tracks the first-seen order of series names per widget instance.
// Returns a getStableIdx(name) function whose indices stay stable across filters.
// Pass a joined key for cheap dependency tracking.
export function useStableColorOrder(namesKey, names) {
  const orderRef = useRef([]);
  const merged = useMemo(() => {
    const out = [...orderRef.current];
    for (const n of names || []) {
      if (n != null && !out.includes(n)) out.push(n);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namesKey]);
  useEffect(() => { orderRef.current = merged; }, [merged]);
  const getStableIdx = (name) => {
    const idx = merged.indexOf(name);
    return idx >= 0 ? idx : 0;
  };
  return { getStableIdx, order: merged };
}
