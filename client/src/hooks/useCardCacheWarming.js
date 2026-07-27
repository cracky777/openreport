import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../utils/api';

// Per-report-card cache warming + size stats for the Dashboard. Extracted
// verbatim from pages/Dashboard.jsx (LOT 6.3) as ONE unit — the /warming poll
// loop, the local pending guard, the trickle animation and the size-stats
// fetch are tightly interlocked (the trickle reads poll state via refs, the
// poll reconciles the pending set), so the whole machine moves together. The
// only input is the current workspace's report list; it returns the state the
// report cards render plus the card-refresh handler.
export function useCardCacheWarming(wsReports) {
  // Per-report-card warm state. `cardWarmingIds` is the set of reports
  // whose Refresh button is currently spinning; `cardCacheStats` is the
  // last known size for each report (entries + bytes), shown under the
  // button. We hydrate stats lazily — only for reports the user has
  // refreshed at least once, to avoid flooding the API on report list
  // load.
  const [cardWarmingIds, setCardWarmingIds] = useState(() => new Set());
  // reportId → { done, total } while a refresh is building, so the card
  // shows a real "N of M rollups" bar (indeterminate until the first
  // poll returns counts).
  const [cardWarmingProgress, setCardWarmingProgress] = useState({});
  // reportIds of refreshes started from THIS tab whose run-now POST
  // hasn't resolved yet. Keeps the /warming poll loop (and the progress
  // bar) alive across the brief window between the POST and the server
  // registering the model in its building set, so the bar doesn't flicker
  // off then never come back.
  const pendingWarmIdsRef = useRef(new Set());
  // The /warming poll loop is a ref-guarded singleton: at most one is
  // ever scheduled, and it can be (re)started on demand.
  const warmingPollActiveRef = useRef(false);
  const warmingPollCancelledRef = useRef(false);
  const warmingPollTimerRef = useRef(null);
  // Smoothly-animated bar percentage (reportId → %). The server only
  // reports progress in coarse steps (done/total, e.g. 1 of 4), so a
  // raw width would sit frozen for seconds between rollups. We trickle
  // the displayed % toward the next milestone with an ease-out creep
  // (NProgress-style) so the bar is always visibly moving, and snap it
  // up when a real rollup actually completes. Mirrors of the poll state
  // are kept in refs so the trickle interval reads the latest without
  // restarting every poll tick.
  const [cardWarmingDisplayPct, setCardWarmingDisplayPct] = useState({});
  const displayPctRef = useRef({});
  const warmingProgressRef = useRef({});
  const warmingIdsRef = useRef(new Set());
  const [cardCacheStats, setCardCacheStats] = useState({});
  const fetchCardCacheStats = useCallback(async (reportId) => {
    try {
      const res = await api.get(`/cache-schedules/size/${reportId}`);
      setCardCacheStats((p) => ({ ...p, [reportId]: res.data }));
    } catch { /* size fetch is best-effort */ }
  }, []);
  // Poll /warming, reconcile the spinner set + progress bar, and re-arm
  // itself every 2 s while the server is building OR a local refresh is
  // still pending. The pending guard covers the POST→build startup race
  // (the model isn't in the server's building set for the first tick or
  // two after the POST). Self-stops when both are idle. Idempotent: a
  // second caller while a loop is live is a no-op (the running loop
  // already picks up new ids on its next tick).
  const startWarmingPoll = useCallback(() => {
    if (warmingPollActiveRef.current) return;
    warmingPollActiveRef.current = true;
    const poll = async () => {
      try {
        const res = await api.get('/cache-schedules/warming');
        if (warmingPollCancelledRef.current) { warmingPollActiveRef.current = false; return; }
        const serverIds = new Set(res.data?.reportIds || []);
        setCardWarmingProgress(res.data?.progress || {});
        const pending = pendingWarmIdsRef.current;
        // Effective spinner set = server's building set ∪ locally-pending
        // refreshes. For any report we WERE showing that is now neither
        // building nor pending, the warm finished → refresh its size line
        // without the user clicking Refresh again.
        setCardWarmingIds((prev) => {
          for (const id of prev) {
            if (!serverIds.has(id) && !pending.has(id)) {
              fetchCardCacheStats(id).catch(() => {});
            }
          }
          return new Set([...serverIds, ...pending]);
        });
        if (serverIds.size > 0 || pending.size > 0) {
          warmingPollTimerRef.current = setTimeout(poll, 2000);
        } else {
          warmingPollActiveRef.current = false;
        }
      } catch {
        // Don't loop on error — the user might just be logged out.
        warmingPollActiveRef.current = false;
      }
    };
    poll();
  }, [fetchCardCacheStats]);
  const refreshReportCacheFromCard = useCallback(async (report) => {
    if (cardWarmingIds.has(report.id)) return;
    setCardWarmingIds((p) => { const n = new Set(p); n.add(report.id); return n; });
    // Hold the report in the local pending set and (re)start the poll
    // loop so the determinate "done / total" bar actually updates as the
    // server builds each rollup. Without this, a card-initiated refresh
    // never restarts the loop that stopped at mount → the bar stays in
    // its non-growing indeterminate sweep for the whole build.
    pendingWarmIdsRef.current.add(report.id);
    startWarmingPoll();
    try {
      // The server tracks the in-flight warm in its own Set, so even if
      // this tab navigates / reloads mid-warm the next mount picks it up
      // via /warming and the spinner stays on. We still await to refresh
      // the size line on success; a navigation interruption is non-fatal.
      await api.post(`/cache-schedules/run-now/${report.id}`);
      await fetchCardCacheStats(report.id);
      setCardWarmingIds((p) => { const n = new Set(p); n.delete(report.id); return n; });
    } catch (err) {
      setCardWarmingIds((p) => { const n = new Set(p); n.delete(report.id); return n; });
      alert(err.response?.data?.error || 'Failed to refresh');
    } finally {
      // POST resolved = build finished server-side (the route awaits the
      // whole build). Drop the local guard; the next poll tick sees the
      // server's now-cleared building set and reconciles.
      pendingWarmIdsRef.current.delete(report.id);
    }
  }, [cardWarmingIds, fetchCardCacheStats, startWarmingPoll]);

  // Auto-fetch cache size for every visible report when the workspace's
  // report list changes. This is what makes the "Cache: X entries · Y MB"
  // line persist across F5 / workspace switches — the data lives on the
  // server, we just re-pull it on mount. Skipped for reports we already
  // have stats for, so a click-Refresh-then-this-effect doesn't double-
  // fetch.
  useEffect(() => {
    if (!Array.isArray(wsReports) || wsReports.length === 0) return;
    const missing = wsReports.filter((r) => !cardCacheStats[r.id]);
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      // Parallel one-shot — small payloads, the server already has them
      // in memory so each call is sub-millisecond. With ~30 cards on a
      // big workspace this is still well under the visual threshold.
      const results = await Promise.all(missing.map(async (r) => {
        try {
          const res = await api.get(`/cache-schedules/size/${r.id}`);
          return [r.id, res.data];
        } catch { return null; }
      }));
      if (cancelled) return;
      setCardCacheStats((prev) => {
        const next = { ...prev };
        for (const entry of results) {
          if (entry) next[entry[0]] = entry[1];
        }
        return next;
      });
    })();
    return () => { cancelled = true; };
    // We intentionally depend on the array IDENTITY (not contents) so a
    // simple state update (setReports([...same])) doesn't re-fetch every
    // card; the workspace selector already replaces wsReports with a
    // fresh array when it actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsReports]);

  // Kick the /warming poll loop on every Dashboard mount so an in-flight
  // warm (started in another tab or before an F5) keeps its spinner +
  // progress bar. The loop self-stops when idle; refreshReportCacheFromCard
  // restarts it for a card-initiated refresh. Cancel on unmount.
  useEffect(() => {
    warmingPollCancelledRef.current = false;
    startWarmingPoll();
    return () => {
      warmingPollCancelledRef.current = true;
      if (warmingPollTimerRef.current) clearTimeout(warmingPollTimerRef.current);
      warmingPollActiveRef.current = false;
    };
    // Intentional: run once on each Dashboard mount, including after F5.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Mirror the poll state into refs so the trickle interval below reads
  // the latest values without being torn down/recreated every 2 s poll.
  useEffect(() => { warmingProgressRef.current = cardWarmingProgress; }, [cardWarmingProgress]);
  useEffect(() => { warmingIdsRef.current = cardWarmingIds; }, [cardWarmingIds]);
  // Trickle driver: while anything is warming, ease the displayed bar %
  // toward the next milestone every 450 ms (the CSS `width 0.4s` on
  // .rollup-progress > span interpolates between ticks, so the bar
  // glides continuously instead of sitting frozen between rollups). The
  // % snaps up the instant a real rollup completes (floor jumps), so it
  // tracks reality while always being visibly in motion.
  const anyWarming = cardWarmingIds.size > 0;
  useEffect(() => {
    if (!anyWarming) {
      if (Object.keys(displayPctRef.current).length) {
        displayPctRef.current = {};
        setCardWarmingDisplayPct({});
      }
      return;
    }
    const tick = () => {
      const ids = warmingIdsRef.current;
      const prog = warmingProgressRef.current;
      const cur = displayPctRef.current;
      const next = {};
      let changed = false;
      for (const id of ids) {
        const p = prog[id];
        const total = p && p.total > 0 ? p.total : 0;
        const done = p && p.done > 0 ? p.done : 0;
        let floor, ceil;
        if (total > 0) {
          floor = Math.min(100, (done / total) * 100);
          ceil = Math.min(100, ((done + 1) / total) * 100);
        } else {
          floor = 0; ceil = 12; // unknown total (first ≤2 s): gentle early creep
        }
        let v = cur[id] ?? 0;
        if (v < floor) v = floor;                 // snap up when a rollup really finishes
        const cap = floor + (ceil - floor) * 0.9; // never quite reach the next step
        if (v < cap) v += Math.max(0.5, (cap - v) * 0.12); // ease-out creep, min step
        if (v > cap) v = cap;
        if (v > 100) v = 100;
        next[id] = v;
        if (v !== cur[id]) changed = true;
      }
      displayPctRef.current = next; // rebuilt from live ids → finished reports drop out
      if (changed) setCardWarmingDisplayPct(next);
    };
    tick();
    const h = setInterval(tick, 450);
    return () => clearInterval(h);
  }, [anyWarming]);

  return {
    cardWarmingIds,
    cardWarmingProgress,
    cardWarmingDisplayPct,
    cardCacheStats,
    fetchCardCacheStats,
    refreshReportCacheFromCard,
  };
}
