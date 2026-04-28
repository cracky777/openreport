import { useEffect, useRef, useState } from 'react';

/**
 * Lets a panel be resized by dragging a handle on its left edge.
 * Returns { width, handleProps } — spread `handleProps` on a thin div positioned at the left edge.
 *
 * Width is persisted in localStorage under `storageKey`.
 */
export function useResizableWidth({ storageKey, defaultWidth, min = 180, max = 600, onDragStart, onDragEnd }) {
  const [width, setWidth] = useState(() => {
    if (typeof window === 'undefined') return defaultWidth;
    try {
      const stored = window.localStorage.getItem(storageKey);
      const n = stored ? parseInt(stored, 10) : NaN;
      if (!isNaN(n) && n >= min && n <= max) return n;
    } catch { /* ignore */ }
    return defaultWidth;
  });

  const draggingRef = useRef(false);
  const startRef = useRef({ x: 0, w: 0 });
  const onDragEndRef = useRef(onDragEnd);
  onDragEndRef.current = onDragEnd;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try { window.localStorage.setItem(storageKey, String(width)); } catch { /* ignore */ }
  }, [width, storageKey]);

  useEffect(() => {
    const onMove = (e) => {
      if (!draggingRef.current) return;
      const delta = startRef.current.x - e.clientX; // dragging LEFT widens (panel is on the right edge)
      const next = Math.max(min, Math.min(max, startRef.current.w + delta));
      setWidth(next);
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      onDragEndRef.current?.();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [min, max]);

  const startDrag = (e) => {
    draggingRef.current = true;
    startRef.current = { x: e.clientX, w: width };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
    onDragStart?.();
  };

  const handleProps = {
    onMouseDown: startDrag,
    style: {
      position: 'absolute', top: 0, left: -3, bottom: 0, width: 6,
      cursor: 'col-resize', zIndex: 5,
      // Subtle hover hint
      background: 'transparent',
    },
    onMouseEnter: (e) => { e.currentTarget.style.background = 'var(--accent-primary-soft)'; },
    onMouseLeave: (e) => { e.currentTarget.style.background = 'transparent'; },
    title: 'Drag to resize',
  };

  return { width, handleProps };
}
