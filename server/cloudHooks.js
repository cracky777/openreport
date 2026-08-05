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
//       canWriteModel(model, user, req)
//       — the single authority for read / write access. OSS runs its base
//       owner/admin/public logic; cloud replaces it with the org read/write
//       role check. When set, the hook fully REPLACES the base logic (it must
//       return a boolean).
const cloudHooks = {
  authz: null,
  resolveQueryTimeoutMs: null,
  canAccessReport: null,
  canAccessModel: null,
  canWriteModel: null,
};

module.exports = cloudHooks;
