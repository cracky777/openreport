// Order a column by the one before it: each row sits inside its parent's block,
// and the blocks follow the order that previous column already has.
//
// Two joins between adjacent columns cross exactly when their endpoints are
// ordered differently on the two sides. Inheriting the order therefore removes
// the crossings at the source instead of trying to untangle the curves
// afterwards — and it does so for the whole chain, since the models column
// hands its own order down to the reports.
//
// Rows whose parent is missing or unknown keep their relative order at the end:
// there is nothing to line them up with, and dropping them would hide them.
export function groupByParent(rows, parentIds, parentKey) {
  const rank = new Map();
  parentIds.forEach((id, i) => rank.set(id, i));
  const ORPHAN = Number.MAX_SAFE_INTEGER;
  return rows
    .map((row, i) => ({ row, i, parent: rank.has(row[parentKey]) ? rank.get(row[parentKey]) : ORPHAN }))
    .sort((a, b) => (a.parent - b.parent) || (a.i - b.i))
    .map((entry) => entry.row);
}
