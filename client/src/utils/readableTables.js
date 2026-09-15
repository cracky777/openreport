// Tables a calculated dimension attached to `home` may read without
// multiplying its rows: each join is crossed from its many side to its one
// side only (a 1:1 join both ways), transitively — Power BI's RELATED. Mirror
// of server/utils/sqlBuilder/dimensionTables.js readableTables, so the SQL
// editor only offers fields the server will accept. A join whose cardinality
// was never set is not crossed: guessing a direction would offer exactly the
// columns the rule exists to keep out.
export function readableTables(home, joins) {
  const reach = new Set(home ? [home] : []);
  if (!home) return reach;
  let changed = true;
  while (changed) {
    changed = false;
    for (const j of joins || []) {
      if (!j || !j.from_table || !j.to_table) continue;
      const c = j.cardinality || {};
      if (!c.from || !c.to) continue;
      const cross = (a, b, bMany) => {
        if (bMany || !reach.has(a) || reach.has(b)) return;
        reach.add(b);
        changed = true;
      };
      cross(j.from_table, j.to_table, c.to === '*');
      cross(j.to_table, j.from_table, c.from === '*');
    }
  }
  return reach;
}
