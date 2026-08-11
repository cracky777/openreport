// Floats the rows the active workspace reaches to the top of a stage, leaving
// the dimmed ones below in their original order. Dimming alone still makes the
// eye hunt down the list; ordering puts what's relevant under it right away.
//
// `activeIds` is null when no workspace is selected — nothing is dimmed then,
// so the list is returned untouched.
export function sortActiveFirst(rows, activeIds) {
  if (!activeIds) return rows;
  const active = [];
  const rest = [];
  for (const row of rows) (activeIds.has(row.id) ? active : rest).push(row);
  return [...active, ...rest];
}
