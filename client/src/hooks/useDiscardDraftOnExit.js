import { useEffect, useRef } from 'react';
import api from '../utils/api';

// A report created from the "New report" dialog is a draft until its first
// save (server/utils/reportDrafts.js). Leaving its editor without having saved
// it deletes it — through a route that only ever deletes a draft, so a report
// saved meanwhile in another tab survives.
//
// Deferred by a tick and cancelled by a remount of the same report: React's
// StrictMode unmounts and remounts every component once in development, and
// that fake exit must not take the report the editor is about to show.
const pending = new Map();

export function useDiscardDraftOnExit(reportId) {
  const draftRef = useRef(false);
  useEffect(() => {
    if (!reportId) return undefined;
    clearTimeout(pending.get(reportId));
    pending.delete(reportId);
    return () => {
      if (!draftRef.current) return;
      pending.set(reportId, setTimeout(() => {
        pending.delete(reportId);
        api.delete(`/reports/${reportId}/draft`).catch(() => { /* already gone, or no longer a draft: nothing to undo */ });
      }, 0));
    };
  }, [reportId]);
  return {
    // What the server says of the report as loaded.
    markLoaded: (report) => { draftRef.current = !!report?.draft; },
    // A successful save made it a report.
    markSaved: () => { draftRef.current = false; },
  };
}
