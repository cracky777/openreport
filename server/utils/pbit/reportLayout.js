// The two Power BI report formats → one neutral description of pages and
// visuals. Legacy (Report/Layout) keeps every visual's config as a JSON
// string inside one big JSON; PBIR (Report/definition/**) is one file per
// visual with a public schema. The field/filter grammar is the same in both,
// only the envelope differs.

const { loadTheme, resolveThemeColors, EMPTY_THEME } = require('./theme');

// "'Perdu'" → 'Perdu', "0D" → 0, "1L" → 1, "true" → true, "null" → null,
// "datetime'2025-02-23T00:00:00'" → '2025-02-23T00:00:00'
function parseLiteral(v) {
  if (v == null) return null;
  const s = String(v);
  if (/^'.*'$/s.test(s)) return s.slice(1, -1).replace(/''/g, "'");
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null') return null;
  const dt = s.match(/^datetime'([^']*)'$/);
  if (dt) return dt[1];
  const num = s.match(/^(-?[0-9.]+)[DLM]?$/);
  if (num) return Number(num[1]);
  return s;
}

// Literal value of an `expr` node when it is a literal; null otherwise
// (measure-driven values are not portable; theme colours were turned into
// literals by resolveThemeColors before the config reached the readers).
function exprValue(node) {
  if (!node || typeof node !== 'object') return null;
  if (node.expr && node.expr.Literal) return parseLiteral(node.expr.Literal.Value);
  if (node.solid && node.solid.color) return exprValue(node.solid.color);
  if (node.expr && node.expr.ResourcePackageItem) return { resource: node.expr.ResourcePackageItem.ItemName };
  return null;
}

// First value of `propName` across the entries of objects[objName]; entries
// with a selector (per-series overrides) are skipped.
function objectProp(objects, objName, propName) {
  const entries = objects && objects[objName];
  if (!Array.isArray(entries)) return undefined;
  for (const e of entries) {
    if (e && e.selector && e.selector.id !== 'default') continue;
    const p = e && e.properties && e.properties[propName];
    if (p !== undefined) {
      const v = exprValue(p);
      if (v !== null) return v;
      return undefined;
    }
  }
  return undefined;
}

// Per-series values of `propName`: the entries of objects[objName] that a
// selector ties to one data member ("Perdu") or one measure (a query ref).
// → [{ member, metadata, value }]
function selectorProps(objects, objName, propName) {
  const entries = objects && objects[objName];
  if (!Array.isArray(entries)) return [];
  const out = [];
  for (const e of entries) {
    const sel = e && e.selector;
    if (!sel || sel.id === 'default') continue;
    const v = exprValue(e.properties && e.properties[propName]);
    if (v === null) continue;
    const data = Array.isArray(sel.data) ? sel.data[0] : null;
    const cmp = data && data.scopeId && data.scopeId.Comparison;
    const member = cmp && cmp.Right && cmp.Right.Literal ? parseLiteral(cmp.Right.Literal.Value) : undefined;
    out.push({ member: member === undefined ? null : member, metadata: typeof sel.metadata === 'string' ? sel.metadata : null, value: v });
  }
  return out;
}

// A field expression (Column / Measure / Aggregation / HierarchyLevel /
// GroupRef) → { kind, entity, property, fn, level }
function readField(expr, aliases = {}) {
  if (!expr || typeof expr !== 'object') return null;
  const entityOf = (ref) => {
    const sr = ref && ref.Expression && ref.Expression.SourceRef;
    if (!sr) return null;
    if (sr.Entity) return sr.Entity;
    if (sr.Source) return aliases[sr.Source] || null;
    return null;
  };
  if (expr.Column) return { kind: 'column', entity: entityOf(expr.Column), property: expr.Column.Property };
  if (expr.Measure) return { kind: 'measure', entity: entityOf(expr.Measure), property: expr.Measure.Property };
  if (expr.Aggregation) {
    const inner = readField(expr.Aggregation.Expression, aliases);
    return inner ? { ...inner, kind: 'aggregation', fn: expr.Aggregation.Function } : null;
  }
  if (expr.GroupRef) {
    const grouped = (expr.GroupRef.GroupedColumns || [])[0];
    const inner = grouped ? readField(grouped, aliases) : null;
    return inner ? { ...inner, kind: 'group', groupName: expr.GroupRef.Property } : null;
  }
  if (expr.HierarchyLevel) {
    const h = expr.HierarchyLevel.Expression && expr.HierarchyLevel.Expression.Hierarchy;
    const src = h && h.Expression;
    // Date variation hierarchy: PropertyVariationSource → the date column.
    if (src && src.PropertyVariationSource) {
      return {
        kind: 'dateLevel',
        entity: entityOf(src.PropertyVariationSource),
        property: src.PropertyVariationSource.Property,
        level: expr.HierarchyLevel.Level,
      };
    }
    return {
      kind: 'hierarchyLevel',
      entity: src ? entityOf(src) : null,
      hierarchy: h ? h.Hierarchy : null,
      level: expr.HierarchyLevel.Level,
    };
  }
  if (expr.Hierarchy) return null;
  return null;
}

