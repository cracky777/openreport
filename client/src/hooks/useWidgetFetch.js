import { useEffect } from 'react';
import api from '../utils/api';
import { buildWidgetQueryPayload } from '../utils/widgetQueryPayload';
import { buildWidgetData } from '../utils/widgetDataBuilder';
import { computeBindingKey } from '../utils/bindingKey';
import { filterForTarget } from '../utils/crossFilter';
import { prepareGlobalRulesForWidget } from '../utils/reportFilterRules';

// The report editor's main widget-fetch orchestration effect. Extracted
// VERBATIM from pages/Editor.jsx (LOT 6.3) as a single effect — it is the core
// query loop (change-detection, drill / cross-filter / per-widget-refresh
// scoping, slicer cascade, 150ms debounce, per-widget commit, abort + loading
// cleanup). Called from Editor at the same point so its effect order is
// unchanged; every value/ref/callback it reads is passed in, so the closure and
// dependency array stay identical to the inline original.
export function useWidgetFetch({
  reportFilters, settings, refreshCounter, model, report, id, effectiveModel, setRefreshing, history, crossFilterSourceRef, prevRefreshCounter: prevRefreshCounterRef, refreshIsManualRef, skipNextRefetch: skipNextRefetchRef, prevFiltersJson: prevFiltersJsonRef, abortControllerRef, debounceTimerRef, drillingWidgetIdRef, interactionToggleTargetRef, widgetRefreshIdRef, prevSettingsFiltersRef, refreshSlicerRef, crossHighlightRef, pendingLoadingRef, activeQueryIdsRef,
}) {
  useEffect(() => {
    // Compare against report-level filters (from Settings) too — changing the
    // Settings filter list must trigger a refetch.
    const json = JSON.stringify({
      r: reportFilters || {},
      s: Array.isArray(settings?.reportFilters) ? settings.reportFilters : [],
    });
    const sourceId = crossFilterSourceRef.current;
    const refreshRequested = refreshCounter !== prevRefreshCounterRef.current;
    // `bypassCache` is for the Refresh button (force-fresh data), not
    // for drill-triggered refetches — those should still hit the pre-
    // agg cache. The drill flow bumps `refreshCounter` to nudge the
    // effect into running, but doesn't set `refreshIsManualRef`.
    const manualRefresh = refreshRequested && refreshIsManualRef.current;
    refreshIsManualRef.current = false;
    prevRefreshCounterRef.current = refreshCounter;
    // Skip refetch if we just restored filters from saved state — saved widget data already reflects them
    if (skipNextRefetchRef.current) {
      skipNextRefetchRef.current = false;
      prevFiltersJsonRef.current = json;
      return;
    }
    // Skip only if NOTHING changed: filters identical AND no fresh cross-filter click AND no refresh request
    if (json === prevFiltersJsonRef.current && sourceId === null && !refreshRequested) return;
    if (!model) return;
    prevFiltersJsonRef.current = json;

    // Abort previous in-flight requests
    if (abortControllerRef.current) abortControllerRef.current.abort();
    // Clear previous debounce
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);

    crossFilterSourceRef.current = null;
    const currentWidgets = history.state.widgets;
    // Drill-scoped refetch: when a refresh was triggered by a drill click on
    // a non-leaf level, only the drilling widget needs to refire — other
    // visuals shouldn't react to an intermediate drill step. Consume the ref
    // here so it doesn't leak into subsequent unrelated refreshes.
    const drillingId = drillingWidgetIdRef.current;
    drillingWidgetIdRef.current = null;
    // Same idea as drillingId but for the interaction-toggle path: only
    // the target whose None↔Filter setting just changed should refetch.
    const interactionId = interactionToggleTargetRef.current;
    interactionToggleTargetRef.current = null;
    // Same idea again for the per-widget Refresh button (🔄 on each visual).
    const widgetRefreshId = widgetRefreshIdRef.current;
    widgetRefreshIdRef.current = null;
    const scopedToId = drillingId || interactionId || widgetRefreshId;

    // Re-narrow related slicers (e.g. client → destinataire) using this
    // same proven, post-render trigger (committed `settings`, no stale
    // closure). CRITICAL SCOPE: fire ONLY when the global filter bar
    // actually changed, or on an explicit/global refresh — NEVER on a
    // cross-filter or drill-leaf click. refreshSlicer issues a heavy
    // bypassCache `DISTINCT` query per slicer; firing it on every chart
    // click floods the server and makes drilling feel uncached (the
    // regression). Cross-filter narrowing of a sibling slicer is not
    // worth that cost.
    const settingsFiltersKey = JSON.stringify(
      Array.isArray(settings?.reportFilters) ? settings.reportFilters : []
    );
    const globalFilterChanged = prevSettingsFiltersRef.current !== null
      && prevSettingsFiltersRef.current !== settingsFiltersKey;
    prevSettingsFiltersRef.current = settingsFiltersKey;
    // Detect that the rollup cache was rebuilt while the editor was
    // closed (workspace-card rebuild → user re-opens the report).
    // Filter widgets are skipped by the main fetch effect (line 930)
    // and refreshSlicer is only cascaded on manualRefresh or
    // globalFilterChanged — neither triggers on a fresh editor mount.
    // So a slicer with stale data.values (pre-rebuild) would stay
    // stuck until the user re-clicks 'rebuild cache & refresh' from
    // INSIDE the editor (which DOES loop refreshSlicer explicitly).
    // The fix: on every effect run, check whether any filter widget's
    // last-fetched-cache-stamp lags the current report's
    // cache_built_at. If yes, also cascade. The stamp is recorded by
    // refreshSlicer on every successful fetch, so subsequent renders
    // without a new rebuild see a match → no extra refresh.
    //
    const reportCacheBuiltAt = report?.cache_built_at || null;
    const slicersHaveStaleCache = !!reportCacheBuiltAt
      && Object.values(currentWidgets).some((w) =>
        w?.type === 'filter'
        && w.dataBinding?.selectedDimensions?.[0]
        && w.data?._fetchedCacheBuiltAt !== reportCacheBuiltAt);
    if (!scopedToId && (globalFilterChanged || manualRefresh || slicersHaveStaleCache)) {
      for (const [wId, w] of Object.entries(currentWidgets)) {
        if (w?.type === 'filter' && w.dataBinding?.selectedDimensions?.[0]) {
          refreshSlicerRef.current?.(wId);
        }
      }
    }

    const toFetch = Object.entries(currentWidgets).filter(([wId, w]) => {
      if (!w) return false;
      if (scopedToId && wId !== scopedToId) return false;
      // On explicit refresh, refetch ALL (including cross-filter source)
      if (!refreshRequested && wId === sourceId) return false;
      const b = w.dataBinding || {};
      const hasMeas = w.type === 'scatter' ? !!(b.scatterMeasures?.x && b.scatterMeasures?.y)
        : w.type === 'combo' ? (b.comboBarMeasures?.length > 0 || b.comboLineMeasures?.length > 0)
        : b.selectedMeasures?.length > 0;
      const hasMainBinding = (b.selectedDimensions?.length > 0 || hasMeas);
      // Conditional formatting — only counted as a reason to fetch when the toggle is on.
      const hasColorMeas = !!b.colorMeasure && w.config?.colorCondition?.enabled === true;
      if ((w.type === 'filter' || w.type === 'text') && !hasColorMeas) return false;
      if (!(hasMainBinding || hasColorMeas)) return false;
      // Per-widget cache: if this widget's effective filters (after the
      // interaction-exclusion stripping in filterForTarget) AND its
      // binding shape are unchanged from the last successful fetch,
      // there's nothing new to query — skip the refetch. Without this,
      // every reportFilters mutation re-fired SQL on every visual even
      // when the source's "interactions = None" meant nothing actually
      // changed for them.
      const baseFiltersForKey = { ...(reportFilters || {}) };
      const targetFiltersForKey = filterForTarget(wId, baseFiltersForKey, currentWidgets, crossHighlightRef.current);
      const widgetBindingKey = computeBindingKey({ widget: w, model, reportFilters: targetFiltersForKey, settings, cacheBuiltAt: report?.cache_built_at });
      if (!refreshRequested
          && wId !== scopedToId
          && w.data?._fetchedBinding === widgetBindingKey
          && Object.keys(w.data || {}).length > 1) {
        return false;
      }
      return true;
    });

    if (toFetch.length === 0) return;

    // Mark all target widgets as loading (silent — not an undoable action).
    // `_loadingKind` records WHY this fetch was triggered so the spinner
    // can colour the rotating arc accordingly: 'live' when the user asked
    // for a fresh bypassCache=true fetch (live source query), 'cache'
    // otherwise (planner / queryCache path). Set per-widget rather than
    // off the global `refreshKind` state so cross-filter / drill / binding
    // edits that happen AFTER a cache rebuild don't keep painting cyan —
    // they are normal-path fetches and should read as 'cache'.
    const loadingKindForThisFetch = manualRefresh ? 'live' : 'cache';
    history.setSilent((prev) => {
      const next = { ...prev, widgets: { ...prev.widgets } };
      toFetch.forEach(([wId]) => {
        if (next.widgets[wId]) next.widgets[wId] = { ...next.widgets[wId], _loading: true, _loadingKind: loadingKindForThisFetch };
      });
      return next;
    });
    // Remember which widgets we marked so the cleanup can revert if the
    // debounce gets cancelled before the fetch fires.
    pendingLoadingRef.current = toFetch.map(([wId]) => wId);

    // Debounce 150ms — if user clicks rapidly, only the last one fires
    debounceTimerRef.current = setTimeout(() => {
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const promises = toFetch.map(([wId, w]) => {
        // Build the query bodies + per-widget metadata in one shot.
        // Pure utility — Editor passes manualRefresh as bypassCache and
        // skips filter widgets entirely (they're already excluded from
        // `toFetch` upstream).
        const { meta, bodies } = buildWidgetQueryPayload(w, wId, {
          effectiveModel,
          reportFilters,
          currentWidgets,
          crossHighlight: crossHighlightRef.current,
          reportId: id,
          reportLevelFilters: prepareGlobalRulesForWidget(settings?.reportFilters, wId),
          reportExtras: {
            extraDimensions: settings?.extraDimensions || [],
            extraMeasures: settings?.extraMeasures || [],
            dimensionOverrides: settings?.dimensionOverrides || {},
            measureOverrides: settings?.measureOverrides || {},
          },
          bypassCache: manualRefresh,
          generateQueryId: () => (typeof crypto !== 'undefined' && crypto.randomUUID)
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random()}`,
          filterWidgetMode: 'skip',
          dedupMeasures: true,
        });

        if (meta.mainQueryId) activeQueryIdsRef.current.add(meta.mainQueryId);
        const mainPromise = bodies.main
          ? api.post(`/models/${model.id}/query`, bodies.main, { signal: controller.signal })
              .finally(() => { if (meta.mainQueryId) activeQueryIdsRef.current.delete(meta.mainQueryId); })
          : Promise.resolve({ data: { rows: [] } });

        const totalPromise = bodies.total
          ? api.post(`/models/${model.id}/query`, bodies.total, { signal: controller.signal }).catch(() => null)
          : Promise.resolve(null);

        // SQL viewer preview — fire-and-forget so the modal can show the
        // assembled query even while a slow main query is still running.
        // Skips silently if the main query already settled and stamped _sql.
        if (bodies.sqlOnly) {
          api.post(`/models/${model.id}/query`, bodies.sqlOnly, { signal: controller.signal })
            .then((r) => {
              const previewSql = r?.data?.sql;
              if (!previewSql) return;
              history.setSilent((prev) => {
                const w2 = prev.widgets?.[wId];
                if (!w2 || w2.data?._sql) return prev;
                return {
                  ...prev,
                  widgets: { ...prev.widgets, [wId]: { ...w2, data: { ...(w2.data || {}), _sql: previewSql } } },
                };
              });
            })
            .catch(() => { /* ignore — we'll just lack the preview */ });
        }

        const colorPromise = bodies.color
          ? api.post(`/models/${model.id}/query`, bodies.color, { signal: controller.signal }).catch(() => null)
          : Promise.resolve(null);

        const n1Promise = bodies.n1
          ? api.post(`/models/${model.id}/query`, bodies.n1, { signal: controller.signal }).catch(() => null)
          : Promise.resolve(null);

        const comboLinePromise = bodies.comboLine
          ? api.post(`/models/${model.id}/query`, bodies.comboLine, { signal: controller.signal }).catch(() => null)
          : Promise.resolve(null);

        return Promise.all([mainPromise, colorPromise, totalPromise, n1Promise, comboLinePromise]).then(([res, colorRes, totalRes, n1Res, comboLineRes]) => {
          const rows = res.data?.rows;
          // Combine both queries' SQL when an auxiliary line query was
          // fired so the SQL viewer shows every statement contributing to
          // the rendered chart.
          const mainSql = res.data?.sql || null;
          const lineSql = comboLineRes?.data?.sql || null;
          const sql = mainSql && lineSql
            ? `-- Main query (bars)\n${mainSql}\n\n-- Line aggregation (dim only, no groupBy)\n${lineSql}`
            : mainSql;
          // Per-widget cache key — stamped on widget.data so DataPanel
          // doesn't re-fetch on the next selection. Computed with the
          // per-widget targetFilters (post interaction-exclusion) so the
          // key matches the toFetch skip check.
          const bindingKey = computeBindingKey({
            widget: w, model, reportFilters: meta.targetFilters, settings, cacheBuiltAt: report?.cache_built_at,
          });
          const data = buildWidgetData({
            widget: w, rows, meta, effectiveModel,
            colorRes, totalRes, n1Res, comboLineRes,
            sql, bindingKey,
            // Keep every selected dim in `_rowDims` even when the same dim
            // is pinned as a column too — matches Viewer's behaviour. The
            // historical Editor filter (`dims.filter(d => !colDimsB...)`)
            // emptied the row list in that case, which made rows disappear
            // after a cache rebuild's refetch (saved widget data with the
            // old shape was overwritten with `_rowDims=[]`). User confirmed
            // the "rows visible on both axes" output is the desired one.
            pivotFilterRowDims: false,
          });
          return { wId, data };
        }).catch((err) => {
          if (err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED') return { wId, data: null };
          const msg = err?.response?.data?.error || err?.message || 'Query failed';
          const code = err?.response?.data?.code || null;
          const timeoutMs = err?.response?.data?.timeoutMs || null;
          return { wId, data: { _error: msg, _errorCode: code, _errorTimeoutMs: timeoutMs, _rowCount: 0 } };
        }).then(({ wId, data }) => {
          // Land each widget's data INDEPENDENTLY as soon as its own
          // query resolves — previously every widget was held back until
          // the slowest one in the batch settled (single `Promise.all`
          // → one final `setSilent`), so a 10 s outlier blocked an
          // otherwise 100 ms dashboard from rendering. Per-widget commit
          // means fast visuals paint immediately; the slow one fills in
          // when it's ready. React 18 batches the setSilent calls that
          // share a tick so a wave of fast widgets still resolves with a
          // single render.
          if (controller.signal.aborted) return { wId, data: null };
          history.setSilent((prev) => {
            if (!prev.widgets?.[wId]) return prev;
            return {
              ...prev,
              widgets: { ...prev.widgets, [wId]: { ...prev.widgets[wId], _loading: false, data: data || {} } },
            };
          });
          return { wId, data };
        });
      });

      // Outer await: just teardown the request-scoped flags once all
      // widgets have settled. Per-widget data already landed via the
      // per-promise commit above — no batched widget update here.
      Promise.all(promises).then(() => {
        pendingLoadingRef.current = null;
        if (controller.signal.aborted) { setRefreshing(false); return; }
        setRefreshing(false);
      });
    }, 150);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      // If we marked widgets as loading but the debounced fetch never fired,
      // revert those flags so the spinner doesn't stick. (Cleared once the
      // fetch actually starts so the in-flight Promise.all owns the cleanup.)
      const pending = pendingLoadingRef.current;
      if (pending && pending.length > 0) {
        pendingLoadingRef.current = null;
        history.setSilent((prev) => {
          const next = { ...prev, widgets: { ...prev.widgets } };
          for (const wId of pending) {
            if (next.widgets[wId]) next.widgets[wId] = { ...next.widgets[wId], _loading: false };
          }
          return next;
        });
      }
    };
    // `settings?.reportFilters` IS a dep: ReportFilterBar's plain "Save"
    // (commitSave) only calls onChange (setSettings) — NOT handleRefresh —
    // so without this dep a global-filter Save would refetch nothing
    // (charts AND slicers). The internal `json`/`prevFiltersJsonRef` guard
    // already keys on `s: settings.reportFilters`, so adding the dep does
    // NOT double-fire — it dedupes when nothing actually changed.
  }, [reportFilters, settings?.reportFilters, model, refreshCounter]); // eslint-disable-line react-hooks/exhaustive-deps
}
