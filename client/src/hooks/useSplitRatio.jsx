import { useEffect, useRef, useState } from 'react';

/**
 * Vertical splitter between two stacked flex sections (e.g. Measures /
 * Dimensions in the data panel). Returns { ratio, handleProps } — spread
 * `handleProps` on a thin divider row between the two sections and size them
 * with flex-grow `ratio` / `1 - ratio`.
 *
 * `getSpan` must return the combined current pixel height of the two
 * flexible sections, so a drag delta translates 1:1 into a ratio change
 * (using the whole panel would make the divider lag behind the cursor when
 * fixed-height blocks sit between the sections).
 *
 * Ratio is persisted in localStorage under `storageKey`; double-click
 * resets to `defaultRatio`.
 */
export function useSplitRatio({ storageKey, defaultRatio = 0.35, min = 0.15, max = 0.75, getSpan }) {
  const [ratio, setRatio] = useState(() => {
    if (typeof window === 'undefined') return defaultRatio;
    try {
      const stored = window.localStorage.getItem(storageKey);
      const n = stored ? parseFloat(stored) : NaN;
      if (!isNaN(n) && n >= min && n <= max) return n;
    } catch { /* ignore */ }
    return defaultRatio;
  });

  const draggingRef = useRef(false);
  const startRef = useRef({ y: 0, r: defaultRatio, span: 1 });
  const getSpanRef = useRef(getSpan);
  getSpanRef.current = getSpan;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try { window.localStorage.setItem(storageKey, String(ratio)); } catch { /* ignore */ }
  }, [ratio, storageKey]);

  useEffect(() => {
    const onMove = (e) => {
      if (!draggingRef.current) return;
      const delta = (e.clientY - startRef.current.y) / startRef.current.span;
      setRatio(Math.max(min, Math.min(max, startRef.current.r + delta)));
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [min, max]);

  const handleProps = {
    onMouseDown: (e) => {
      draggingRef.current = true;
      startRef.current = { y: e.clientY, r: ratio, span: Math.max(1, getSpanRef.current?.() || 1) };
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    },
    onDoubleClick: () => setRatio(defaultRatio),
    title: 'Drag to resize — double-click to reset',
  };

  return { ratio, handleProps };
}
