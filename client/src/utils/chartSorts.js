// Resolve the three sort modes from a widget config:
//   - `sortOrder`   — value-based sort applied to the primary axis ('asc'/'desc'/'none')
//   - `axisSort`    — axis-value sort (chrono-aware for date-part dims, alpha otherwise)
//   - `groupBySort` — value-based sort applied to the group-by zone (legend ordering)
//
// PropertyPanel stores the new shape under `config.zoneSorts = { values, axis, groupBy }`;
// the legacy `config.sortOrder` (single value) is kept as the fallback for reports
// authored before the per-zone shape existed. Bar / Line / Pie / Combo / TreeMap each
// had a near-identical 4-line block doing this resolution — Bar branches the default
// on subType (stacked subtypes default to 'desc' so the largest segment lands on top),
// TreeMap defaults to 'desc' (top-N is what you want visually), the rest default 'none'.
// The `valuesDefault` option lets the caller pick the legacy fallback per widget.
export function resolveZoneSorts(config, { valuesDefault = 'none' } = {}) {
  const zoneSorts = config?.zoneSorts;
  const sortOrder = zoneSorts
    ? (zoneSorts.values || 'none')
    : (config?.sortOrder || valuesDefault);
  const axisSort = zoneSorts?.axis || 'none';
  const groupBySort = zoneSorts?.groupBy || 'none';
  return { sortOrder, axisSort, groupBySort };
}
