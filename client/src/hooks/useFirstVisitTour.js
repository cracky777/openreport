import { useCallback, useEffect, useState } from 'react';

// A tour (components/Tour) that plays each time `ready` turns true — arriving on
// the page, a moment after, once the parts it points at are laid out — until
// the user ticks "Don't show this tutorial again" (remembered per user).
// `key` names the tour ('home', 'editor', 'model'); `start` replays it on demand.
export function useFirstVisitTour(key, userId, ready) {
  const offKey = userId ? `openreport.${key}TourOff.${userId}` : null;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!ready || !offKey) return undefined;
    let off = true;
    try { off = localStorage.getItem(offKey) === '1'; } catch { /* storage blocked: no tour rather than one every time */ }
    if (off) return undefined;
    const t = setTimeout(() => setOpen(true), 600);
    return () => clearTimeout(t);
  }, [ready, offKey]);

  const close = useCallback(({ dontShowAgain } = {}) => {
    setOpen(false);
    try { if (dontShowAgain && offKey) localStorage.setItem(offKey, '1'); } catch { /* storage blocked: shown again next time */ }
  }, [offKey]);
  const start = useCallback(() => setOpen(true), []);

  return { open, start, close };
}
