// FROM + JOIN assembly for the /query SQL compiler — extracted verbatim from
// routes/models.js. Greedy traversal of the join graph: start from the most
// "fact-like" table (highest cardinality-"*" score), pull in snowflake bridge
// tables, then LEFT JOIN each remaining table reachable through a real join.
//
// Pure: reads only its inputs. Returns { fromClause, droppedTables } where
// droppedTables are filter-only tables with no join path to the query — the
// caller strips their WHERE clauses (a Cartesian no-op otherwise) and logs.
// Covered by tests/sqlSnapshotJoins (JOIN construction).
const { quoteTable, quoteCol } = require('../sqlDialect');
const { deriveJoinKeyword } = require('./joins');

function buildFromClause({ tablesUsed, allJoins, selectedDimensions, selectedMeasures, dbType }) {
  // Start with the most "fact-like" table (the one appearing with cardinality
  // "*" on the most joins). Starting from a dim would emit `FROM dim LEFT JOIN
  // fact` — semantically OK, but `FROM fact LEFT JOIN dim` is the canonical
  // star-schema shape and what most analytics readers expect.
  let tableList = Array.from(tablesUsed);
  if (tableList.length > 1) {
    const factScore = {};
    for (const t of tableList) factScore[t] = 0;
    for (const j of allJoins) {
      const c = j.cardinality;
      if (!c) continue;
      if (c.from === '*' && tableList.includes(j.from_table)) factScore[j.from_table] += 1;
      if (c.to === '*' && tableList.includes(j.to_table)) factScore[j.to_table] += 1;
    }
    // Stable sort: highest fact score first, original index as tie-breaker
    // so two equal-score tables keep their original relative order.
    const origOrder = new Map(tableList.map((t, i) => [t, i]));
    tableList.sort((a, b) => (factScore[b] - factScore[a]) || (origOrder.get(a) - origOrder.get(b)));
  }
  // Snowflake bridging: when a referenced table has no direct join to the
  // root (e.g. filter on `d_entite` while the query SELECTs from
  // `f_appel_entrant_fin` and the only connection is via `d_destinataire`),
  // we need to pull the intermediate table(s) into the FROM clause. Without
  // this the greedy join loop below falls back to a comma-separated
  // cross-join — Cartesian product, wrong results.
  if (tableList.length > 1) {
    const rootTable = tableList[0];
    // Undirected adjacency over the full join graph.
    const adj = new Map();
    for (const j of allJoins || []) {
      if (!j || !j.from_table || !j.to_table) continue;
      if (!adj.has(j.from_table)) adj.set(j.from_table, new Set());
      if (!adj.has(j.to_table)) adj.set(j.to_table, new Set());
      adj.get(j.from_table).add(j.to_table);
      adj.get(j.to_table).add(j.from_table);
    }
    // BFS from root to record the parent of every reachable table — gives
    // us shortest path back to root by walking up the parent chain.
    const parent = new Map();
    parent.set(rootTable, null);
    const queue = [rootTable];
    while (queue.length > 0) {
      const cur = queue.shift();
      for (const next of adj.get(cur) || []) {
        if (parent.has(next)) continue;
        parent.set(next, cur);
        queue.push(next);
      }
    }
    // For every referenced table, walk the parent chain back to root and
    // add the intermediate tables. Skip tables that aren't reachable at
    // all (broken model — the greedy loop will fall back to cross-join,
    // matching the old behaviour for that pathological case).
    const expanded = new Set(tableList);
    for (const t of tableList) {
      if (t === rootTable || !parent.has(t)) continue;
      let cur = parent.get(t);
      while (cur !== null && cur !== rootTable) {
        if (!expanded.has(cur)) expanded.add(cur);
        cur = parent.get(cur);
      }
    }
    if (expanded.size > tableList.length) {
      // Re-sort with bridges included. The root stays first; bridge tables
      // get fact-score 0 and slot in after the genuinely referenced tables.
      tableList = Array.from(expanded);
      tableList.sort((a, b) => {
        if (a === rootTable) return -1;
        if (b === rootTable) return 1;
        return 0;
      });
    }
  }
  let fromClause = quoteTable(tableList[0], dbType);
  const droppedTables = new Set();
  // Required tables we had to comma-cross-join (no join path) — the caller turns
  // a non-empty set into a clear 400 instead of shipping a Cartesian product.
  const crossJoined = new Set();
  if (tableList.length > 1) {
    const added = new Set([tableList[0]]);
    const remaining = tableList.slice(1);
    while (remaining.length > 0) {
      let pickedIdx = -1;
      let pickedJoin = null;
      for (let i = 0; i < remaining.length; i++) {
        const t = remaining[i];
        const join = allJoins.find(
          (j) => (j.from_table === t && added.has(j.to_table)) ||
                 (j.to_table === t && added.has(j.from_table))
        );
        if (join) { pickedIdx = i; pickedJoin = join; break; }
      }
      if (pickedIdx === -1) {
        // None of the leftover tables can be reached through a real join.
        // A filter-only table here — e.g. a date dimension pulled in by a
        // global date filter on a fact-less slicer query (`SELECT DISTINCT
        // d_destinataire.lib` with no measure, so no fact to bridge
        // d_date) — must NOT be comma-cross-joined: that's a Cartesian
        // product AND its WHERE clause degrades to a meaningless no-op
        // (`d_date.year = 2026` against an unrelated cross product just
        // asks "does any 2026 row exist"). Drop such tables and strip the
        // WHERE clauses that reference them. Tables genuinely required by
        // the SELECT / GROUP BY (pathological broken model) keep the old
        // cross-join fallback so we never emit invalid SQL.
        const requiredTables = new Set();
        for (const d of selectedDimensions) if (d.table) requiredTables.add(d.table);
        for (const m of selectedMeasures) if (m && m.table) requiredTables.add(m.table);
        for (const t of remaining) {
          if (requiredTables.has(t)) {
            fromClause += `, ${quoteTable(t, dbType)}`;
            crossJoined.add(t);
          } else {
            droppedTables.add(t);
          }
        }
        break;
      }
      const t = remaining.splice(pickedIdx, 1)[0];
      const joinType = deriveJoinKeyword(pickedJoin);
      fromClause += ` ${joinType} JOIN ${quoteTable(t, dbType)} ON ${quoteCol(pickedJoin.from_table, pickedJoin.from_column, dbType)} = ${quoteCol(pickedJoin.to_table, pickedJoin.to_column, dbType)}`;
      added.add(t);
    }
  }
  return { fromClause, droppedTables, crossJoined };
}

module.exports = { buildFromClause };
