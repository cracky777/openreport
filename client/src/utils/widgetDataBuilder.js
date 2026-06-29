// Build a widget's `data` object from the /query response. Pure function —
// no React. Was inlined in both Editor.jsx (lines 1396-1649) and
// Viewer.jsx (lines 612-822) as a giant switch over `widget.type`.
//
// The signature accepts the already-extracted response payloads so the
// caller owns the axios-error / cancellation branch. Returns the fully
// assembled `newData` object (including the empty-rows case which still
// stamps drill metadata + cache key when applicable).
//
// `meta` is the same object returned by buildWidgetQueryPayload — drills
// path / topN / colDims etc. all flow through here from there to keep the
// two utilities in lockstep.
//
// Behaviour switches:
//   pivotFilterRowDims — Editor currently passes `true` (filters out
//     col-pinned dims from the row dim list). Viewer passes `false`
//     (keeps every selected dim in the row list). Per the empirical
//     investigation the Viewer version is the desired output when the
//     same dim sits in both row + column zones; the Editor's filter is
//     preserved untouched to avoid silent behavioural changes there.
//   bindingKey — Editor stamps this on the widget data so the next mount
//     of the same report skips re-fetching widgets whose binding+filter
//     state is unchanged. Viewer doesn't use the mechanism (passes null
//     and the field stays absent on the widget).
export function buildWidgetData({
  widget,
  rows,
  meta,
  effectiveModel,
  colorRes,
  totalRes,
  n1Res,
  comboLineRes,
  sql,
  bindingKey = null,
  pivotFilterRowDims = false,
}) {
  const w = widget;
  const { dims, allDims, meass, grpBy, colDimsB, cbm, clm, sm,
    fullHierarchy, isDrillable, drillPath, topN } = meta;
  const topNApplies = topN.applies;

  // Extract the colour-coding aggregate from the optional color query.
  let _colorValue;
  if (colorRes) {
    const cRow = colorRes.data?.rows?.[0];
    if (cRow) {
      const v = Object.values(cRow)[0];
      const num = typeof v === 'number' ? v : parseFloat(v);
      if (!isNaN(num)) _colorValue = num;
    }
  }

  // Empty-rows path. Even with no data we keep the drill metadata around
  // so the canvas still shows the up/reset arrows — otherwise the user
  // gets stranded at a drilled level with no way back. Filter widgets
  // get an additional `values: []` + `label` shape so the slicer renders
  // its empty state instead of falling back to the chart-style empty.
  if (!rows || rows.length === 0) {
    const emptyData = meta.isFilterWidget
      ? { values: [], label: dims[0] || '', _rowCount: 0, _colorValue, _sql: sql || null }
      : { _rowCount: 0, _colorValue, _sql: sql || null };
    if (isDrillable) {
      emptyData._hierarchy = fullHierarchy.map((dn) => {
        const def = (effectiveModel?.dimensions || []).find((x) => x.name === dn);
        return { name: dn, label: def?.label || def?.name || dn };
      });
      emptyData._drillPath = drillPath;
      emptyData._drillDepth = drillPath.length;
      emptyData._isDrillLeaf = drillPath.length >= fullHierarchy.length - 1;
    }
    if (bindingKey) emptyData._fetchedBinding = bindingKey;
    return emptyData;
  }

  let newData = {};
  const keys = Object.keys(rows[0]);
  const gl = (name, list) => { const d = (list || []).find((x) => x.name === name); return d?.label || d?.name || name; };

  if (w.type === 'filter') {
    // Filter widget — returns distinct values + label for the slicer to
    // render. Only reachable when caller passed `filterWidgetMode:
    // 'distinct'` to buildWidgetQueryPayload (Viewer); in Editor's mode
    // filter widgets are excluded upstream from toFetch entirely.
    const dimDef = (effectiveModel?.dimensions || []).find((x) => x.name === dims[0]);
    newData = {
      values: [...new Set(rows.map((r) => r[keys[0]]).filter((v) => v != null))],
      label: dims[0] || '',
      _isDate: dimDef?.type === 'date',
    };
  } else if (w.type === 'pivotTable') {
    const rowDimNames = pivotFilterRowDims
      ? dims.filter((d) => !colDimsB.includes(d))
      : [...dims];
    newData = {
      rawRows: rows,
      _rowDims: rowDimNames.map((d) => gl(d, effectiveModel?.dimensions)),
      _colDims: colDimsB.map((d) => gl(d, effectiveModel?.dimensions)),
      _measures: meass.map((m) => gl(m, effectiveModel?.measures)),
    };
  } else if (w.type === 'scatter') {
    if (sm.x && sm.y) {
      const dimLbl = dims.length > 0 ? gl(dims[0], effectiveModel?.dimensions) : null;
      const grpLbl = grpBy.length > 0 ? gl(grpBy[0], effectiveModel?.dimensions) : null;
      const xLbl = gl(sm.x, effectiveModel?.measures);
      const yLbl = gl(sm.y, effectiveModel?.measures);
      const sizeLbl = sm.size ? gl(sm.size, effectiveModel?.measures) : null;
      const fk = (l) => keys.find((k) => k === l) || null;
      const dk = dimLbl ? fk(dimLbl) : null;
      const gk = grpLbl ? fk(grpLbl) : null;
      const xk = fk(xLbl), yk = fk(yLbl);
      const sk = sizeLbl ? fk(sizeLbl) : null;
      if (xk && yk) {
        const bp = (r) => ({ x: Number(r[xk]) || 0, y: Number(r[yk]) || 0, size: sk ? Number(r[sk]) || 0 : undefined, label: dk ? String(r[dk] ?? '') : undefined });
        if (gk) {
          const groups = {};
          rows.forEach((r) => { const g = String(r[gk] ?? ''); if (!groups[g]) groups[g] = []; groups[g].push(bp(r)); });
          newData = { points: rows.map(bp), seriesGroups: Object.entries(groups).map(([name, pts]) => ({ name, points: pts })) };
        } else {
          newData = { points: rows.map(bp) };
        }
        newData._xLabel = xLbl;
        newData._yLabel = yLbl;
        newData._hasSize = !!sk;
        if (sk) newData._sizeLabel = sizeLbl;
      }
    }
  } else if (w.type === 'combo') {
    if (rows.length > 0) {
      const fk = (label) => keys.find((k) => k === label) || null;
      const axisKey = dims.length > 0 ? fk(gl(dims[0], effectiveModel?.dimensions)) || keys[0] : keys[0];
      const grpLabel = grpBy.length > 0 ? gl(grpBy[0], effectiveModel?.dimensions) : null;
      const grpKey = grpLabel ? fk(grpLabel) : null;
      const labels = [...new Set(rows.map((r) => String(r[axisKey] ?? '')))];
      let barSeries = [];
      if (grpKey) {
        const ug = [...new Set(rows.map((r) => String(r[grpKey] ?? '')))].sort();
        // Index by (axis, group) once so each cell is an O(1) lookup instead
        // of a rows.find() scan. First-match wins, matching rows.find().
        const byAxisGroup = new Map();
        rows.forEach((r) => { const k = `${String(r[axisKey] ?? '')}\u0000${String(r[grpKey] ?? '')}`; if (!byAxisGroup.has(k)) byAxisGroup.set(k, r); });
        cbm.forEach((mn) => {
          const ml = gl(mn, effectiveModel?.measures);
          const mk = fk(ml);
          if (!mk) return;
          ug.forEach((gv) => {
            barSeries.push({
              name: cbm.length === 1 ? gv : `${gv} - ${ml}`,
              values: labels.map((l) => {
                const row = byAxisGroup.get(`${l}\u0000${gv}`);
                return row ? Number(row[mk]) || 0 : 0;
              }),
            });
          });
        });
      } else {
        const byAxis = new Map();
        rows.forEach((r) => { const k = String(r[axisKey] ?? ''); if (!byAxis.has(k)) byAxis.set(k, r); });
        cbm.forEach((mn) => {
          const ml = gl(mn, effectiveModel?.measures);
          const mk = fk(ml);
          if (!mk) return;
          barSeries.push({
            name: ml,
            values: labels.map((l) => {
              const row = byAxis.get(l);
              return row ? Number(row[mk]) || 0 : 0;
            }),
          });
        });
      }
      // Line series: when there's a groupBy we run a dedicated query
      // (comboLineRes) aggregating the line at the (dim) level only, so
      // ratios / non-additive measures aren't broken by client-side sum.
      let lineSeries;
      const lineRows = comboLineRes?.data?.rows;
      if (lineRows && grpBy.length > 0) {
        const lineKeys = lineRows.length > 0 ? Object.keys(lineRows[0]) : [];
        const lineByAxis = new Map();
        lineRows.forEach((r) => { const k = String(r[axisKey] ?? ''); if (!lineByAxis.has(k)) lineByAxis.set(k, r); });
        lineSeries = clm.map((mn) => {
          const ml = gl(mn, effectiveModel?.measures);
          const mk = lineKeys.includes(ml) ? ml : (lineKeys.includes(mn) ? mn : null);
          if (!mk) return null;
          return {
            name: ml,
            values: labels.map((l) => {
              const row = lineByAxis.get(l);
              return row ? Number(row[mk]) || 0 : 0;
            }),
          };
        }).filter(Boolean);
      } else {
        const rowsByAxis = new Map();
        rows.forEach((r) => { const k = String(r[axisKey] ?? ''); const b = rowsByAxis.get(k); if (b) b.push(r); else rowsByAxis.set(k, [r]); });
        lineSeries = clm.map((mn) => {
          const ml = gl(mn, effectiveModel?.measures);
          const mk = fk(ml);
          if (!mk) return null;
          return {
            name: ml,
            values: labels.map((l) => (rowsByAxis.get(l) || []).reduce((s, r) => s + (Number(r[mk]) || 0), 0)),
          };
        }).filter(Boolean);
      }
      newData = { labels, barSeries, lineSeries };
      newData._barMeasureLabel = cbm.map((mn) => gl(mn, effectiveModel?.measures)).join(', ');
      newData._lineMeasureLabel = clm.map((mn) => gl(mn, effectiveModel?.measures)).join(', ');
    }
  } else if (w.type === 'table') {
    newData = { columns: keys, rows: rows.map((r) => Object.values(r).map((v) => v != null ? String(v) : '')) };
  } else if (w.type === 'customVisual') {
    // Normalised tabular form for custom visuals — rows are kept as-is
    // and `fields` describes the role of each column so the iframe can
    // interpret them.
    const dimsMeta = dims.map((name) => {
      const d = (effectiveModel?.dimensions || []).find((x) => x.name === name);
      return { name: d?.label || d?.name || name, role: 'category', sourceName: name };
    });
    const measMeta = meass.map((name) => {
      const m = (effectiveModel?.measures || []).find((x) => x.name === name);
      return { name: m?.label || m?.name || name, role: 'value', format: m?.format, sourceName: name };
    });
    newData = { rows, fields: { dimensions: dimsMeta, measures: measMeta } };
  } else if (w.type === 'pie' || w.type === 'treemap') {
    newData = { items: rows.map((r) => ({ name: String(r[keys[0]]), value: Number(r[keys[keys.length - 1]]) || 0 })) };
  } else if (w.type === 'scorecard' || w.type === 'gauge') {
    const firstRow = rows[0];
    if (firstRow) {
      const valueMeasName = w.dataBinding?.selectedMeasures?.[0];
      const valueMeasDef = (effectiveModel?.measures || []).find((m) => m.name === valueMeasName);
      const valueKey = valueMeasDef?.label || valueMeasDef?.name || valueMeasName;
      const measureVal = valueKey && firstRow[valueKey] !== undefined ? firstRow[valueKey] : Object.values(firstRow)[0];
      newData = {
        value: measureVal,
        label: valueMeasDef?.label || valueMeasName || '',
      };
      // N-1 comparison (scorecard only) — same SELECT shape, only WHERE shifted.
      if (w.type === 'scorecard' && n1Res?.data?.rows?.[0]) {
        const n1Row = n1Res.data.rows[0];
        const n1Raw = valueKey && n1Row[valueKey] !== undefined ? n1Row[valueKey] : Object.values(n1Row)[0];
        const n1Num = typeof n1Raw === 'number' ? n1Raw : parseFloat(String(n1Raw));
        if (!isNaN(n1Num)) newData._n1Value = n1Num;
      }
      if (w.type === 'gauge') {
        const extractMeas = (measName) => {
          if (!measName) return undefined;
          const def = (effectiveModel?.measures || []).find((m) => m.name === measName);
          const key = def?.label || def?.name || measName;
          const raw = firstRow[key];
          if (typeof raw === 'number') return raw;
          if (raw != null) {
            const parsed = parseFloat(String(raw));
            if (!isNaN(parsed)) return parsed;
          }
          return undefined;
        };
        const th = extractMeas(w.dataBinding?.gaugeThresholdMeasure);
        if (th !== undefined) newData.threshold = th;
        const mx = extractMeas(w.dataBinding?.gaugeMaxMeasure);
        if (mx !== undefined) newData.maxValue = mx;
      }
    }
  } else if (grpBy.length > 0 && keys.length >= 3) {
    // groupBy + 3+ keys → multi-series bar/line: rows are (axis, group, value).
    const [axisKey, groupKey] = keys;
    const valueKey = keys[keys.length - 1];
    const ul = [...new Set(rows.map((r) => String(r[axisKey])))];
    const ug = [...new Set(rows.map((r) => String(r[groupKey])))];
    // Index by (axis, group) once; first-match wins, matching rows.find().
    const byAxisGroup = new Map();
    rows.forEach((r) => { const k = `${String(r[axisKey])}\u0000${String(r[groupKey])}`; if (!byAxisGroup.has(k)) byAxisGroup.set(k, r); });
    newData = {
      labels: ul,
      series: ug.map((gv) => ({
        name: gv,
        values: ul.map((l) => {
          const row = byAxisGroup.get(`${l}\u0000${gv}`);
          return row ? Number(row[valueKey]) || 0 : 0;
        }),
      })),
    };
  } else {
    // Default — single-series bar/line: rows are (axis, value).
    newData = {
      labels: rows.map((r) => String(r[keys[0]])),
      values: rows.map((r) => Number(r[keys[keys.length - 1]]) || 0),
    };
  }

  // Common metadata stamped on every successful build. Order matters
  // for some downstream consumers (e.g. PivotTableWidget reads
  // _measures from the pivotTable branch, but _measureFormats from here).
  const mf = {};
  const durationCols = [];
  meass.forEach((mn) => {
    const md = (effectiveModel?.measures || []).find((x) => x.name === mn);
    if (!md) return;
    const colKey = md.label || md.name;
    if (md.format) mf[colKey] = md.format;
    if (String(md.dataType || '').toLowerCase() === 'interval') durationCols.push(colKey);
  });
  newData._measureFormats = mf;
  if (durationCols.length > 0) newData._durationColumns = durationCols;
  if (dims.length > 0) {
    newData._dimName = dims[0];
    const axisDim = (effectiveModel?.dimensions || []).find((x) => x.name === dims[0]);
    newData._dimLabel = axisDim?.label || axisDim?.name || dims[0];
    if (axisDim?.datePart) newData._datePart = axisDim.datePart;
    else if (axisDim?.type === 'date') newData._datePart = 'full_date';
    if (axisDim) newData._axisDimDef = { type: axisDim.type, datePart: axisDim.datePart };
  }
  if (grpBy.length > 0) {
    const legendDim = (effectiveModel?.dimensions || []).find((x) => x.name === grpBy[0]);
    if (legendDim) newData._legendDimDef = { type: legendDim.type, datePart: legendDim.datePart };
  }
  if (meass.length > 0) {
    const m0 = (effectiveModel?.measures || []).find((x) => x.name === meass[0]);
    newData._measureLabel = m0?.label || m0?.name || meass[0];
  }
  newData._rowCount = rows.length;
  if (isDrillable) {
    newData._hierarchy = fullHierarchy.map((dn) => {
      const def = (effectiveModel?.dimensions || []).find((x) => x.name === dn);
      return { name: dn, label: def?.label || def?.name || dn };
    });
    newData._drillPath = drillPath;
    newData._drillDepth = drillPath.length;
    newData._isDrillLeaf = drillPath.length >= fullHierarchy.length - 1;
  }
  newData._colorValue = _colorValue;
  if (sql !== undefined) newData._sql = sql;
  // Server-side Top N — extract grand total so the widget can derive
  // Others = total − Σ(top N) without further client work.
  if (topNApplies && totalRes) {
    const tRow = totalRes.data?.rows?.[0];
    if (tRow) {
      const v = Object.values(tRow)[0];
      const num = typeof v === 'number' ? v : parseFloat(v);
      if (!isNaN(num)) newData._othersTotal = num;
    }
  }
  if (bindingKey) newData._fetchedBinding = bindingKey;

  return newData;
}
