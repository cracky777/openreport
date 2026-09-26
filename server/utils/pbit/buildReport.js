// Neutral report description → an OpenReport report bundle
// (format 'open-report.report.v1', the shape POST /api/reports/import takes).
// Positions carry over 1:1 in pixels; each Power BI visual type maps to the
// closest widget, and anything without an equivalent becomes a text
// placeholder at the same spot so the page keeps its layout.
const { v4: uuidv4 } = require('uuid');
const { readField } = require('./reportLayout');
const { themeStyle, textClass, EMPTY_THEME } = require('./theme');

// Power BI visualType → OpenReport widget type + config
const VISUAL_MAP = {
  card: { type: 'scorecard' },
  cardVisual: { type: 'scorecard' },
  kpi: { type: 'scorecard' },
  multiRowCard: { type: 'table' },
  tableEx: { type: 'table' },
  pivotTable: { type: 'pivotTable' },
  slicer: { type: 'filter' },
  textbox: { type: 'text' },
  image: { type: 'image' },
  shape: { type: 'shape' },
  basicShape: { type: 'shape' },
  clusteredBarChart: { type: 'bar', config: { subType: 'grouped', barDirection: 'horizontal' } },
  clusteredColumnChart: { type: 'bar', config: { subType: 'grouped', barDirection: 'vertical' } },
  barChart: { type: 'bar', config: { subType: 'stacked', barDirection: 'horizontal' } },
  columnChart: { type: 'bar', config: { subType: 'stacked', barDirection: 'vertical' } },
  stackedBarChart: { type: 'bar', config: { subType: 'stacked', barDirection: 'horizontal' } },
  stackedColumnChart: { type: 'bar', config: { subType: 'stacked', barDirection: 'vertical' } },
  hundredPercentStackedBarChart: { type: 'bar', config: { subType: 'stacked100', barDirection: 'horizontal' } },
  hundredPercentStackedColumnChart: { type: 'bar', config: { subType: 'stacked100', barDirection: 'vertical' } },
  lineChart: { type: 'line', config: { subType: 'line' } },
  areaChart: { type: 'line', config: { subType: 'area' } },
  stackedAreaChart: { type: 'line', config: { subType: 'stackedArea' } },
  hundredPercentStackedAreaChart: { type: 'line', config: { subType: 'stackedArea100' } },
  lineStackedColumnComboChart: { type: 'combo', config: { subType: 'stackedCombo' } },
  lineClusteredColumnComboChart: { type: 'combo', config: { subType: 'clusteredCombo' } },
  pieChart: { type: 'pie' },
  donutChart: { type: 'pie' },
  scatterChart: { type: 'scatter' },
  treemap: { type: 'treemap' },
  gauge: { type: 'gauge', config: { subType: 'arc' } },
};

// Which Power BI field wells feed which OpenReport zones, per widget type.
const ZONES = {
  scorecard: { measures: ['Values', 'Data', 'Indicator', 'Y'] },
  table: { dims: ['Values', 'Rows'], measures: ['Values'] },
  pivotTable: { dims: ['Rows'], columns: ['Columns'], measures: ['Values'] },
  filter: { dims: ['Values', 'Field'] },
  bar: { dims: ['Category'], legend: ['Series'], measures: ['Y'] },
  line: { dims: ['Category'], legend: ['Series'], measures: ['Y'] },
  combo: { dims: ['Category'], legend: ['Series'], bar: ['Y'], line: ['Y2'] },
  pie: { dims: ['Category'], legend: [], measures: ['Y'] },
  scatter: { dims: ['Category', 'Details'], legend: ['Series'], x: ['X'], y: ['Y'], size: ['Size'] },
  treemap: { dims: ['Group', 'Details'], measures: ['Values', 'Y'] },
  gauge: { measures: ['Y'], max: ['MaxValue'], target: ['TargetValue'] },
};

// pt → px for text runs ("12pt" → 16)
const ptToPx = (pt) => { const n = parseFloat(String(pt || '')); return Number.isFinite(n) ? Math.round(n * 4 / 3) : null; };

// "'''Lucida Sans Unicode'''" → Lucida Sans Unicode (a font name a template
// quotes once more than a literal needs).
const fontName = (v) => (typeof v === 'string' ? v.replace(/^'+|'+$/g, '') : null);

// Power BI's built-in families ("wf_standard-font", "DIN", "Segoe UI"…) are
// not web fonts: a widget fed their name would ask Google Fonts for nothing.
// Only the weight the name implies is kept for those; a real family passes.
const PBI_FONTS = /^(wf_standard-font|din|segoe|arial|helvetica|calibri|cambria|candara|consolas|constantia|corbel|georgia|tahoma|trebuchet|verdana|times)/i;
function fontFace(raw) {
  const first = String(fontName(raw) || '').split(',')[0].trim().replace(/^'+|'+$/g, '');
  if (!first) return { weight: null, family: null };
  const weight = /light/i.test(first) ? 300 : /semibold/i.test(first) ? 600 : /bold|black/i.test(first) ? 700 : 400;
  const family = PBI_FONTS.test(first) ? null : first.replace(/[\s_-]+(light|semibold|bold|black)$/i, '');
  return { weight, family };
}

