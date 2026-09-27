import { describe, it, expect } from 'vitest';
import { scopeResources, roleInWorkspace, canBuildWithRole, buildableSources } from './workspaceScope';

const ME = 'u1';
const PERSONAL = 'p1';
const TEAM = 't1';
const OTHER = 't2';
const datasources = [
  { id: 'd1', user_id: ME, workspace_id: PERSONAL },
  { id: 'd2', user_id: 'u2', workspace_id: TEAM },
  { id: 'd3', user_id: 'u3', workspace_id: OTHER },
  { id: 'd4', user_id: 'u3', workspace_id: OTHER, shared_in: [TEAM] },
];
const models = [
  { id: 'm1', user_id: ME, workspace_id: PERSONAL, datasource_id: 'd1', shared_in: [] },
  { id: 'm2', user_id: 'u2', workspace_id: TEAM, datasource_id: 'd2', shared_in: [] },
  { id: 'm3', user_id: 'u3', workspace_id: OTHER, datasource_id: 'd3', shared_in: [TEAM] },
  { id: 'm4', user_id: ME, workspace_id: TEAM, datasource_id: 'd2', shared_in: [] },
];

describe('scopeResources', () => {
  it('a workspace shows its own models, the ones shared into it, and their sources', () => {
    const r = scopeResources({ datasources, models, selectedWs: TEAM, personalWorkspaceId: PERSONAL, userId: ME });
    expect(r.models.map((m) => m.id)).toEqual(['m2', 'm3', 'm4']);
    // d3 is on screen because the shared m3 reads it; d4 is shared into the
    // team; d1 is not the team's.
    expect(r.datasources.map((d) => d.id)).toEqual(['d2', 'd3', 'd4']);
    // A model is created on what lives here or is shared here, not on d3.
    expect(buildableSources(r.datasources, TEAM).map((d) => d.id)).toEqual(['d2', 'd4']);
  });
  it('My Reports is the personal workspace only, not what one created in a team', () => {
    const r = scopeResources({ datasources, models, selectedWs: null, personalWorkspaceId: PERSONAL, userId: ME });
    expect(r.models.map((m) => m.id)).toEqual(['m1']);
    expect(r.datasources.map((d) => d.id)).toEqual(['d1']);
  });
  it('an unknown workspace shows nothing', () => {
    const r = scopeResources({ datasources, models, selectedWs: 'nope', personalWorkspaceId: PERSONAL, userId: ME });
    expect(r.models).toEqual([]);
    expect(r.datasources).toEqual([]);
  });
});

describe('roleInWorkspace', () => {
  const workspaces = [{ id: TEAM, member_role: 'editor' }];
  const otherWorkspaces = [{ id: OTHER, member_role: null }];
  it('reads the membership, treats the personal space as admin, and the admin-only list as admin', () => {
    expect(roleInWorkspace({ selectedWs: null, workspaces, otherWorkspaces, isGlobalAdmin: false })).toBe('admin');
    expect(roleInWorkspace({ selectedWs: TEAM, workspaces, otherWorkspaces, isGlobalAdmin: false })).toBe('editor');
    expect(roleInWorkspace({ selectedWs: OTHER, workspaces, otherWorkspaces, isGlobalAdmin: false })).toBeNull();
    expect(roleInWorkspace({ selectedWs: OTHER, workspaces, otherWorkspaces, isGlobalAdmin: true })).toBe('admin');
  });
  it('building takes an admin or an editor', () => {
    expect(canBuildWithRole('editor')).toBe(true);
    expect(canBuildWithRole('viewer')).toBe(false);
    expect(canBuildWithRole(null)).toBe(false);
  });
});
