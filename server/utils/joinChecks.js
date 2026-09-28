// The rules a set of joins must keep to be queried without surprise, shared by
// the model assistant's proposals and the relationship detection: joins point
// from the many side to the one side (fact → dimension), never loop, never
// offer two ways between the same tables, and join a pair of tables once.

const joinKey = (j) => [j.from_table, j.from_column, j.to_table, j.to_column].join('|');
const sameLink = (a, b) => joinKey(a) === joinKey(b)
  || (a.from_table === b.to_table && a.from_column === b.to_column && a.to_table === b.from_table && a.to_column === b.from_column);

// The rule the diagram applies by hand (SchemaCanvas.wouldCreateCycle): a loop
// is a way back to where one started following the joins many → one. Several
// facts sharing a dimension is no loop — a first version that ignored the
// direction refused half of a real two-fact model.
const orient = (j) => (j.cardinality && j.cardinality.from === '1' && j.cardinality.to === '*' ? [j.to_table, j.from_table] : [j.from_table, j.to_table]);
function makesLoop(joins, added) {
  const [src, dst] = orient(added);
  const next = {};
  for (const j of joins) {
    const [a, b] = orient(j);
    (next[a] = next[a] || []).push(b);
  }
  const seen = new Set([dst]);
  const queue = [dst];
  while (queue.length) {
    const t = queue.shift();
    if (t === src) return true;
    for (const n of next[t] || []) if (!seen.has(n)) { seen.add(n); queue.push(n); }
  }
  return false;
}

// Two ways from one table to another (calls → clients, and calls → callers →
// clients): a query through that model cannot tell which one to follow. Seen
// on a real model: three dimension-to-dimension joins on a client id, each
// making a second path from the fact to the clients. Joins point many → one,
// so the graph is acyclic (makesLoop) and paths can be counted.
function secondPath(joins) {
  const next = {};
  for (const j of joins) {
    const [a, b] = orient(j);
    (next[a] = next[a] || []).push(b);
  }
  const memo = new Map();
  const reach = (t) => {
    if (memo.has(t)) return memo.get(t);
    const counts = new Map();
    for (const n of next[t] || []) {
      counts.set(n, (counts.get(n) || 0) + 1);
      for (const [far, k] of reach(n)) counts.set(far, (counts.get(far) || 0) + k);
    }
    memo.set(t, counts);
    return counts;
  };
  for (const t of Object.keys(next)) {
    for (const [far, k] of reach(t)) if (k > 1) return [t, far];
  }
  return null;
}

const joinedPair = (joins, a, b) => joins.some((j) => (j.from_table === a && j.to_table === b) || (j.from_table === b && j.to_table === a));

module.exports = { sameLink, orient, makesLoop, secondPath, joinedPair };
