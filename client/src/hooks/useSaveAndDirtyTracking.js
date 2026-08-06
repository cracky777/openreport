import { useState, useEffect, useCallback } from 'react';
import { useBlocker } from 'react-router-dom';
import api from '../utils/api';
import { buildSnapshot } from '../utils/editorHelpers';

// Persistence + unsaved-changes protection for the report editor. Extracted
// verbatim from pages/Editor.jsx (LOT 6.3). Owns the save-in-flight flags and
// the React-Router navigation blocker; everything it reads (the page/layout/
// widget state, the shared snapshot + per-page data refs, the toast setter) is
// passed in so the closures + dependency arrays stay identical to the inline
// original. `saveMsg` itself stays in Editor (the cache-rebuild path also
// writes it) — only `setSaveMsg` is threaded in.
export function useSaveAndDirtyTracking({
  id,
  pages,
  currentPageIdx,
  pagesDataRef,
  layout,
  widgets,
  title,
  settings,
  savedSnapshotRef,
  setSaveMsg,
  setTitle,
}) {
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      // Save current page state first
      const curPage = pages[currentPageIdx];
      pagesDataRef.current[curPage.id] = { layout, widgets };

      // Bound the save payload: a high-cardinality slicer's `data.values`
      // can balloon to MBs (limit: 1_000_000 on slicer queries). Cap it to
      // 1000 entries here — FilterWidget windows at 200 with a "Show more"
      // button anyway, so anything beyond that is unreachable from the UI.
      // Other widget data (labels/rows/series) is already bounded by the
      // per-widget `dataLimit` (default 1000) at query time, no need to
      // touch it. Everything else (including `_*` cache fields) is left
      // intact so reload still renders immediately.
      const SLICER_VALUE_CAP = 1000;
      const stripWidget = (w) => {
        if (!w || typeof w !== 'object') return w;
        if (
          w.data
          && typeof w.data === 'object'
          && !Array.isArray(w.data)
          && Array.isArray(w.data.values)
          && w.data.values.length > SLICER_VALUE_CAP
        ) {
          return {
            ...w,
            data: { ...w.data, values: w.data.values.slice(0, SLICER_VALUE_CAP) },
          };
        }
        return w;
      };
      const stripWidgets = (ws) => {
        const out = {};
        for (const [wId, w] of Object.entries(ws || {})) out[wId] = stripWidget(w);
        return out;
      };

      // Build pages array for save — slicer selections already live in widget.config.selectedValues
      const pagesForSave = pages.map((p) => ({
        id: p.id,
        name: p.name,
        layout: pagesDataRef.current[p.id]?.layout || [],
        widgets: stripWidgets(pagesDataRef.current[p.id]?.widgets || {}),
      }));

      // Also save layout/widgets at root for backward compat (first page)
      await api.put(`/reports/${id}`, {
        title, settings,
        layout: pagesForSave[0]?.layout || [],
        widgets: pagesForSave[0]?.widgets || {},
        pages: pagesForSave,
      });
      savedSnapshotRef.current = buildSnapshot(title, settings, pagesForSave);
      setSaveMsg('Saved');
      setTimeout(() => setSaveMsg(null), 2000);
    } catch (err) {
      console.error('Save failed:', err);
      // A 409 means the title clashes with another report in the workspace.
      // Revert the name to the last saved one (the rest of the edits stay so
      // the user can re-save) and surface the server's explicit reason.
      if (err?.response?.status === 409 && typeof setTitle === 'function') {
        try { setTitle(JSON.parse(savedSnapshotRef.current)?.title || ''); } catch { /* keep current title */ }
      }
      setSaveMsg(err?.response?.data?.error || 'Save failed');
      setTimeout(() => setSaveMsg(null), 4000);
    } finally {
      setSaving(false);
    }
  };

  // Unsaved-changes guard. Same comparison the toolbar already uses to
  // grey out the Save button — current snapshot vs. last-saved snapshot
  // — but lifted to the component scope so both the browser-close
  // (beforeunload) and the in-app navigation (useBlocker) paths can
  // reuse it. Snapshot serialises title + settings + every page's
  // layout/widgets, so any meaningful edit shows up as dirty.
  const isReportDirty = useCallback(() => {
    const curPage = pages[currentPageIdx];
    const pagesData = { ...pagesDataRef.current };
    if (curPage) pagesData[curPage.id] = { layout, widgets };
    const pagesForSnapshot = pages.map((p) => ({
      id: p.id, name: p.name,
      layout: pagesData[p.id]?.layout || [],
      widgets: pagesData[p.id]?.widgets || {},
    }));
    return buildSnapshot(title, settings, pagesForSnapshot) !== savedSnapshotRef.current;
  }, [pages, currentPageIdx, layout, widgets, title, settings]); // eslint-disable-line react-hooks/exhaustive-deps

  // F5 / close tab / close window — browsers force their own native
  // confirmation (we can't customise the wording or add a Save button;
  // any non-empty returnValue triggers it). `beforeunload` only fires
  // when the page is about to unload, so a stale handler isn't an issue.
  useEffect(() => {
    const handler = (e) => {
      if (!isReportDirty()) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isReportDirty]);

  // In-app navigation (clicking the workspace logo, a Dashboard link,
  // another report card from the toolbar's report picker, …). React
  // Router v7's `useBlocker` intercepts the transition; we render a
  // custom modal with Save / Discard / Cancel below. Only blocks when
  // the destination pathname actually changes — staying on the same
  // editor (filter pane toggles, page swaps via search params, …)
  // shouldn't trigger the prompt.
  const navBlocker = useBlocker(({ currentLocation, nextLocation }) => {
    const dirty = isReportDirty();
    const pathChanged = currentLocation.pathname !== nextLocation.pathname;
    return dirty && pathChanged;
  });
  const [savingFromBlocker, setSavingFromBlocker] = useState(false);
  const confirmSaveAndLeave = async () => {
    setSavingFromBlocker(true);
    try {
      await handleSave();
    } finally {
      setSavingFromBlocker(false);
      navBlocker.proceed?.();
    }
  };
  const confirmDiscardAndLeave = () => navBlocker.proceed?.();
  const cancelLeave = () => navBlocker.reset?.();

  return {
    saving,
    handleSave,
    isReportDirty,
    navBlocker,
    savingFromBlocker,
    confirmSaveAndLeave,
    confirmDiscardAndLeave,
    cancelLeave,
  };
}
