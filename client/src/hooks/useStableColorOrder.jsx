import { useRef, useMemo, useEffect } from 'react';

// Returns a getStableIdx(name) whose indices stay stable across filters AND across mounts
// (editor vs viewer). Names are sorted alphabetically so the assignment is fully deterministic
// regardless of SQL row order, while new names accumulate at the end of the existing ref order
// so adding a value through filtering doesn't shift colors of already-seen values.
export function useStableColorOrder(namesKey, names) {
  const orderRef = useRef([]);
  const merged = useMemo(() => {
    // Start from previously seen order, then append any new names sorted alphabetically.
    // This makes the result identical across mounts when given the same input names.
    const seen = new Set(orderRef.current);
    const incoming = [...(names || [])]
      .filter((n) => n != null && !seen.has(n))
      .sort((a, b) => String(a).localeCompare(String(b)));
    return [...orderRef.current, ...incoming];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namesKey]);
  useEffect(() => { orderRef.current = merged; }, [merged]);
  const getStableIdx = (name) => {
    const idx = merged.indexOf(name);
    return idx >= 0 ? idx : 0;
  };
  return { getStableIdx, order: merged };
}
