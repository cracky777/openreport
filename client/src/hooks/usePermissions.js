import { useState, useEffect } from 'react';
import api from '../utils/api';

// Cloud-aware permission state for the Dashboard. Falls back to the OSS-style
// user.role check when /api/cloud/orgs/active/current returns nothing (OSS or
// pre-cloud user). Extracted verbatim from Dashboard.jsx (LOT 6.3 Phase 2).
//
// Inputs: the currently-selected workspace id, the auth user, and the user's
// role within that workspace. Returns the org role, platform-admin flag, and
// the derived write-capability booleans the page uses to gate its actions.
export function usePermissions(selectedWs, user, wsUserRole) {
  const [activeOrgRole, setActiveOrgRole] = useState(null); // 'admin' | 'editor' | 'viewer' | null
  useEffect(() => {
    api.get('/cloud/orgs/active/current')
      .then((res) => setActiveOrgRole(res.data.role || null))
      .catch(() => setActiveOrgRole(null));
  }, [selectedWs]); // refetch when org context might have shifted

  // Cloud-only — am I a platform admin? Used to surface the Platform link
  // in the top nav. The endpoint 404s in OSS so isPlatformAdmin stays false
  // and the button doesn't render.
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  useEffect(() => {
    let cancelled = false;
    api.get('/cloud/platform/me')
      .then((res) => { if (!cancelled) setIsPlatformAdmin(!!res.data.isPlatformAdmin); })
      .catch(() => { /* not cloud or not platform admin — silently no-op */ });
    return () => { cancelled = true; };
  }, []);

  // Org-level write capability: needed to create workspaces, manage datasources/models.
  // In OSS (no cloud) we fall back to the legacy user.role check.
  const canEditOrg = activeOrgRole
    ? (activeOrgRole === 'admin' || activeOrgRole === 'editor')
    : (user?.role !== 'viewer');

  // Capability inside the currently-selected context. For workspace views: ws_admin/editor
  // OR org_admin override. For "My Reports" (no workspace): same as canEditOrg.
  const canEditCurrent = selectedWs
    ? (wsUserRole === 'admin' || wsUserRole === 'editor' || activeOrgRole === 'admin')
    : canEditOrg;

  // Backwards-compat alias used by OSS code paths still expecting `canEdit`.
  const canEdit = canEditCurrent;

  return { activeOrgRole, isPlatformAdmin, canEditOrg, canEditCurrent, canEdit };
}
