import { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../utils/api';
import { useAuth } from './useAuth';
import { GraphContext } from './graphContext';
import { groupByParent } from '../utils/groupByParent';
import { scopeResources, roleInWorkspace } from '../utils/workspaceScope';

// The Sources → Models → Reports graph, loaded once for the whole journey.
//
// Each stage used to fetch its own slice on mount, which meant a column arrived
// empty and had to fill in while the carousel was still sliding. Holding the
// three lists in the shell lets a stage render populated the moment it enters,
// and it is also what lets one stage answer questions about another — how many
// models a datasource feeds, which datasources a workspace's reports reach.
//
// The setters are exposed because the stages apply optimistic updates (renaming
// a workspace's report, toggling sharing, deleting a row) and must not have to
// round-trip through a refetch to reflect them.
export function GraphProvider({ children }) {
  // Sits above the router so it survives moving between stages — mounted inside
  // the shell it would be torn down and refetched on every step change, which
  // is exactly the empty-column problem it exists to avoid.
  const { user } = useAuth();
  const [datasources, setDatasources] = useState([]);
  const [models, setModels] = useState([]);
  const [reports, setReports] = useState([]);
  const [workspaces, setWorkspaces] = useState([]);
  // The user's personal workspace (auto-created at signup). Stays out of the
  // workspaces list — it backs the "My Reports" view.
  const [personalWorkspace, setPersonalWorkspace] = useState(null);
  // Workspaces the global admin manages without holding a role in them —
  // openable, listed apart in the picker. Empty for everyone else.
  const [otherWorkspaces, setOtherWorkspaces] = useState([]);
  const [loading, setLoading] = useState(true);

  // The active workspace is a context that spans the whole journey, not a
  // property of the Reports stage — the header picker sets it and every stage
  // reads it. Remembered per user across reloads.
  const lastWsKey = user?.id ? `openreport.lastWorkspace.${user.id}` : null;
  const [selectedWs, setSelectedWs] = useState(null);
  useEffect(() => {
    if (!lastWsKey) return;
    try {
      const stored = window.localStorage.getItem(lastWsKey);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (stored && stored !== 'null') setSelectedWs(stored);
    } catch { /* private mode / storage disabled — start on My Reports */ }
  }, [lastWsKey]);
  useEffect(() => {
    if (!lastWsKey) return;
    try { window.localStorage.setItem(lastWsKey, selectedWs || 'null'); } catch { /* see above */ }
  }, [lastWsKey, selectedWs]);

  // A workspace that no longer exists (deleted, access revoked) must not leave
  // the picker pointing at nothing.
  useEffect(() => {
    if (!selectedWs || (!workspaces.length && !otherWorkspaces.length)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!workspaces.some((w) => w.id === selectedWs) && !otherWorkspaces.some((w) => w.id === selectedWs)) setSelectedWs(null);
  }, [selectedWs, workspaces, otherWorkspaces]);

  const refresh = useCallback(async () => {
    // Each list degrades on its own: a datasource the user can't read must not
    // blank out the reports column.
    const [dsRes, mRes, rRes, wsRes] = await Promise.all([
      api.get('/datasources').catch(() => ({ data: { datasources: [] } })),
      api.get('/models').catch(() => ({ data: { models: [] } })),
      api.get('/reports').catch(() => ({ data: { reports: [] } })),
      api.get('/workspaces').catch(() => ({ data: { workspaces: [] } })),
    ]);
    setDatasources(dsRes.data.datasources || []);
    setModels(mRes.data.models || []);
    setReports(rRes.data.reports || []);
    setWorkspaces(wsRes.data.workspaces || []);
    setPersonalWorkspace(wsRes.data.personalWorkspace || null);
    setOtherWorkspaces(wsRes.data.otherWorkspaces || []);
    setLoading(false);
  }, []);

  // Only once signed in: these endpoints 401 otherwise, and the public report
  // viewer renders under this provider too.
  // The rule fires because `refresh` sets state, but it only does so after
  // awaiting the three requests — never synchronously during the effect.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (user) refresh(); }, [user, refresh]);

  // Everything below is scoped to the active workspace. Reports are the
  // workspace's own; sources and models are those that LIVE there or are
  // shared into it (utils/workspaceScope.js, the server's rule) — what is
  // outside is not on screen, so a new workspace starts empty.
  //
  // The counts on the join lines have to use the same scope as the column they
  // point at, otherwise a model advertises "3 reports" while the Reports stage
  // — which only lists the workspace's own — shows one.
  const scopedReports = useMemo(
    () => (selectedWs ? reports.filter((r) => r.workspace_id === selectedWs) : reports),
    [reports, selectedWs]
  );

  const scoped = useMemo(() => scopeResources({
    datasources, models, selectedWs, personalWorkspaceId: personalWorkspace?.id,
  }), [datasources, models, selectedWs, personalWorkspace]);
  const scopedModels = scoped.models;
  const scopedDatasources = scoped.datasources;
  // The workspace new sources and models are created in.
  const currentWsKey = scoped.wsKey;
  const isGlobalAdmin = user?.role === 'admin';
  const currentWsRole = useMemo(
    () => roleInWorkspace({ selectedWs, workspaces, otherWorkspaces, isGlobalAdmin }),
    [selectedWs, workspaces, otherWorkspaces, isGlobalAdmin],
  );

  // The order of the three columns, decided here rather than in each stage —
  // an order is only worth anything if all three agree on it, and a column
  // cannot see the ones next to it. Sources lead; models sit in their source's
  // block, so the join lines never cross.
  const orderedDatasources = scopedDatasources;
  const orderedModels = useMemo(
    () => groupByParent(scopedModels, orderedDatasources.map((d) => d.id), 'datasource_id'),
    [scopedModels, orderedDatasources],
  );
  // Reports are listed per workspace by the stage itself, so what it needs from
  // here is the order to line up with, not the rows.
  const modelOrder = useMemo(() => orderedModels.map((m) => m.id), [orderedModels]);

  // Unscoped tallies: deletion is refused server-side as soon as *any* child
  // exists, whatever workspace it belongs to, so the guard must count them all.
  const modelsByDatasourceAll = useMemo(() => countBy(models, 'datasource_id'), [models]);
  const reportsByModelAll = useMemo(() => countBy(reports, 'model_id'), [reports]);


  const value = useMemo(() => ({
    datasources, models, reports, workspaces, otherWorkspaces, personalWorkspace, loading,
    // Workspace-scoped views. Anything drawing relations must use these, so the
    // lines it draws agree with the counts computed from the same scope.
    scopedModels, scopedReports, scopedDatasources,
    setDatasources, setModels, setReports, setWorkspaces,
    selectedWs, setSelectedWs,
    currentWsKey, currentWsRole, isGlobalAdmin,
    modelsByDatasourceAll, reportsByModelAll,
    // Column order — see above. A stage that renders its own rows must follow
    // these, or its joins start crossing the neighbours'.
    orderedDatasources, orderedModels, modelOrder,
    refresh,
  }), [datasources, models, reports, workspaces, otherWorkspaces, personalWorkspace, loading,
    scopedModels, scopedReports, scopedDatasources,
    selectedWs, currentWsKey, currentWsRole, isGlobalAdmin,
    modelsByDatasourceAll, reportsByModelAll,
    orderedDatasources, orderedModels, modelOrder, refresh]);

  return <GraphContext.Provider value={value}>{children}</GraphContext.Provider>;
}

function countBy(rows, key) {
  const out = new Map();
  for (const row of rows) {
    const parent = row[key];
    if (parent) out.set(parent, (out.get(parent) || 0) + 1);
  }
  return out;
}