// A filter card → { type, field, condition } ; `condition` is the raw Where
// condition (In / Comparison / Not / Between / TopN…) with aliases resolved.
function readFilter(f) {
  if (!f || typeof f !== 'object') return null;
  const flt = f.filter;
  const aliases = {};
  for (const fr of (flt && flt.From) || []) aliases[fr.Name] = fr.Entity;
  const fieldExpr = f.field || f.expression;
  const field = fieldExpr ? readField(fieldExpr, aliases) : null;
  const where = (flt && flt.Where) || [];
  const condition = where.length ? where[0].Condition : null;
  return { type: f.type || null, field, condition, aliases, from: (flt && flt.From) || [], hasCondition: !!condition };
}

// The visual's own sort → [{ field, direction }]. Legacy keeps it in the
// prototype query (Direction 1 asc / 2 desc), PBIR in the sort definition.
function readLegacyOrderBy(orderBy, aliases) {
  return (Array.isArray(orderBy) ? orderBy : []).map((o) => {
    const field = readField(o.Expression, aliases);
    return field ? { field, direction: o.Direction === 2 ? 'desc' : 'asc' } : null;
  }).filter(Boolean);
}

function readPbirOrderBy(query) {
  const sorts = query && query.sortDefinition && query.sortDefinition.sort;
  return (Array.isArray(sorts) ? sorts : []).map((s) => {
    const field = readField(s.field);
    return field ? { field, direction: s.direction === 'Descending' ? 'desc' : 'asc' } : null;
  }).filter(Boolean);
}

// The paragraphs of a text box as runs — each run keeps its own style, so
// "APPELS " + "TRAITÉS" in another colour survives — plus the first style
// and alignment seen, for the box-level defaults.
function readTextbox(objects) {
  const general = objects && objects.general && objects.general[0];
  const paragraphs = general && general.properties && general.properties.paragraphs;
  if (!Array.isArray(paragraphs)) return null;
  const runs = [];
  let style = null;
  let align = null;
  paragraphs.forEach((p, i) => {
    if (i > 0) runs.push({ text: '\n', style: null });
    for (const r of p.textRuns || []) {
      if (typeof r.value !== 'string' || r.value === '') continue;
      runs.push({ text: r.value, style: r.textStyle || null });
      if (!style && r.textStyle) style = r.textStyle;
    }
    if (!align && p.horizontalTextAlignment) align = p.horizontalTextAlignment;
  });
  return { text: runs.map((r) => r.text).join(''), runs, style, align };
}

