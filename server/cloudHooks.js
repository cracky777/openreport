// Central registry of cloud-edition extension points.
//
// Every field is null in the OSS (self-hosted) edition → the base behaviour in
// the route handlers runs unchanged. The cloud edition assigns these once at
// boot (server/cloud/index.js) so all tenant-specific concerns live in ONE
// place instead of forking the OSS route files.
//
// Fields (added incrementally as the de-fork progresses):
//   authz(action, req, res, next)   — per-route authorization. `action` is
//       'read' | 'write'. OSS routes fall back to requireAuth (access is then
//       gated per-resource by canAccessModel); cloud adds the org read/write
//       role check on top.
//   resolveQueryTimeoutMs(req)      — workspace/org-scoped query timeout
//       override (falls back to the global admin setting when it returns
//       nothing usable).
//   canAccessReport(report, user, req) / canAccessModel(model, user, req)
//       canWriteModel(model, user, req) / canReadModel(model, user, req)
//       — the single authority for access. canAccessModel gates /query (owner /
//       admin / via a report, incl. public — cross-tenant OK). canReadModel
//       gates GET /:id metadata; cloud makes it stricter (org-membership only,
//       no public-report path) so a public viewer can query but not enumerate
//       the full model schema. OSS: canReadModel == canAccessModel. When set,
//       the hook fully REPLACES the base logic (returns a boolean).
//   canBuildOnModel(model, user, req) → bool — may the caller AUTHOR a report on
//       this model. Distinct from canWriteModel on purpose: authoring never
//       requires the right to edit the model. OSS: owner or global admin — the
//       point is to exclude someone whose only route to the model is a stranger's
//       shared report. Cloud: any member of the model's org, so an org viewer who
//       is editor on a workspace can still author there.
//   listModels(req) → array          — the models the request may list. OSS:
//       the caller's own models. Cloud: org models + workspace-shared ones.
//   canUseDatasource(datasourceId, req) → bool — may the caller bind this
//       datasource to a model. OSS: they own it. Cloud: it's in their org.
//   onModelCreate(req, modelId)       — post-INSERT hook to stamp tenant columns
//       (cloud: organization_id). No-op in OSS.
//   resolveCacheTtlMs(req) → number|null — per-request result-cache TTL. Cloud
//       reads the workspace override; a value <= 0 disables the queryCache for
//       that request. null / no hook → the global TTL applies (OSS default).
//   canWriteReport(report, user, req) → bool — may the caller mutate a report
//       (edit / delete / duplicate). OSS: owner or global admin. Cloud: org
//       admin, or workspace owner/admin/editor, or (personal) owner + org editor.
//   canManageReportHistory(report, user, req) → bool — view/restore report
//       versions. OSS: global admin. Cloud: org admin.
//   listReports(req) → rows — the reports the caller may list. OSS: their own.
//       Cloud: their own within the active org.
//   onReportCreate(req, reportId) — post-INSERT tenant-column stamp (cloud:
//       organization_id). No-op in OSS.
//   resolveDefaultWorkspace(req) → workspaceId — the fallback personal workspace
//       for a report with no explicit workspace. OSS: the user's personal ws.
//       Cloud: their personal ws within the active org.
const cloudHooks = {
  authz: null,
  resolveQueryTimeoutMs: null,
  canAccessReport: null,
  canAccessModel: null,
  canWriteModel: null,
  canReadModel: null,
  canBuildOnModel: null,
  listModels: null,
  canUseDatasource: null,
  onModelCreate: null,
  resolveCacheTtlMs: null,
  canWriteReport: null,
  canManageReportHistory: null,
  listReports: null,
  onReportCreate: null,
  resolveDefaultWorkspace: null,
  // guardImageUpload(req, res) → bool — cloud disables local image upload
  // (users paste a CDN/S3 URL). Returns true after sending its 403. OSS: no
  // hook → the upload proceeds.
  guardImageUpload: null,
  // Datasources (org-scoped in cloud). listDatasources(req) → rows ;
  // getDatasource(id, req) → full row|null (404 when null) ;
  // onDatasourceCreate(req, id) → stamp organization_id ;
  // countModelsUsingDatasource(req, id) → n (DELETE 409 guard).
  listDatasources: null,
  getDatasource: null,
  onDatasourceCreate: null,
  countModelsUsingDatasource: null,
  // File upload dedup + list (org-scoped in cloud). dedupUpload(req, filename)
  // → existing row|null ; listUploadedDatasources(req) → rows.
  dedupUpload: null,
  listUploadedDatasources: null,
  // Workspaces. workspaceAccess(id, req) → {workspace, role}|null (404 when null) ;
  // canAdminAllWorkspaces(req) → bool (GET/:id bypass) ; listWorkspaces(req) →
  // {owned, shared} ; onWorkspaceCreate(req, id) → stamp org ;
  // resolvePersonalWorkspaceFor(req, userId) → wsId (delete rehome) ;
  // workspaceSharingDenied(ws, req) → string|null (personal-org guard) ;
  // validateNewMember(req, targetUser) → string|null ; canSeeWorkspaceMembers(req,
  // access) → bool (member-list leak guard) ; workspaceIsPersonalOrg(req, ws) → bool.
  workspaceAccess: null,
  canAdminAllWorkspaces: null,
  listWorkspaces: null,
  onWorkspaceCreate: null,
  resolvePersonalWorkspaceFor: null,
  workspaceSharingDenied: null,
  validateNewMember: null,
  canSeeWorkspaceMembers: null,
  workspaceIsPersonalOrg: null,
  // adminViewWorkspace(workspaceId, req) → ws|null — the admin-bypass fetch when
  // the caller isn't a member. OSS: any workspace (global admin). Cloud:
  // org-scoped (an org admin only reaches workspaces in their own org). Shared
  // by workspaces GET/:id and customVisuals.
  adminViewWorkspace: null,
  // authorizeRollupModel(req, res) → model row|null — load + authorize the model
  // for the rollup endpoints. Sends the 404/403 itself when denied. OSS: owner
  // or global admin. Cloud: org-scoped + org-owner/admin/model-owner.
  authorizeRollupModel: null,
  // nameTaken(entity, name, req, excludeId) → bool — is `name` already used by a
  // datasource/model/workspace in the caller's scope. OSS: per user. Cloud: per
  // org. Case-insensitive. `entity` ∈ 'datasource' | 'model' | 'workspace'.
  nameTaken: null,
  // Alerts. The OSS edition notifies through webhooks only; these two hooks
  // let the cloud edition add channels (e-mail) without forking the route.
  // validateAlertExtras(body, req, existing) → {error}|{fields} — validate
  //   extra payload fields and return the column patch to merge into the
  //   INSERT/UPDATE (the cloud owns the extra columns). existing = null on
  //   create.
  // notifyAlert({alert, state, value, payload}) → Promise<{delivered, note}>
  //   — deliver a 'triggered'|'recovered' transition on the extra channels.
  //   `delivered` = at least one recipient accepted it (false when the alert
  //   has no extra recipients — "nothing to do" is not a notification);
  //   `note` = error text kept in the event history, or null.
  validateAlertExtras: null,
  notifyAlert: null,
  // listAlerts(req) → rows (shape of LIST_SQL in routes/alerts.js) — the
  //   alerts the caller may see. OSS: their own, everything for a global admin.
  //   Cloud: the active org's (all of them for an org admin, else their own).
  // canManageAlert(alert, user, req) → bool — edit / delete / run / history.
  //   OSS: owner or global admin. Cloud: same org AND (owner or org admin).
  listAlerts: null,
  canManageAlert: null,
  // canManageSchedule(report, user, req) → bool — may the caller see or change
  //   the cache schedules of this report (list, inspect, size, delete, warm).
  //   OSS: the report owner or a global admin. Cloud: same organization, then
  //   owner or org admin — without it the OSS rule runs unscoped in a
  //   multi-tenant deployment.
  canManageSchedule: null,
};

module.exports = cloudHooks;
