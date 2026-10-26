// Filters and axes read the DIMENSION tables, not the facts' own copies of
// their keys (Jonathan: « pour les filtres, il faut en priorité prendre les
// données des dimensions, de même pour les axes »). A year slicer on
// commandes.date_commande filtered the orders and left the targets and the
// card uses alone; on calendrier.date it filters every fact joined to the
// calendar. A fact's own attribute that no dimension table holds (an
// occasion, a format) stays where it is.

// The field of the dimension table holding the same values as a fact's key
// column: the column the fact joins many-to-one, same date part. One join
// only — a key read two ways is the author's to choose.
function dimensionSideOf(name, effective) {
  const dims = effective.dimensions || [];
  const d = dims.find((x) => x.name === name);
  if (!d || d.expression || !d.table || !d.column) return null;
  const targets = [];
  for (const j of effective.joins || []) {
    const c = (j && j.cardinality) || {};
    if (j.from_table === d.table && j.from_column === d.column && c.from === '*' && c.to === '1') targets.push([j.to_table, j.to_column]);
    else if (j.to_table === d.table && j.to_column === d.column && c.to === '*' && c.from === '1') targets.push([j.from_table, j.from_column]);
  }
  if (targets.length !== 1) return null;
  const [table, column] = targets[0];
  const same = dims.find((x) => x.table === table && x.column === column && !x.expression && (x.datePart || null) === (d.datePart || null));
  return same ? same.name : null;
}

const BINDING_DIMS = ['selectedDimensions', 'groupBy', 'columnDimensions'];

// A proposed visual with its fact keys moved to their dimension table: in the
// binding, its filters, its period and the names it gives the fields.
function onDimensionSide(binding, raw, effective) {
  const to = (n) => dimensionSideOf(n, effective) || n;
  const out = { ...binding };
  for (const k of BINDING_DIMS) if (Array.isArray(out[k])) out[k] = [...new Set(out[k].map(to))];
  const next = { ...raw };
  if (Array.isArray(raw.filters)) next.filters = raw.filters.map((f) => (f && typeof f.field === 'string' ? { ...f, field: to(f.field) } : f));
  if (raw.timePeriod && typeof raw.timePeriod.dim === 'string') next.timePeriod = { ...raw.timePeriod, dim: to(raw.timePeriod.dim) };
  if (raw.fieldNames && typeof raw.fieldNames === 'object' && !Array.isArray(raw.fieldNames)) {
    next.fieldNames = Object.fromEntries(Object.entries(raw.fieldNames).map(([k, v]) => [to(k), v]));
  }
  return { binding: out, raw: next };
}

module.exports = { dimensionSideOf, onDimensionSide };
