import { useEffect, useState } from 'react';

// Subscribe to a CSS media query. SSR/jsdom-safe (no matchMedia → false).
export function useMediaQuery(query) {
  const get = () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(query).matches;
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

// Width below which the app chrome switches to its compact form: one full-width
// journey column instead of the peeking ribbon, icon-only navigation, stacked
// tables. Distinct from STACK_BREAKPOINT, which is about the report canvas —
// the two answer different questions and drift apart on tablets.
export const COMPACT_WIDTH = 768;

export function useIsCompact() {
  return useMediaQuery(`(max-width: ${COMPACT_WIDTH}px)`);
}