function readVisualCommon(visualType, objects, containerObjects) {
  const v = { objects: objects || {}, containerObjects: containerObjects || {} };
  const titleText = objectProp(containerObjects, 'title', 'text');
  const titleShow = objectProp(containerObjects, 'title', 'show');
  v.title = typeof titleText === 'string' && titleShow !== false ? titleText : null;
  const bgShow = objectProp(containerObjects, 'background', 'show');
  // Fully transparent is as hidden as switched off.
  v.backgroundHidden = bgShow === false || objectProp(containerObjects, 'background', 'transparency') === 100;
  v.backgroundColor = typeof objectProp(containerObjects, 'background', 'color') === 'string' ? objectProp(containerObjects, 'background', 'color') : null;
  v.borderShow = objectProp(containerObjects, 'border', 'show');
  v.borderRadius = objectProp(containerObjects, 'border', 'radius');
  if (visualType === 'textbox') v.textbox = readTextbox(objects);
  if (visualType === 'image') {
    const legacy = objects && objects.image && objects.image[0] && objects.image[0].properties.sourceFile;
    const url = legacy ? exprValue(legacy.image && legacy.image.url) : objectProp(objects, 'general', 'imageUrl');
    v.image = url && url.resource ? url.resource : (typeof url === 'string' ? url : null);
    const scaling = legacy ? exprValue(legacy.image && legacy.image.scaling) : objectProp(objects, 'general', 'imageScalingType');
    v.imageScaling = typeof scaling === 'string' ? scaling : null;
    // Newer templates say how the picture fills its box next to the file.
    const fit = objectProp(objects, 'image', 'fit');
    v.imageFit = typeof fit === 'string' ? fit : null;
  }
  if (visualType === 'shape') {
    v.shape = {
      kind: objectProp(objects, 'shape', 'tileShape') || 'rectangle',
      radius: objectProp(objects, 'shape', 'rectangleRoundedCurve'),
      fill: objectProp(objects, 'fill', 'fillColor'),
      fillShow: objectProp(objects, 'fill', 'show'),
      outlineShow: objectProp(objects, 'outline', 'show'),
      outlineColor: objectProp(objects, 'outline', 'lineColor'),
      outlineWeight: objectProp(objects, 'outline', 'weight'),
      rotation: objectProp(objects, 'rotation', 'shapeAngle'),
    };
  }
  if (visualType === 'cardVisual') {
    v.categoryLabels = objectProp(objects, 'label', 'show') !== false;
    v.card = {
      valueColor: objectProp(objects, 'value', 'fontColor'),
      valueSize: objectProp(objects, 'value', 'fontSize'),
      valueFont: objectProp(objects, 'value', 'fontFamily'),
      labelColor: objectProp(objects, 'label', 'color'),
      labelSize: objectProp(objects, 'label', 'fontSize'),
    };
  }
  if (visualType === 'card' || visualType === 'multiRowCard' || visualType === 'kpi') {
    v.categoryLabels = objectProp(objects, 'categoryLabels', 'show') !== false;
    v.card = {
      valueColor: objectProp(objects, 'labels', 'color'),
      valueSize: objectProp(objects, 'labels', 'fontSize'),
      valueFont: objectProp(objects, 'labels', 'fontFamily'),
      labelColor: objectProp(objects, 'categoryLabels', 'color'),
      labelSize: objectProp(objects, 'categoryLabels', 'fontSize'),
    };
  }
  if (/Chart$|^treemap$|^pieChart$|^donutChart$/.test(visualType)) {
    v.chart = {
      legendShow: objectProp(objects, 'legend', 'show'),
      legendPosition: objectProp(objects, 'legend', 'position'),
      legendColor: objectProp(objects, 'legend', 'labelColor'),
      xShow: objectProp(objects, 'categoryAxis', 'show'),
      xLabelColor: objectProp(objects, 'categoryAxis', 'labelColor'),
      xTitleShow: objectProp(objects, 'categoryAxis', 'showAxisTitle'),
      yShow: objectProp(objects, 'valueAxis', 'show'),
      y2Show: objectProp(objects, 'valueAxis', 'secShow'),
      y2TitleShow: objectProp(objects, 'valueAxis', 'secShowAxisTitle'),
      y2LabelColor: objectProp(objects, 'valueAxis', 'secLabelColor'),
      yLabelColor: objectProp(objects, 'valueAxis', 'labelColor'),
      yTitleShow: objectProp(objects, 'valueAxis', 'showAxisTitle'),
      gridShow: objectProp(objects, 'valueAxis', 'gridlineShow'),
      gridColor: objectProp(objects, 'valueAxis', 'gridlineColor'),
      gridStyle: objectProp(objects, 'valueAxis', 'gridlineStyle'),
      gridWidth: objectProp(objects, 'valueAxis', 'gridlineThickness'),
      lineSmooth: objectProp(objects, 'lineStyles', 'lineChartType'),
      lineMarkers: objectProp(objects, 'lineStyles', 'showMarker'),
      dataLabelsShow: objectProp(objects, 'labels', 'show'),
      dataLabelColor: objectProp(objects, 'labels', 'color'),
      dataLabelStyle: objectProp(objects, 'labels', 'labelStyle'),
      dataLabelPosition: objectProp(objects, 'labels', 'position'),
      // One colour per legend member or per measure.
      seriesColors: selectorProps(objects, 'dataPoint', 'fill'),
      defaultColor: objectProp(objects, 'dataPoint', 'fill'),
    };
  }
  if (visualType === 'tableEx' || visualType === 'pivotTable' || visualType === 'multiRowCard') {
    v.table = {
      valuesColor: objectProp(objects, 'values', 'fontColorPrimary'),
      valuesSize: objectProp(objects, 'values', 'fontSize'),
      valuesFont: objectProp(objects, 'values', 'fontFamily'),
      valuesBold: objectProp(objects, 'values', 'bold'),
      headerColor: objectProp(objects, 'columnHeaders', 'fontColor'),
      headerBg: objectProp(objects, 'columnHeaders', 'backgroundColor'),
      headerSize: objectProp(objects, 'columnHeaders', 'fontSize'),
      headerBold: objectProp(objects, 'columnHeaders', 'bold'),
      gridHorizontal: objectProp(objects, 'grid', 'gridHorizontal'),
      gridVertical: objectProp(objects, 'grid', 'gridVertical'),
      gridColor: objectProp(objects, 'grid', 'gridHorizontalColor'),
      outlineStyle: objectProp(objects, 'grid', 'outlineStyle'),
      stylePreset: objectProp(containerObjects, 'stylePreset', 'name'),
    };
  }
  if (visualType === 'slicer') {
    v.slicer = {
      mode: objectProp(objects, 'data', 'mode') || null,
      startDate: objectProp(objects, 'data', 'startDate') || null,
      endDate: objectProp(objects, 'data', 'endDate') || null,
      singleSelect: objectProp(objects, 'selection', 'singleSelect') === true,
      // 1 = the items side by side (a row of tiles), 0 = the list.
      horizontal: Number(objectProp(objects, 'general', 'orientation')) === 1,
      defaultFilter: objects && objects.general && objects.general[0] && objects.general[0].properties.filter
        ? readFilter({ filter: objects.general[0].properties.filter.filter }) : null,
    };
  }
  return v;
}