// How a date prints in the template's culture: the card of a date column
// shows "30/09/2026" to a French reader, "09/30/2026" to an American one.
function cultureDateFormat(culture) {
  const c = String(culture || '').toLowerCase();
  if (!c) return null;
  if (c === 'en-us') return 'MM/dd/yyyy';
  if (/^(ja|zh|ko|hu|lt|sv|en-ca)/.test(c)) return 'yyyy-MM-dd';
  if (/^(de|ru|pl|cs|sk|fi|nb|nn|da|tr|ro|uk)/.test(c)) return 'dd.MM.yyyy';
  return 'dd/MM/yyyy';
}

// How the picture fills its box: the newer `fit` property first, the legacy
// scaling next. Stretch ignores the ratio, Fill crops, the rest keeps it whole.
function imageFit(fit, scaling) {
  const v = fit || scaling;
  if (v === 'Stretch') return 'fill';
  if (v === 'Fill') return 'cover';
  return 'contain';
}

// A Power BI text run's style → an OpenReport run.
function runStyle(style, defaults) {
  const out = {};
  if (!style) return out;
  if (style.fontWeight === 'bold') out.bold = true;
  if (style.fontStyle === 'italic') out.italic = true;
  if (style.textDecoration === 'underline') out.underline = true;
  if (typeof style.color === 'string' && style.color !== defaults.color) out.color = style.color;
  const px = ptToPx(style.fontSize);
  if (px && px !== defaults.fontSize) out.fontSize = px;
  return out;
}

// A card's value shrinks to its box in Power BI; the same size here would
// spill. Cap by the box rather than trust the point size alone.
const cardValueSize = (px, w, h) => Math.max(10, Math.min(px, Math.round(Math.min(h * 0.45, w * 0.24))));

const LEGEND_POSITION = { top: 'top', topcenter: 'top', bottom: 'bottom', bottomcenter: 'bottom', left: 'left', leftcenter: 'left', right: 'right', rightcenter: 'right' };

const CMP_KIND = { 0: 'eq', 1: 'gt', 2: 'gte', 3: 'lt', 4: 'lte' };

// A relative date window ("last 30 days", "last 12 months") → the OpenReport
// time preset that means the same. Power BI bounds are DateSpan(DateAdd(Now,
// -N, unit)); TimeUnit 0 day, 1 week, 2 month, 3 year. Anything else has no
// preset and stays a warning.
function relativePreset(between) {
  const lower = between && between.LowerBound && between.LowerBound.DateSpan && between.LowerBound.DateSpan.Expression;
  const add = lower && lower.DateAdd;
  if (!add || !add.Expression || !add.Expression.Now) return null;
  const n = Math.abs(Number(add.Amount) || 0);
  const unit = Number(add.TimeUnit);
  if (unit === 0 && [7, 30, 90].includes(n)) return `last_${n}_days`;
  if (unit === 1 && n === 1) return 'last_7_days';
  if (unit === 2 && (n === 12 || n === 13)) return 'last_12_months';
  if (unit === 3 && n === 1) return 'last_12_months';
  return null;
}

function objectShow(objects, objName) {
  const e = objects && objects[objName] && objects[objName][0];
  const show = e && e.properties && e.properties.show && e.properties.show.expr && e.properties.show.expr.Literal;
  return !(show && String(show.Value) === 'false');
}

