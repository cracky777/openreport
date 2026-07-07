import { useState, useEffect } from 'react';
import api from '../utils/api';

// Loads + tracks the currently-selected workspace's state (its reports, members,
// owner, the caller's role, and cloud-only visibility flags). In the "My Reports"
// view (selectedWs = null) it filters the personal-workspace reports locally;
// otherwise it fetches GET /workspaces/:id. Extracted verbatim from Dashboard.jsx
// (LOT 6.3 Phase 2). Returns the state plus the two setters Dashboard's mutation
// handlers (delete / share / member ops) still drive.
export function useWorkspaceData(selectedWs, reports, personalWorkspace) {
  const [wsReports, setWsReports] = useState([]);
  const [wsMembers, setWsMembers] = useState([]);
  const [wsOwner, setWsOwner] = useState(null);
  const [wsUserRole, setWsUserRole] = useState(null);
  // Cloud-only flag returned by GET /api/workspaces/:id when the workspace's
  // org is a Personal one. Lets us hide sharing controls. Undefined in OSS
  // (single-tenant) where every workspace is fair game.
  const [wsIsPersonalOrg, setWsIsPersonalOrg] = useState(false);
  // Cloud-only flag — true when the API exposed the members list (i.e. the
  // caller is ws_admin / org_admin). Hides the Members button for editors / viewers.
  const [wsCanSeeMembers, setWsCanSeeMembers] = useState(false);

  // My-Reports view: derive the visible list from the already-loaded `reports`
  // (e.g. delete) doesn't trigger a server re-fetch that could overwrite the
  // local optimistic update with stale data.
  useEffect(() => {
    if (selectedWs) return; // workspace view → handled by the next effect
    // "My Reports" view = reports living in the user's personal workspace.
    // Until that workspace id is loaded we fall back to the legacy NULL filter
    // so the UI stays usable on first paint and on older deployments.
    const personalId = personalWorkspace?.id;
    // Relocated verbatim from Dashboard: this path deliberately mirrors `reports`
    // into wsReports via an effect (the sibling workspace view fetches async, so
    // both feed one state) rather than deriving at render — behaviour preserved.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWsReports(reports.filter((r) => personalId
      ? r.workspace_id === personalId
      : !r.workspace_id));
    setWsMembers([]);
    setWsOwner(null);
    setWsUserRole(null);
    setWsIsPersonalOrg(false);
    setWsCanSeeMembers(false);
  }, [selectedWs, reports, personalWorkspace]);

  useEffect(() => {
    if (!selectedWs) return;
    api.get(`/workspaces/${selectedWs}`).then((res) => {
      setWsReports(res.data.reports || []);
      setWsMembers(res.data.members || []);
      setWsOwner(res.data.owner);
      setWsUserRole(res.data.userRole);
      setWsIsPersonalOrg(!!res.data.is_personal_org);
      // Cloud responses include can_see_members (true for ws_admin / org_admin).
      // OSS responses don't — fall back to "user is workspace admin" for OSS compat.
      setWsCanSeeMembers(
        res.data.can_see_members !== undefined
          ? !!res.data.can_see_members
          : res.data.userRole === 'admin'
      );
    }).catch(() => {});
  }, [selectedWs]);

  return {
    wsReports, wsMembers, wsOwner, wsUserRole, wsIsPersonalOrg, wsCanSeeMembers,
    setWsReports, setWsMembers,
  };
}
