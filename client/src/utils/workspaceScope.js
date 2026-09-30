// What the open workspace shows of the Sources and Models stages, and what
// the caller may do there. Mirrors the server's rule (utils/workspaceAccess.js):
// a source or a model lives in one workspace, both can be shared into
// others, and rights follow the role held there. Anything outside the open
// workspace is not on screen — a new workspace starts empty.

// The rows of the open workspace: what lives there or is shared into it —
// sources and models alike. `selectedWs` null is "My Reports", the personal
// workspace and nothing else. A source also shows, read-only, behind a model
// that LIVES here (its editors need it; the server lists it for them). Behind
// a model only shared here, its source is not shared — only a share of the
// source does that — so what shows is a locked stand-in (`notShared`): the
// name the model already carries, so the relation stays drawn, and nothing to
// open, read or build on.
const livesIn = (row, wsKey) => !!wsKey
  && (row.workspace_id === wsKey || (Array.isArray(row.shared_in) && row.shared_in.includes(wsKey)));

export function scopeResources({ datasources, models, selectedWs, personalWorkspaceId }) {
  const wsKey = selectedWs || personalWorkspaceId || null;
  const scopedModels = (models || []).filter((m) => livesIn(m, wsKey));
  const modelSources = new Set(scopedModels.filter((m) => m.workspace_id === wsKey)
    .flatMap((m) => [m.datasource_id, ...(m.linked_datasource_ids || [])]));
  const scopedSources = (datasources || []).filter((d) => livesIn(d, wsKey) || modelSources.has(d.id));
  const onScreen = new Set(scopedSources.map((d) => d.id));
  for (const m of scopedModels) {
    if (!m.datasource_id || onScreen.has(m.datasource_id)) continue;
    onScreen.add(m.datasource_id);
    scopedSources.push({ id: m.datasource_id, name: m.datasource_name, notShared: true });
  }
  return { wsKey, models: scopedModels, datasources: scopedSources };
}

// The sources a model can be created on from the open workspace: those that
// live there or are shared into it — not the ones only on screen behind a
// model of another workspace.
export function buildableSources(datasources, wsKey) {
  return (datasources || []).filter((d) => livesIn(d, wsKey));
}

// The role held in the open workspace: personal → admin; a workspace one
// belongs to → its role; one the global admin only manages → admin (the
// server still refuses them the data); nothing otherwise.
export function roleInWorkspace({ selectedWs, workspaces, otherWorkspaces, isGlobalAdmin }) {
  if (!selectedWs) return 'admin';
  const ws = (workspaces || []).find((w) => w.id === selectedWs);
  if (ws) return ws.member_role || 'viewer';
  if (isGlobalAdmin && (otherWorkspaces || []).some((w) => w.id === selectedWs)) return 'admin';
  return null;
}

export const canBuildWithRole = (role) => role === 'admin' || role === 'editor';
