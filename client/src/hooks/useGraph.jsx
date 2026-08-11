import { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../utils/api';
import { useAuth } from './useAuth';
import { GraphContext } from './graphContext';

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
    if (!selectedWs || !workspaces.length) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!workspaces.some((w) => w.id === selectedWs)) setSelectedWs(null);
  }, [selectedWs, workspaces]);

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
    setLoading(false);
  }, []);

  // Only once signed in: these endpoints 401 otherwise, and the public report
  // viewer renders under this provider too.
  // The rule fires because `refresh` sets state, but it only does so after
  // awaiting the three requests — never synchronously during the effect.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (user) refresh(); }, [user, refresh]);

  // Everything below is scoped to the active workspace, walking the chain
  // backwards: workspace → its reports → their models → those models'
  // datasources.
  //
  // The counts on the join lines have to use the same scope as the column they
  // point at, otherwise a model advertises "3 reports" while the Reports stage
  // — which only lists the workspace's own — shows one.
  const scopedReports = useMemo(
    () => (selectedWs ? reports.filter((r) => r.workspace_id === selectedWs) : reports),
    [reports, selectedWs]
  );

  // Null when no workspace is active: nothing is dimmed and nothing is scoped.
  const activeModelIds = useMemo(() => {
    if (!selectedWs) return null;
    const ids = new Set();
    for (const r of scopedReports) if (r.model_id) ids.add(r.model_id);
    return ids;
  }, [selectedWs, scopedReports]);

  const scopedModels = useMemo(
    () => (activeModelIds ? models.filter((m) => activeModelIds.has(m.id)) : models),
    [models, activeModelIds]
  );

  // Used to dim what the workspace doesn't touch — never to hide it, since a
  // datasource no report uses yet still has to be reachable.
  const activeDatasourceIds = useMemo(() => {
    if (!activeModelIds) return null;
    const ids = new Set();
    for (const m of scopedModels) if (m.datasource_id) ids.add(m.datasource_id);
    return ids;
  }, [activeModelIds, scopedModels]);

  // Children counts, derived rather than fetched: the lists already carry the
  // parent ids (`datasource_id` on models, `model_id` on reports).
  const modelsByDatasource = useMemo(() => countBy(scopedModels, 'datasource_id'), [scopedModels]);
  const reportsByModel = useMemo(() => countBy(scopedReports, 'model_id'), [scopedReports]);

  // Where each child sits in the next stage's column, as a 0–1 fraction. The
  // join curves aim at those heights, so a link to the first row leaves high
  // and a link to the last leaves low — the fan follows the real layout instead
  // of spreading arbitrarily.
  const modelSpreadByDatasource = useMemo(() => spreadBy(scopedModels, 'datasource_id'), [scopedModels]);
  const reportSpreadByModel = useMemo(() => spreadBy(scopedReports, 'model_id'), [scopedReports]);

  const value = useMemo(() => ({
    datasources, models, reports, workspaces, personalWorkspace, loading,
    setDatasources, setModels, setReports, setWorkspaces,
    selectedWs, setSelectedWs,
    modelsByDatasource, reportsByModel,
    modelSpreadByDatasource, reportSpreadByModel,
    activeModelIds, activeDatasourceIds,
    refresh,
  }), [datasources, models, reports, workspaces, personalWorkspace, loading,
    selectedWs, modelsByDatasource, reportsByModel,
    modelSpreadByDatasource, reportSpreadByModel,
    activeModelIds, activeDatasourceIds, refresh]);

  return <GraphContext.Provider value={value}>{children}</GraphContext.Provider>;
}

// Positions of each parent's children within the child list, normalised to
// 0–1 so a consumer can map them onto whatever height it has.
function spreadBy(rows, key) {
  const out = new Map();
  const total = rows.length || 1;
  rows.forEach((row, i) => {
    const parent = row[key];
    if (!parent) return;
    const at = (i + 0.5) / total;
    const arr = out.get(parent);
    if (arr) arr.push(at); else out.set(parent, [at]);
  });
  return out;
}

function countBy(rows, key) {
  const out = new Map();
  for (const row of rows) {
    const parent = row[key];
    if (parent) out.set(parent, (out.get(parent) || 0) + 1);
  }
  return out;
}