// ------------------------------------------------------------------ legacy

function safeJson(s, fallback) {
  if (s == null) return fallback;
  if (typeof s !== 'string') return s;
  try { return JSON.parse(s); } catch { /* malformed embedded JSON — treat as absent */ return fallback; }
}

function readLegacyLayout(layout, theme = EMPTY_THEME) {
  const cfg = safeJson(layout.config, {});
  const pages = [];
  for (const s of layout.sections || []) {
    const sectionCfg = resolveThemeColors(safeJson(s.config, {}), theme);
    const background = objectProp(sectionCfg.objects, 'background', 'color');
    const visuals = [];
    for (const vc of s.visualContainers || []) {
      const c = resolveThemeColors(safeJson(vc.config, {}), theme);
      const sv = c.singleVisual;
      if (!sv) continue;
      const aliases = {};
      for (const fr of (sv.prototypeQuery && sv.prototypeQuery.From) || []) aliases[fr.Name] = fr.Entity;
      const byRef = {};
      for (const sel of (sv.prototypeQuery && sv.prototypeQuery.Select) || []) {
        const f = readField(sel, aliases);
        if (f && sel.Name) byRef[sel.Name] = { ...f, queryRef: sel.Name, displayName: (sv.columnProperties && sv.columnProperties[sel.Name] && sv.columnProperties[sel.Name].displayName) || sel.NativeReferenceName || null };
      }
      const zones = {};
      for (const [zone, projs] of Object.entries(sv.projections || {})) {
        zones[zone] = (projs || []).map((p) => (byRef[p.queryRef] ? { ...byRef[p.queryRef], active: !!p.active } : null)).filter(Boolean);
      }
      const common = readVisualCommon(sv.visualType, sv.objects, sv.vcObjects);
      visuals.push({
        id: c.name || vc.id || `v${visuals.length}`,
        type: sv.visualType,
        x: vc.x, y: vc.y, w: vc.width, h: vc.height, z: vc.z || 0,
        zones,
        filters: (safeJson(vc.filters, []) || []).map(readFilter).filter(Boolean),
        orderBy: readLegacyOrderBy(sv.prototypeQuery && sv.prototypeQuery.OrderBy, aliases),
        hidden: !!(sv.display && sv.display.mode === 'hidden'),
        crossFilter: sv.drillFilterOtherVisuals !== false,
        ...common,
      });
    }
    pages.push({
      id: s.name, name: s.displayName || s.name,
      width: s.width || 1280, height: s.height || 720,
      hidden: s.displayOption === 3 || (sectionCfg.visibility === 1),
      background: typeof background === 'string' ? background : null,
      filters: (safeJson(s.filters, []) || []).map(readFilter).filter(Boolean),
      visuals,
    });
  }
  return {
    format: 'legacy',
    version: cfg.version || null,
    reportFilters: (safeJson(layout.filters, []) || []).map(readFilter).filter(Boolean),
    pages,
  };
}

