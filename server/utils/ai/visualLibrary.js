// The custom visuals already installed in a workspace, as the assistant may
// use them: like a built-in type, by id. Uploaded or generated, they were put
// there by a workspace admin; what a member may do with them is place them on a
// page, which is all this offers.

const db = require('../../db');

const MAX_VISUALS = 30;
const MAX_TEXT = 160;

const clip = (v) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);

function rolesOf(list) {
  return (Array.isArray(list) ? list : []).slice(0, 8).map((r) => clip((r && (r.label || r.role)) || '')).filter(Boolean);
}

/**
 * @returns {object[]} [{ id, name, description, dimensions, measures, manifest, bundleUrl }], newest first
 */
function libraryOf(wsId) {
  if (!wsId) return [];
  const rows = db.prepare('SELECT visual_id, name, manifest FROM custom_visuals WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?').all(wsId, MAX_VISUALS);
  return rows.map((r) => {
    let manifest = {};
    try { manifest = JSON.parse(r.manifest) || {}; } catch { /* a broken manifest still names the visual */ }
    const schema = manifest.dataSchema || {};
    return {
      id: r.visual_id,
      name: clip(r.name || manifest.name || r.visual_id),
      description: clip(manifest.description),
      dimensions: rolesOf(schema.dimensions),
      measures: rolesOf(schema.measures),
      manifest,
      bundleUrl: `/api/workspaces/${encodeURIComponent(wsId)}/visuals/${encodeURIComponent(r.visual_id)}/bundle.js`,
    };
  });
}

/** One line per visual, for the prompt. Written by admins, but still quoted as data. */
function libraryLines(library) {
  return library.map((v) => `- ${JSON.stringify(v.id)}: ${JSON.stringify(v.name)}${v.description ? ` — ${JSON.stringify(v.description)}` : ''} · dimensions: ${v.dimensions.map((d) => JSON.stringify(d)).join(', ') || 'none'} · measures: ${v.measures.map((m) => JSON.stringify(m)).join(', ') || 'none'}`);
}

module.exports = { libraryOf, libraryLines, MAX_VISUALS };