function buildReport(report, model, opts = {}) {
  const warnings = [];
  const warn = (code, message, extra = {}) => warnings.push({ level: 'warn', scope: 'report', code, message, ...extra });
  const info = (code, message, extra = {}) => warnings.push({ level: 'info', scope: 'report', code, message, ...extra });
  const resources = new Set();
  // Third-party visuals the template uses (type id → display name), and
  // how many times each one appears on the pages: they are not imported,
  // and the author is told so in one place.
  const customVisualNames = opts.customVisuals || {};
  const customUses = new Map();
  const theme = report.theme || EMPTY_THEME;
  const labelColor = textClass(theme, 'label').color || theme.foreground;
  const callout = textClass(theme, 'callout');
  const dataColors = (theme.dataColors || []).slice(0, 15);
  const dateFormat = cultureDateFormat(opts.culture);
  // "Every visual background is transparent" is a theme-level setting the
  // visuals themselves do not repeat.
  const themeTransparent = (visualType) => themeStyle(theme, visualType, 'background', 'transparency') === 100
    || themeStyle(theme, visualType, 'background', 'show') === false;

  // A Power BI field reference → an OpenReport field name (dimension or measure).
  // Returns { name, isMeasure } or null (with a warning).
  // The fact tables of the visual being built: what its aggregations read.
  let visualFacts = null;
  const fieldName = (f, where) => {
    if (!f) return null;
    if (f.kind === 'measure') {
      const name = model.resolveMeasure(f.property);
      if (!name) { warn('missing_measure', `${where}: measure [${f.property}] not found in the model.`); return null; }
      return { name, isMeasure: true };
    }
    if (f.kind === 'aggregation') {
      const name = model.ensureAggMeasure(f.entity, f.property, f.fn);
      if (!name) { warn('missing_field', `${where}: ${f.entity}[${f.property}] is not a database column (calculated column or skipped table).`); return null; }
      return { name, isMeasure: true };
    }
    if (f.kind === 'dateLevel') {
      const r = model.ensureDateLevel(f.entity, f.property, f.level);
      if (!r) { warn('missing_field', `${where}: ${f.entity}[${f.property}] not found.`); return null; }
      if (r.fallback) info('date_level', `${where}: "${f.level}" level of ${f.entity}[${f.property}] shown as the raw date — add date parts on that column in OpenReport if needed.`);
      return { name: r.dimName, isMeasure: false };
    }
    if (f.kind === 'group') info('pbi_group', `${where}: Power BI group "${f.groupName}" replaced by its underlying column ${f.entity}[${f.property}].`);
    if (f.kind === 'hierarchyLevel') { warn('hierarchy', `${where}: hierarchy level "${f.level}" of ${f.entity} not imported.`); return null; }
    const col = model.resolveColumn(f.entity, f.property, visualFacts);
    if (!col) { warn('missing_field', `${where}: ${f.entity}[${f.property}] is not a database column (calculated column or skipped table).`); return null; }
    return { name: col.dimName, isMeasure: false };
  };

  const literal = (node) => {
    if (!node) return undefined;
    if (node.Literal) {
      const v = node.Literal.Value;
      const s = String(v);
      if (/^'.*'$/s.test(s)) return s.slice(1, -1).replace(/''/g, "'");
      if (s === 'null') return null;
      if (s === 'true' || s === 'false') return s;
      const dt = s.match(/^datetime'([^']*)'$/);
      if (dt) return dt[1].slice(0, 10);
      const n = s.match(/^(-?[0-9.]+)[DLM]?$/);
      if (n) return n[1];
      return s;
    }
    return undefined;
  };

  // A filter condition → widget/report filter rules
  const rulesFromFilter = (flt, where) => {
    if (!flt || !flt.hasCondition) return [];
    const target = fieldName(flt.field, where);
    if (!target) return [];
    const base = { field: target.name, isMeasure: target.isMeasure, value: '', values: [] };
    const cond = flt.condition;
    const out = [];
    const walk = (c, negate) => {
      if (!c) return;
      if (c.Not) return walk(c.Not.Expression, !negate);
      if (c.And) { walk(c.And.Left, negate); walk(c.And.Right, negate); return; }
      if (c.In && c.In.Table && !c.In.Values) {
        const sub = (flt.from || []).find((fr) => fr.Expression && fr.Expression.Subquery);
        const q = sub && sub.Expression.Subquery.Query;
        const ob = q && Array.isArray(q.OrderBy) ? q.OrderBy[0] : null;
        const subAliases = {};
        for (const fr of (q && q.From) || []) if (fr.Entity) subAliases[fr.Name] = fr.Entity;
        const mf = ob && readField(ob.Expression, subAliases);
        const m = mf ? fieldName(mf, where) : null;
        if (!m || !q.Top) { warn('filter_skipped', `${where}: Top N filter skipped (measure not found).`); return; }
        out.push({ field: m.name, isMeasure: true, op: ob.Direction === 1 ? 'bottom_n' : 'top_n', value: String(q.Top), values: [] });
        return;
      }
      if (c.In) {
        const values = (c.In.Values || []).map((row) => literal(row[0])).filter((v) => v !== undefined && v !== null).map(String);
        const hasNull = (c.In.Values || []).some((row) => literal(row[0]) === null);
        if (values.length) out.push({ ...base, op: negate ? 'not_in' : 'in', values });
        if (hasNull) out.push({ ...base, op: negate ? 'is_not_empty' : 'is_empty' });
        return;
      }
      if (c.Comparison) {
        const v = literal(c.Comparison.Right);
        let op = CMP_KIND[c.Comparison.ComparisonKind] || 'eq';
        if (v === null) { out.push({ ...base, op: negate ? 'is_not_empty' : 'is_empty' }); return; }
        if (v === undefined) { warn('filter_skipped', `${where}: comparison to a non-literal value skipped.`); return; }
        if (negate) op = { eq: 'neq', gt: 'lte', gte: 'lt', lt: 'gte', lte: 'gt' }[op];
        out.push({ ...base, op, value: String(v) });
        return;
      }
      if (c.Between) {
        const lo = literal(c.Between.LowerBound); const hi = literal(c.Between.UpperBound);
        if (lo === undefined || hi === undefined) {
          // A preset only makes sense on a date column.
          const preset = !target.isMeasure && isDateDim(target.name) ? relativePreset(c.Between) : null;
          if (preset) {
            out.push({ _timePeriod: { dim: target.name, preset } });
            info('relative_date_preset', `${where}: relative date filter imported as the "${preset}" period.`);
            return;
          }
          info('relative_date_filter', `${where}: relative date filter not imported — OpenReport filters on explicit dates or time presets.`);
          return;
        }
        out.push({ ...base, op: 'between', values: [String(lo), String(hi)] });
        return;
      }
      if (c.Contains) { const v = literal(c.Contains.Right); if (v !== undefined) out.push({ ...base, op: negate ? 'not_contains' : 'contains', value: String(v) }); return; }
      if (c.StartsWith) { const v = literal(c.StartsWith.Right); if (v !== undefined) out.push({ ...base, op: 'starts_with', value: String(v) }); return; }
      if (c.TopN) {
        const ob = (c.TopN.OrderBy || [])[0];
        const mf = ob && readField(ob.Expression, flt.aliases);
        const m = mf ? fieldName(mf, where) : null;
        if (!m) { warn('filter_skipped', `${where}: Top N filter skipped (measure not found).`); return; }
        out.push({ field: m.name, isMeasure: true, op: ob.Direction === 1 ? 'bottom_n' : 'top_n', value: String(c.TopN.ItemCount || 10), values: [] });
        return;
      }
      warn('filter_skipped', `${where}: filter of kind ${Object.keys(c)[0]} not imported.`);
    };
    walk(cond, false);
    return out;
  };

  const pages = [];
  let pageWidth = 0;
  let pageHeight = 0;
  let unsupported = 0;
  let visualCount = 0;
  const promotedPageRules = [];
  // OpenReport measure name → visuals bound to it while it is a draft.
  const draftUses = new Map();
  const isDraft = (name) => {
    const m = (model.fields().measures || []).find((x) => x.name === name);
    return !!m && /^DRAFT/.test(String(m.description || ''));
  };
  const isDateDim = (name) => {
    const d = (model.fields().dimensions || []).find((x) => x.name === name);
    return !!d && /date|time/i.test(String(d.type || ''));
  };
  // Tables sort by column label — the label a field carries in the model.
  const labelOf = (name) => {
    const f = model.fields();
    const hit = (f.measures || []).find((m) => m.name === name) || (f.dimensions || []).find((d) => d.name === name);
    return (hit && hit.label) || name;
  };

  report.pages.forEach((page, pi) => {
    const pageId = `page-${pi + 1}`;
    const layout = [];
    const widgets = {};
    pageWidth = Math.max(pageWidth, Math.round(page.width || 0));
    pageHeight = Math.max(pageHeight, Math.round(page.height || 0));
    // A single-page report's page filters are really report filters; on a
    // multi-page report they are pinned onto each widget of that page.
    // A slicer hidden from the reader with a selection baked in is how a
    // Power BI page is filtered without showing it: that selection is a
    // page filter here.
    const hiddenSlicerRules = page.visuals.flatMap((v) => {
      const df = v.hidden && v.type === 'slicer' && v.slicer ? v.slicer.defaultFilter : null;
      if (!df || !df.hasCondition) return [];
      const cond = df.condition || {};
      const expr = cond.In ? (cond.In.Expressions || [])[0] : cond.Comparison ? cond.Comparison.Left : null;
      const field = expr ? readField(expr, df.aliases) : null;
      if (!field) return [];
      const rules = rulesFromFilter({ ...df, field }, `Page "${page.name}", hidden slicer`);
      if (rules.length) info('hidden_slicer', `Page "${page.name}": the selection of a hidden slicer on ${field.entity}[${field.property}] is imported as a page filter.`);
      return rules;
    });
    const pageFilterRules = [...page.filters.flatMap((f) => rulesFromFilter(f, `Page "${page.name}"`)), ...hiddenSlicerRules];
    const pageRules = report.pages.length === 1 ? [] : pageFilterRules;
    if (report.pages.length === 1) promotedPageRules.push(...pageFilterRules);
    const ordered = [...page.visuals].sort((a, b) => (a.z || 0) - (b.z || 0));

    for (const v of ordered) {
      if (v.hidden) continue;
      // Parked outside the page: Power BI never shows it, neither do we.
      if (page.width && page.height && (v.x >= page.width || v.y >= page.height)) {
        info('offpage_visual', `Page "${page.name}", ${v.type} sits outside the page and is not imported.`);
        continue;
      }
      visualCount += 1;
      const where = `Page "${page.name}", ${v.type}${v.title ? ` "${v.title}"` : ''}`;
      visualFacts = new Set(Object.values(v.zones || {}).flat().filter((f) => f && f.kind === 'aggregation').map((f) => f.entity));
      const map = VISUAL_MAP[v.type];
      const id = uuidv4();
      const config = { ...(map && map.config ? map.config : {}) };
      const widget = { type: map ? map.type : 'text', config };
      if (v.title) config.title = v.title;
      const transparent = v.backgroundHidden || themeTransparent(v.type);
      if (transparent) config.transparentBg = true;
      else if (typeof v.backgroundColor === 'string') config.backgroundColor = v.backgroundColor;
      // Power BI draws no frame unless asked; the widget's default border
      // would box every visual of the page.
      config.borderEnabled = v.borderShow === true;
      if (typeof v.borderRadius === 'number') config.borderRadius = v.borderRadius;

      if (!map) {
        unsupported += 1;
        const customName = customVisualNames[v.type];
        if (customName) {
          // A custom visual is code from another publisher: OpenReport has
          // no way to run it. One alert per visual, however many pages use it.
          customUses.set(v.type, (customUses.get(v.type) || 0) + 1);
        } else {
          warn('unsupported_visual', `${where}: no OpenReport equivalent — a placeholder text block keeps its place.`, { visualType: v.type });
        }
        widget.data = { text: customName ? `Custom visual "${customName}" is not imported` : `Power BI visual "${v.type}" is not supported` };
        config.fontSize = 12;
        config.color = labelColor;
        config.italic = true;
        config.transparentBg = true;
        config.borderEnabled = false;
      } else if (widget.type === 'text') {
        const tb = v.textbox;
        // Box-level defaults from the first styled run, the theme's label
        // class behind them (a text box's default size is 10 pt); a run only
        // records what differs from those.
        const style = (tb && tb.style) || {};
        config.fontSize = ptToPx(style.fontSize) || 13;
        config.color = typeof style.color === 'string' ? style.color : labelColor;
        if (fontFace(style.fontFamily).family) config.fontFamily = fontFace(style.fontFamily).family;
        const defaults = { color: config.color, fontSize: config.fontSize };
        widget.data = { text: tb ? tb.text : '' };
        if (tb && tb.runs && tb.runs.length) widget.data.runs = tb.runs.map((r) => ({ text: r.text, ...runStyle(r.style, defaults) }));
        config.textAlign = tb && tb.align === 'center' ? 'center' : tb && tb.align === 'right' ? 'flex-end' : 'flex-start';
        config.verticalAlign = 'flex-start';
        config.transparentBg = true;
        config.borderEnabled = false;
      } else if (widget.type === 'image') {
        config.fit = imageFit(v.imageFit, v.imageScaling);
        config.transparentBg = true;
        config.borderEnabled = false;
        if (v.image) { config.url = ''; config.pbitResource = v.image; resources.add(v.image); }
        else config.url = '';
      } else if (widget.type === 'shape') {
        const sh = v.shape || {};
        const kind = String(sh.kind || 'rectangle');
        config.shape = /oval|ellipse|circle/i.test(kind) ? 'round' : /line/i.test(kind) ? 'line' : /arrow/i.test(kind) ? 'arrow' : 'square';
        // A shape with no fill of its own wears the first data colour.
        const fill = typeof sh.fill === 'string' ? sh.fill : (dataColors[0] || null);
        if (fill) { config.backgroundColor = fill; config.shapeFill = fill; }
        const outline = typeof sh.outlineColor === 'string' ? sh.outlineColor : null;
        if (config.shape === 'line') {
          // The line IS the outline: nothing behind it, no frame around it.
          // It turns on itself inside its box (a slash between two figures),
          // where turning the box would swing the whole line out of it.
          config.transparentBg = true;
          config.borderEnabled = false;
          config.lineColor = outline || fill;
          config.lineThickness = typeof sh.outlineWeight === 'number' ? Math.max(1, sh.outlineWeight) : 1;
          if (typeof sh.rotation === 'number' && sh.rotation) config.lineRotation = sh.rotation;
        } else if (config.shape === 'arrow') {
          // The arrow is the drawing; its box shows nothing.
          config.transparentBg = true;
          config.borderEnabled = false;
          config.shapeStroke = outline || fill;
          if (typeof sh.outlineWeight === 'number') config.shapeStrokeWidth = sh.outlineWeight;
        } else {
          config.transparentBg = sh.fillShow === false;
          config.borderEnabled = sh.outlineShow === true;
          if (outline) { config.borderColor = outline; config.shapeStroke = outline; }
          if (typeof sh.outlineWeight === 'number') config.shapeStrokeWidth = sh.outlineWeight;
        }
        if (typeof sh.radius === 'number') config.borderRadius = sh.radius;
        if (typeof sh.rotation === 'number' && sh.rotation && config.shape !== 'line') config.rotation = sh.rotation;
      } else {
        const zones = ZONES[widget.type] || {};
        // A date hierarchy expanded down to the day is the date itself: one
        // axis of dates, not a drill from the year. Shallower expansions keep
        // their levels (year, then month…) as a drill.
        const dayLevel = (f) => f.kind === 'dateLevel' && /^(day|jour)$/i.test(String(f.level || ''));
        const collapse = (fields) => {
          const out = [];
          for (const f of fields) {
            if (f.kind === 'dateLevel') {
              const group = fields.filter((g) => g.kind === 'dateLevel' && g.entity === f.entity && g.property === f.property);
              if (group.some((g) => g.active && dayLevel(g))) {
                if (!out.some((o) => o.kind === 'column' && o.entity === f.entity && o.property === f.property)) out.push({ kind: 'column', entity: f.entity, property: f.property, displayName: f.displayName });
                continue;
              }
            }
            out.push(f);
          }
          return out;
        };
        const pick = (keys) => collapse((keys || []).flatMap((k) => v.zones[k] || []));
        const names = (fields, wantMeasure) => fields.map((f) => fieldName(f, where)).filter((x) => x && (wantMeasure === undefined || x.isMeasure === wantMeasure)).map((x) => x.name);
        const binding = {};
        if (zones.dims) binding.selectedDimensions = [...new Set(names(pick(zones.dims), false))];
        if (zones.measures) binding.selectedMeasures = [...new Set(names(pick(zones.measures), true))];
        if (widget.type === 'table') {
          // Power BI tables mix columns and measures in one well; split them.
          const all = pick(zones.dims).map((f) => fieldName(f, where)).filter(Boolean);
          binding.selectedDimensions = [...new Set(all.filter((x) => !x.isMeasure).map((x) => x.name))];
          binding.selectedMeasures = [...new Set(all.filter((x) => x.isMeasure).map((x) => x.name))];
        }
        if (zones.columns) binding.columnDimensions = [...new Set(names(pick(zones.columns), false))];
        if (zones.legend) { const g = names(pick(zones.legend), false); if (g.length) binding.groupBy = g.slice(0, 1); }
        if (widget.type === 'combo') {
          binding.comboBarMeasures = [...new Set(names(pick(zones.bar), true))];
          binding.comboLineMeasures = [...new Set(names(pick(zones.line), true))];
          binding.selectedMeasures = [...new Set([...binding.comboBarMeasures, ...binding.comboLineMeasures])];
        }
        if (widget.type === 'scatter') {
          const x = names(pick(zones.x), true)[0]; const y = names(pick(zones.y), true)[0]; const size = names(pick(zones.size), true)[0];
          binding.scatterMeasures = { ...(x ? { x } : {}), ...(y ? { y } : {}), ...(size ? { size } : {}) };
          binding.selectedMeasures = [x, y, size].filter(Boolean);
        }
        if (widget.type === 'gauge') {
          const mx = names(pick(zones.max), true)[0]; const tg = names(pick(zones.target), true)[0];
          if (mx) binding.gaugeMaxMeasure = mx;
          if (tg) binding.gaugeThresholdMeasure = tg;
        }
        if (widget.type === 'scorecard') {
          const first = pick(zones.measures)[0];
          if (v.categoryLabels && first && first.displayName) config.label = first.displayName;
          if (!v.categoryLabels) config.showLabel = false;
          binding.selectedMeasures = (binding.selectedMeasures || []).slice(0, 1);
          // A card of "(X − X N-1) ÷ X" shows X's native % evolution line, and
          // nothing else: the same figure, computed by OpenReport.
          const evo = first && first.kind === 'measure' && typeof model.resolveEvolution === 'function' ? model.resolveEvolution(first.property) : null;
          if (evo) {
            binding.selectedMeasures = [evo.base];
            binding.compareDateDim = evo.dateDim;
            config.showValue = false;
            config.showN1Percent = true;
            info('evolution_card', `${where}: shows the N-1 % evolution of its base measure (Power BI measure "${first.property}").`);
          }
          // Value and label as the card paints them: its own colours and
          // sizes, the theme's callout / label classes otherwise.
          const card = v.card || {};
          config.valueColor = typeof card.valueColor === 'string' ? card.valueColor : (callout.color || labelColor);
          config.valueSize = cardValueSize(ptToPx(card.valueSize || callout.fontSize || 45), v.w, v.h);
          // A Power BI card prints its figure in a regular weight ("DIN"), a
          // light one when the template says so; OpenReport's default is bold.
          const face = fontFace(card.valueFont || callout.fontFamily);
          config.valueWeight = face.weight || 400;
          if (face.family) config.valueFontFamily = face.family;
          if (dateFormat) config.dateFormat = dateFormat;
          config.labelColor = typeof card.labelColor === 'string' ? card.labelColor : labelColor;
          config.labelSize = ptToPx(card.labelSize) || 13;
          config.labelPosition = 'below';
          if (evo) {
            // The % line takes the value's place: its size, its colour, no
            // caption and no arrow, as the card printed it.
            config.n1PercentStyle = { base: evo.divideBy, position: 'bottom', label: '', iconEnabled: false, textColorEnabled: true, positiveColor: config.valueColor, negativeColor: config.valueColor, fontSize: config.valueSize };
          }
        }
        if (v.chart) {
          const c = v.chart;
          config.showLegend = c.legendShow !== false;
          const pos = typeof c.legendPosition === 'string' ? LEGEND_POSITION[c.legendPosition.toLowerCase()] : null;
          if (pos) config.legendPosition = pos;
          config.legendTextColor = typeof c.legendColor === 'string' ? c.legendColor : labelColor;
          if (c.xShow === false) config.showXAxis = false;
          if (c.yShow === false) config.showYAxis = false;
          if (c.y2Show === false) config.showSecondaryAxis = false;
          config.xAxisLabelColor = typeof c.xLabelColor === 'string' ? c.xLabelColor : labelColor;
          config.yAxisLabelColor = typeof c.yLabelColor === 'string' ? c.yLabelColor : labelColor;
          config.secondaryYAxisLabelColor = typeof c.y2LabelColor === 'string' ? c.y2LabelColor : config.yAxisLabelColor;
          // Power BI pages of this kind show no axis title unless one was
          // switched on; the theme's default says otherwise but the page wins.
          config.showXAxisTitle = c.xTitleShow === true;
          config.showYAxisTitle = c.yTitleShow === true;
          config.showSecondaryYAxisTitle = (c.y2TitleShow !== undefined ? c.y2TitleShow : c.yTitleShow) === true;
          // The category order: the visual's own sort when it is on the axis
          // field, ascending otherwise — a Power BI axis without a sort reads
          // in its natural order, where OpenReport would rank by value.
          if (widget.type === 'bar' || widget.type === 'line' || widget.type === 'combo') {
            const first = (binding.selectedDimensions || [])[0];
            const ob = (v.orderBy || [])[0];
            const obTarget = ob ? fieldName(ob.field, where) : null;
            if (first && (!obTarget || obTarget.name === first)) config.zoneSorts = { axis: obTarget ? ob.direction : 'asc' };
          }
          if (typeof c.gridColor === 'string') config.gridLineColor = c.gridColor;
          if (typeof c.gridStyle === 'string') config.gridLineStyle = ({ dashed: 'dashed', dotted: 'dotted' })[c.gridStyle] || 'solid';
          if (typeof c.gridWidth === 'number' && c.gridWidth > 0) config.gridLineWidth = Math.min(c.gridWidth, 3);
          if (widget.type === 'line' || widget.type === 'combo') {
            // Power BI draws a straight line without markers unless told otherwise.
            config.smooth = c.lineSmooth === 'smooth';
            config.lineSymbol = c.lineMarkers === true ? 'circle' : 'none';
          }
          config.xAxisLabelRotate = 0;
          config.showDataLabels = c.dataLabelsShow === true;
          if (typeof c.dataLabelColor === 'string') config.dataLabelColor = c.dataLabelColor;
          if (widget.type === 'pie') {
            // What a slice's label says: Power BI's "Both" is name and value.
            const style = { Both: 'nameValue', Category: 'name', Data: 'value', Percent: 'percent', 'Percent of total': 'percent' }[String(c.dataLabelStyle || '')];
            if (style) config.dataLabelContent = style;
            if (c.dataLabelPosition === 'inside') config.dataLabelPosition = 'inside';
          }
          // Series colours: by legend member, or by measure (its label is
          // the Power BI name); the theme's data colours for the rest.
          const legendColors = {};
          for (const sc of c.seriesColors || []) {
            if (sc.member != null) legendColors[String(sc.member)] = sc.value;
            else if (sc.metadata) legendColors[sc.metadata.replace(/^[^.]*\./, '')] = sc.value;
          }
          if (widget.type === 'combo') {
            // The line measures take the palette colours the bars left free.
            const used = new Set(Object.values(legendColors).map((x) => String(x).toLowerCase()));
            const free = dataColors.filter((x) => !used.has(String(x).toLowerCase()));
            (binding.comboLineMeasures || []).forEach((mn, i) => {
              const label = labelOf(mn);
              if (!legendColors[label] && free[i]) legendColors[label] = free[i];
            });
          } else if ((binding.selectedDimensions || []).length < 2 && (binding.selectedMeasures || []).length > 1) {
            // Several measures and no legend field: each measure is a series,
            // and Power BI paints the i-th one with the i-th theme colour
            // unless the template picked one for it.
            binding.selectedMeasures.forEach((mn, i) => {
              const label = labelOf(mn);
              if (!legendColors[label] && dataColors[i % dataColors.length]) legendColors[label] = dataColors[i % dataColors.length];
            });
          }
          if (Object.keys(legendColors).length) config.legendColors = legendColors;
          // A lone measure is drawn in `color`: the colour the template gave
          // that measure, else the visual's default, else the theme's first.
          const lone = (binding.selectedMeasures || []).length === 1 ? legendColors[labelOf(binding.selectedMeasures[0])] : null;
          if (typeof lone === 'string') config.color = lone;
          else if (typeof c.defaultColor === 'string') config.color = c.defaultColor;
          else if (dataColors.length) config.color = dataColors[0];
          if (dataColors.length) config.palette = dataColors;
        }
        if (v.table && (widget.type === 'table' || widget.type === 'pivotTable')) {
          const t = v.table;
          const values = { fontColor: typeof t.valuesColor === 'string' ? t.valuesColor : labelColor, fontSize: ptToPx(t.valuesSize) || 13 };
          if (fontFace(t.valuesFont).family) values.fontFamily = fontFace(t.valuesFont).family;
          if (t.valuesBold === true) values.fontBold = true;
          // A multi-row card prints values under their field name, no header row.
          const header = { fontColor: typeof t.headerColor === 'string' ? t.headerColor : labelColor, fontSize: ptToPx(t.headerSize) || 13, show: v.type !== 'multiRowCard' && objectShow(v.objects, 'columnHeaders') };
          if (typeof t.headerBg === 'string') header.bgColor = t.headerBg;
          if (t.headerBold === false) header.fontBold = false;
          const columns = {};
          for (const f of pick(zones.dims)) {
            const target = f.displayName ? fieldName(f, where) : null;
            if (target && f.displayName !== labelOf(target.name)) columns[labelOf(target.name)] = { displayName: f.displayName };
          }
          const grid = { horizontalLines: t.gridHorizontal !== false, verticalLines: t.gridVertical === true, outerBorder: typeof t.outlineStyle === 'number' && t.outlineStyle > 0 };
          if (typeof t.gridColor === 'string') grid.horizontalColor = t.gridColor;
          // The page shows through the rows, as it does in Power BI.
          header.bgColor = 'transparent';
          config.tableConfig = { values, header, grid, rows: { striped: false, hoverHighlight: false, bgColor: 'transparent', stripeColor1: 'transparent', stripeColor2: 'transparent' }, ...(Object.keys(columns).length ? { columns } : {}) };
        }
        if (widget.type === 'filter') {
          binding.selectedDimensions = (binding.selectedDimensions || []).slice(0, 1);
          const sl = v.slicer || {};
          const dimName = binding.selectedDimensions[0];
          if (sl.mode === 'Dropdown') config.slicerStyle = 'dropdown';
          else if (sl.mode === 'Between' || sl.mode === 'Before' || sl.mode === 'After') config.slicerStyle = 'dateRange';
          else if (sl.mode === 'Basic' || !sl.mode) config.slicerStyle = 'list';
          if (sl.singleSelect) config.multiSelect = false;
          // A row of tiles in Power BI reads as buttons here.
          if (config.slicerStyle === 'list' && sl.horizontal) config.slicerStyle = 'buttons';
          // Power BI lays the two bounds of a Between slicer side by side.
          if (config.slicerStyle === 'dateRange') config.dateLayout = 'horizontal';
          if (config.slicerStyle === 'dateRange' && sl.startDate && sl.endDate) {
            config.dateFrom = String(sl.startDate).slice(0, 10);
            config.dateTo = String(sl.endDate).slice(0, 10);
            // Saved as the slicer's selection too: the viewer then filters
            // every widget's FIRST query on the window, instead of querying
            // the whole history until the slicer has loaded its values.
            config.selectedValues = [config.dateFrom, config.dateTo];
            info('slicer_range', `${where}: opens on ${config.dateFrom} → ${config.dateTo}, as in Power BI.`);
          }
          if (sl.defaultFilter && sl.defaultFilter.hasCondition) {
            info('slicer_default', `${where}: default selection of the slicer${dimName ? ` on ${dimName}` : ''} is not imported; pick it in the viewer.`);
          }
        }
        // Empty binding on a data widget = nothing usable was resolved
        const boundMeasures = [...(binding.selectedMeasures || []), ...(binding.comboBarMeasures || []), ...(binding.comboLineMeasures || [])];
        const boundDrafts = new Set(boundMeasures.filter(isDraft));
        if (boundDrafts.size) config.hideEmptyMessage = true;
        for (const d of boundDrafts) draftUses.set(d, (draftUses.get(d) || 0) + 1);
        const bound = Object.values(binding).some((x) => (Array.isArray(x) ? x.length : x && Object.keys(x).length));
        if (!bound) warn('empty_binding', `${where}: none of its fields could be mapped; the widget is imported unbound.`);
        const own = v.filters.flatMap((f) => rulesFromFilter(f, where));
        const all = [...pageRules, ...own];
        const rules = all.filter((r) => !r._timePeriod);
        const period = all.find((r) => r._timePeriod);
        if (rules.length) binding.widgetFilters = rules;
        if (period) binding.timePeriod = period._timePeriod;
        // The visual's sort, as the table's: by the column it shows.
        if ((widget.type === 'table' || widget.type === 'pivotTable') && v.orderBy && v.orderBy.length) {
          const target = fieldName(v.orderBy[0].field, where);
          if (target) {
            config.tableConfig = config.tableConfig || {};
            config.tableConfig.sort = { columnName: labelOf(target.name), direction: v.orderBy[0].direction };
          }
        }
        widget.dataBinding = binding;
        if (!v.crossFilter) config.crossFilterExclusions = [];
      }
      widgets[id] = widget;
      // Stacking order as Power BI painted it: the sort above put the
      // visuals back to front, so the position in the list is the layer.
      layout.push({ i: id, x: Math.max(0, Math.round(v.x)), y: Math.max(0, Math.round(v.y)), w: Math.max(4, Math.round(v.w)), h: Math.max(4, Math.round(v.h)), z: layout.length + 1 });
    }
    if (page.hidden) info('hidden_page', `Page "${page.name}" is hidden in Power BI; it is imported as a normal page.`);
    pages.push({ id: pageId, name: page.name, layout, widgets });
  });

  const customVisuals = [...customUses.entries()].map(([type, uses]) => ({ type, name: customVisualNames[type], uses }));
  for (const c of customVisuals) {
    warn('custom_visual', `Custom visual "${c.name}" (${c.uses} ${c.uses > 1 ? 'uses' : 'use'}) is not imported: it is third-party code OpenReport cannot run. A placeholder keeps its place on each page; rebuild it with a built-in visual or one from the workspace library.`, { visualType: c.type, name: c.name, uses: c.uses });
  }
  const reportFilters = [...report.reportFilters.flatMap((f) => rulesFromFilter(f, 'Report filter')), ...promotedPageRules].filter((r) => !r._timePeriod);
  const firstBackground = report.pages.map((p) => p.background).find((b) => typeof b === 'string');
  const settings = {
    pages,
    pageWidth: pageWidth || 1280,
    pageHeight: pageHeight || 720,
    snapToGrid: false,
    ...(reportFilters.length ? { reportFilters } : {}),
    ...(firstBackground ? { backgroundColor: firstBackground } : {}),
  };
  const first = pages[0] || { layout: [], widgets: {} };
  return {
    bundle: {
      format: 'open-report.report.v1',
      exportedAt: new Date().toISOString(),
      report: { title: opts.title || 'Imported report', layout: first.layout, widgets: first.widgets, settings, pages },
    },
    resources: [...resources],
    customVisuals,
    draftUses,
    warnings,
    stats: { pages: pages.length, visuals: visualCount, unsupported, customVisuals: customVisuals.length },
  };
}

module.exports = { buildReport, VISUAL_MAP };