// -------------------------------------------------------------------- PBIR

function readPbirReport(readJson, list, theme = EMPTY_THEME) {
  const root = 'Report/definition';
  const pagesMeta = readJson(`${root}/pages/pages.json`) || { pageOrder: [] };
  const report = readJson(`${root}/report.json`) || {};
  const pages = [];
  const order = pagesMeta.pageOrder || [];
  for (const pid of order) {
    const page = resolveThemeColors(readJson(`${root}/pages/${pid}/page.json`) || {}, theme);
    const background = objectProp(page.objects, 'background', 'color');
    const visuals = [];
    const prefix = `${root}/pages/${pid}/visuals/`;
    const files = list(prefix).filter((k) => k.endsWith('/visual.json'));
    for (const file of files) {
      const v = resolveThemeColors(readJson(file), theme);
      if (!v || !v.visual) continue; // visual groups carry no query of their own
      const vis = v.visual;
      const zones = {};
      const qs = (vis.query && vis.query.queryState) || {};
      for (const [zone, z] of Object.entries(qs)) {
        zones[zone] = (z.projections || []).map((p) => {
          const f = readField(p.field);
          return f ? { ...f, queryRef: p.queryRef, displayName: p.displayName || p.nativeQueryRef || null, active: !!p.active } : null;
        }).filter(Boolean);
      }
      const pos = v.position || {};
      const common = readVisualCommon(vis.visualType, vis.objects, vis.visualContainerObjects);
      visuals.push({
        id: v.name || file.split('/').slice(-2)[0],
        type: vis.visualType,
        x: pos.x || 0, y: pos.y || 0, w: pos.width || 100, h: pos.height || 100, z: pos.z || 0,
        zones,
        filters: ((v.filterConfig && v.filterConfig.filters) || []).map(readFilter).filter(Boolean),
        orderBy: readPbirOrderBy(vis.query),
        hidden: !!v.isHidden,
        crossFilter: vis.drillFilterOtherVisuals !== false,
        ...common,
      });
    }
    pages.push({
      id: page.name || pid, name: page.displayName || pid,
      width: page.width || 1280, height: page.height || 720,
      hidden: page.visibility === 'HiddenInViewMode',
      background: typeof background === 'string' ? background : null,
      filters: ((page.filterConfig && page.filterConfig.filters) || []).map(readFilter).filter(Boolean),
      visuals,
    });
  }
  return {
    format: 'pbir',
    version: (readJson(`${root}/version.json`) || {}).version || null,
    reportFilters: ((report.filterConfig && report.filterConfig.filters) || []).map(readFilter).filter(Boolean),
    pages,
  };
}

// The theme collection lives in the report config (legacy) or report.json
// (PBIR); the theme files themselves in StaticResources.
function readReport(pbit) {
  if (pbit.reportFormat === 'pbir') {
    const reportJson = pbit.readJson('Report/definition/report.json') || {};
    const theme = loadTheme(pbit, reportJson.themeCollection);
    return { ...readPbirReport(pbit.readJson, pbit.list, theme), theme };
  }
  if (pbit.reportFormat === 'legacy') {
    const layout = pbit.readJson('Report/Layout');
    const theme = loadTheme(pbit, safeJson(layout.config, {}).themeCollection);
    return { ...readLegacyLayout(layout, theme), theme };
  }
  return { format: null, version: null, reportFilters: [], pages: [], theme: EMPTY_THEME };
}

module.exports = { readReport, readLegacyLayout, readPbirReport, parseLiteral, readField, readFilter, objectProp, selectorProps };
