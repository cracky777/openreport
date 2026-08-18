// Key-ish columns surface at the top of each model-canvas card: they are the
// join anchors, and the canvas exists mostly to draw joins. Primary
// identifiers (id*, pk*) outrank foreign keys (fk*); alphabetical within each
// tier. Loose prefix match on purpose — "idclient" / "fkclient" naming
// without a separator is common.
export function keyRank(columnName) {
  const n = columnName.toLowerCase();
  if (n.startsWith('id') || n.startsWith('pk')) return 0;
  if (n.startsWith('fk')) return 1;
  return 2;
}

export function sortColumns(columns) {
  return [...columns].sort((a, b) => {
    const ra = keyRank(a.column_name);
    const rb = keyRank(b.column_name);
    if (ra !== rb) return ra - rb;
    return a.column_name.localeCompare(b.column_name);
  });
}
