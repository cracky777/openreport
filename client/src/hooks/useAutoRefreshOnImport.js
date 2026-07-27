import { useEffect, useRef } from 'react';

// One-shot post-import auto-refresh + auto-save for the report editor.
// Extracted verbatim from pages/Editor.jsx (LOT 6.3). A freshly-imported
// report arrives with its widgets stripped of result rows (so the bundle
// stays portable), so this fires the "Refresh live query" action once, then
// persists the fetched data once the refresh settles — after which normal F5
// no longer re-triggers it. Owns its three one-shot gate refs; `handleRefresh`
// and `handleSave` are passed in (they're defined lower in Editor, so the hook
// is called from there rather than up top).
export function useAutoRefreshOnImport({ id, model, history, refreshing, handleRefresh, handleSave }) {
  const initialRefreshFiredRef = useRef(false);
  const postImportAutoSavePendingRef = useRef(false);
  const prevRefreshingRef = useRef(false);

  // Auto-fire the "Refresh live query" toolbar action once per browser
  // tab session for a report whose widgets arrive without data — typical
  // for a freshly-imported report (the importer strips per-widget result
  // rows so the bundle stays portable across accounts). We detect this
  // by looking for any data-binding widget missing its `_fetchedBinding`
  // marker.
  //
  // The `_fetchedBinding` marker lives only in `history.state` (memory),
  // never persisted to the server — so without the sessionStorage gate,
  // F5 on an imported-but-unsaved report would trigger the auto-refresh
  // every reload (the server keeps returning the stripped widgets the
  // import wrote). sessionStorage scopes the one-shot to a single tab
  // session, surviving F5 and intra-tab navigation. Reopening the report
  // in a new tab re-fires once there, which is the correct behaviour:
  // a new tab can't see the previous tab's in-memory fetched state.
  useEffect(() => {
    if (initialRefreshFiredRef.current) return;
    if (!model?.id || !id) return;
    const key = `openreport.autoRefreshed.${id}`;
    let alreadyAutoRefreshed = false;
    try { alreadyAutoRefreshed = sessionStorage.getItem(key) === '1'; } catch { /* sessionStorage blocked (private mode) — treat as not-yet-refreshed */ }
    if (alreadyAutoRefreshed) {
      initialRefreshFiredRef.current = true;
      return;
    }
    const wids = history.state.widgets || {};
    const anyUnfetched = Object.values(wids).some((w) => {
      if (!w || w.type === 'filter' || w.type === 'text'
          || w.type === 'image' || w.type === 'shape') return false;
      const b = w.dataBinding || {};
      const hasMeas = w.type === 'scatter' ? !!(b.scatterMeasures?.x && b.scatterMeasures?.y)
        : w.type === 'combo' ? (b.comboBarMeasures?.length > 0 || b.comboLineMeasures?.length > 0)
        : b.selectedMeasures?.length > 0;
      const hasBinding = b.selectedDimensions?.length > 0 || hasMeas;
      return hasBinding && !w.data?._fetchedBinding;
    });
    if (!anyUnfetched) return;
    initialRefreshFiredRef.current = true;
    try { sessionStorage.setItem(key, '1'); } catch { /* sessionStorage blocked — the one-shot just won't persist across F5 */ }
    // Arm the one-shot auto-save: when THIS refresh finishes (refreshing
    // flips back to false), persist the fetched widget data so subsequent
    // F5s don't re-trigger the auto-refresh path and the user doesn't
    // need to remember to click Save. Cleared as soon as it fires —
    // later manual refreshes won't auto-save.
    postImportAutoSavePendingRef.current = true;
    // Defer to the next macrotask so the rest of the mount-time state
    // (setReportFilters from the widgets→filters sync effect, settings
    // load, etc.) has committed first. Without this, handleRefresh
    // bumps refreshCounter mid-mount and the main fetch effect's
    // setTimeout(150ms) gets repeatedly cleared by the cleanup running
    // on each subsequent state-driven re-render — the actual fetches
    // only fire once the cascade settles, which can take seconds. The
    // toolbar-button path doesn't see this because it's clicked from a
    // stable state.
    setTimeout(() => handleRefresh(), 0);
  }, [id, model?.id, history.state.widgets, handleRefresh]);

  // One-shot auto-save after the post-import refresh settles. Watches
  // `refreshing` for a true→false edge and, if the post-import flag is
  // armed, calls handleSave once and clears the flag. Any subsequent
  // manual refresh leaves `postImportAutoSavePendingRef` false, so it's
  // a no-op for normal refreshes.
  useEffect(() => {
    const wasRefreshing = prevRefreshingRef.current;
    prevRefreshingRef.current = refreshing;
    if (wasRefreshing && !refreshing && postImportAutoSavePendingRef.current) {
      postImportAutoSavePendingRef.current = false;
      handleSave();
    }
  }, [refreshing]); // eslint-disable-line react-hooks/exhaustive-deps
}
