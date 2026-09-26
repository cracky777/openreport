// Power BI template import — from a synthetic .pbit (built in-memory, one
// per report format) to the plan the wizard applies. The real client files
// that drove the design are too large and too private to ship as fixtures;
// this one reproduces every shape they exercised: schema-qualified tables,
// Power Query renames and transformations, automatic date tables, filtered
// and derived DAX measures, drafts, page/visual filters, resources.
const request = require('supertest');
const AdmZip = require('adm-zip');
const { buildApp, seedUser, seedDatasource } = require('./helpers/testApp');
const { parseMExpression } = require('../utils/pbit/mExpression');
const { translateDax } = require('../utils/pbit/dax');
const { analyzePbit } = require('../utils/pbit');

const app = buildApp();

const M_SALES = `let
    Source = PostgreSQL.Database("db.example.com:5433", "shop"),
    sales_fact_sales = Source{[Schema="sales",Item="fact_sales"]}[Data],
    #"Autres colonnes supprimées" = Table.SelectColumns(sales_fact_sales,{"id", "product_id", "product2_id", "d", "amount", "qty"}),
    #"Colonnes renommées" = Table.RenameColumns(#"Autres colonnes supprimées",{{"amount", "montant"}})
in
    #"Colonnes renommées"`;
const M_PRODUCT = `let
    Source = PostgreSQL.Database("db.example.com:5433", "shop"),
    public_product = Source{[Schema="public",Item="product"]}[Data],
    #"Lignes filtrées" = Table.SelectRows(public_product, each ([active] = true))
in
    #"Lignes filtrées"`;
const M_INLINE = 'let Source = Table.FromRows(Json.Document(Binary.Decompress(Binary.FromText("i44FAA==", BinaryEncoding.Base64), Compression.Deflate)), type table [a = text]) in Source';

function schema() {
  return {
    compatibilityLevel: 1600,
    model: {
      culture: 'fr-FR',
      tables: [
        {
          name: 'f_sales',
          columns: [
            { name: 'id', dataType: 'int64', sourceColumn: 'id' },
            { name: 'product_id', dataType: 'int64', sourceColumn: 'product_id' },
            { name: 'product2_id', dataType: 'int64', sourceColumn: 'product2_id' },
            { name: 'd', dataType: 'dateTime', sourceColumn: 'd' },
            { name: 'montant', dataType: 'double', sourceColumn: 'montant' },
            { name: 'qty', dataType: 'int64', sourceColumn: 'qty' },
            { name: 'doubled', dataType: 'double', type: 'calculated', expression: 'f_sales[qty] * 2' },
          ],
          partitions: [{ name: 'p', mode: 'import', source: { type: 'm', expression: M_SALES.split('\n') } }],
        },
        {
          name: 'd_product',
          columns: [
            { name: 'id', dataType: 'int64', sourceColumn: 'id' },
            { name: 'name', dataType: 'string', sourceColumn: 'name' },
            { name: 'status', dataType: 'string', sourceColumn: 'status' },
            { name: 'category', dataType: 'string', sourceColumn: 'category' },
            { name: 'sel_status', dataType: 'string', type: 'calculated', expression: 'VAR S = SELECTEDVALUE(d_product[status], "Status") RETURN IF(HASONEVALUE(d_product[status]), S, "Status")' },
            { name: 'is_paid', dataType: 'int64', type: 'calculated', expression: 'IF(d_product[status] = "paid" && TRUE(), 1, 0)' },
          ],
          partitions: [{ name: 'p', mode: 'import', source: { type: 'm', expression: M_PRODUCT } }],
        },
        {
          // The same database table as d_product, reached through another key:
          // a role-playing dimension.
          name: 'd_product_cible',
          columns: [
            { name: 'id', dataType: 'int64', sourceColumn: 'id' },
            { name: 'name', dataType: 'string', sourceColumn: 'name' },
          ],
          partitions: [{ name: 'p', mode: 'import', source: { type: 'm', expression: M_PRODUCT } }],
        },
        {
          name: '_m',
          columns: [{ name: 'a', dataType: 'string', sourceColumn: 'a', isHidden: true }],
          partitions: [{ name: 'p', mode: 'import', source: { type: 'm', expression: M_INLINE } }],
          measures: [
            { name: 'Total', expression: 'SUM(f_sales[montant])', formatString: '#,0' },
            { name: 'Paid', expression: 'CALCULATE(COUNT(f_sales[id]), d_product[status] = "paid")', formatString: '0' },
            { name: 'Ratio', expression: 'DIVIDE([Paid], [Total])', formatString: '0.0%' },
            { name: 'Mix', expression: 'CALCULATE(SUM(f_sales[montant]), d_product[category] IN {"A", "B"}) / SUM(f_sales[qty])' },
            { name: 'LY', expression: 'CALCULATE([Total], SAMEPERIODLASTYEAR(f_sales[d]))' },
            { name: 'Label', expression: '"Total: " & FORMAT([Total], "0")' },
            { name: 'AvgDoubled', expression: 'AVERAGE(f_sales[doubled])' },
            { name: 'Evo', expression: 'VAR Cur = [Total] VAR Prev = [LY] VAR E = DIVIDE(Cur - Prev, Cur) RETURN IF(ISBLANK(E), "", FORMAT(E, "0.00%"))' },
          ],
        },
        {
          name: 'LocalDateTable_1234',
          isHidden: true,
          columns: [{ name: 'Date', dataType: 'dateTime', sourceColumn: '[Date]' }],
          partitions: [{ name: 'p', mode: 'import', source: { type: 'calculated', expression: 'Calendar(Date(2015,1,1), Date(2015,1,1))' } }],
        },
      ],
      relationships: [
        { name: 'r1', fromTable: 'f_sales', fromColumn: 'product_id', toTable: 'd_product', toColumn: 'id' },
        { name: 'r2', fromTable: 'f_sales', fromColumn: 'd', toTable: 'LocalDateTable_1234', toColumn: 'Date' },
        { name: 'r3', fromTable: 'f_sales', fromColumn: 'product2_id', toTable: 'd_product_cible', toColumn: 'id' },
      ],
    },
  };
}

const lit = (v) => ({ expr: { Literal: { Value: v } } });
const themeColor = (id, percent = 0) => ({ solid: { color: { expr: { ThemeDataColor: { ColorId: id, Percent: percent } } } } });
const col = (entity, property) => ({ Column: { Expression: { SourceRef: { Entity: entity } }, Property: property } });
const measure = (entity, property) => ({ Measure: { Expression: { SourceRef: { Entity: entity } }, Property: property } });
const inFilter = (entity, property, values) => ({
  name: 'f', type: 'Categorical', expression: col(entity, property),
  filter: { Version: 2, From: [{ Name: 'x', Entity: entity, Type: 0 }], Where: [{ Condition: { In: { Expressions: [{ Column: { Expression: { SourceRef: { Source: 'x' } }, Property: property } }], Values: values.map((v) => [{ Literal: { Value: `'${v}'` } }]) } } }] },
});

function legacyLayout() {
  const vc = (name, type, pos, singleVisual, filters) => ({
    x: pos[0], y: pos[1], z: pos[4] || 0, width: pos[2], height: pos[3],
    config: JSON.stringify({ name, singleVisual: { visualType: type, ...singleVisual } }),
    filters: JSON.stringify(filters || []),
  });
  const from = [{ Name: 'f', Entity: 'f_sales', Type: 0 }, { Name: 'p', Entity: 'd_product', Type: 0 }, { Name: 'm', Entity: '_m', Type: 0 }, { Name: 'q', Entity: 'd_product_cible', Type: 0 }];
  const sel = (name, expr) => ({ ...expr, Name: name });
  const selCol = (alias, prop, name) => sel(name, { Column: { Expression: { SourceRef: { Source: alias } }, Property: prop } });
  const selMeasure = (alias, prop, name) => sel(name, { Measure: { Expression: { SourceRef: { Source: alias } }, Property: prop } });
  const selAgg = (alias, prop, fn, name) => sel(name, { Aggregation: { Expression: { Column: { Expression: { SourceRef: { Source: alias } }, Property: prop } }, Function: fn } });
  return {
    id: 1, sections: [{
      name: 'ReportSection1', displayName: 'Overview', width: 1280, height: 720, displayOption: 1,
      config: JSON.stringify({ objects: { background: [{ properties: { color: { solid: { color: lit("'#202020'") } } } }] } }),
      filters: JSON.stringify([inFilter('d_product', 'category', ['A'])]),
      visualContainers: [
        vc('c1', 'card', [10, 10, 200, 100, 2], {
          projections: { Values: [{ queryRef: '_m.Total' }] },
          prototypeQuery: { From: from, Select: [selMeasure('m', 'Total', '_m.Total')] },
          columnProperties: { '_m.Total': { displayName: 'Chiffre' } },
          vcObjects: { title: [{ properties: { text: lit("'Sales total'") } }] },
        }, [inFilter('d_product', 'status', ['paid', 'pending'])]),
        vc('b1', 'clusteredColumnChart', [10.4, 120.6, 600, 300, 1], {
          projections: { Category: [{ queryRef: 'd_product.name' }], Series: [{ queryRef: 'd_product.category' }], Y: [{ queryRef: 'Sum(f_sales.montant)' }] },
          prototypeQuery: { From: from, Select: [selCol('p', 'name', 'd_product.name'), selCol('p', 'category', 'd_product.category'), selAgg('f', 'montant', 0, 'Sum(f_sales.montant)')] },
          objects: {
            legend: [{ properties: { show: lit('false') } }],
            dataPoint: [{ properties: { fill: { solid: { color: lit("'#F97000'") } } }, selector: { data: [{ scopeId: { Comparison: { ComparisonKind: 0, Left: col('d_product', 'category'), Right: { Literal: { Value: "'B'" } } } } }] } }],
          },
        }, [{ name: 't', type: 'TopN', expression: col('d_product', 'name'), filter: { Version: 2, From: from, Where: [{ Condition: { TopN: { ItemCount: 5, OrderBy: [{ Direction: 2, Expression: { Measure: { Expression: { SourceRef: { Source: 'm' } }, Property: 'Total' } } }] } } }] } }]),
        vc('t1', 'textbox', [700, 10, 300, 60, 3], { objects: { general: [{ properties: { paragraphs: [{ textRuns: [{ value: 'Hello ', textStyle: { fontSize: '12pt', color: '#00bcf2' } }, { value: 'world' }], horizontalTextAlignment: 'left' }] } }] } }),
        vc('i1', 'image', [700, 80, 100, 100, 4], { objects: { image: [{ properties: { sourceFile: { image: { url: { expr: { ResourcePackageItem: { PackageName: 'RegisteredResources', PackageType: 1, ItemName: 'logo123.png' } } } } } } }] } }),
        vc('s1', 'shape', [700, 200, 100, 100, 0], { objects: { shape: [{ properties: { tileShape: lit("'rectangleRounded'"), rectangleRoundedCurve: lit('12L') } }], fill: [{ properties: { fillColor: { solid: { color: lit("'#454545'") } } }, selector: { id: 'default' } }], outline: [{ properties: { show: lit('false') } }] } }),
        vc('sl1', 'slicer', [900, 10, 150, 40, 5], {
          projections: { Values: [{ queryRef: 'd_product.category' }] },
          prototypeQuery: { From: from, Select: [selCol('p', 'category', 'd_product.category')] },
          objects: { data: [{ properties: { mode: lit("'Dropdown'") } }] },
        }),
        vc('x1', 'map', [900, 100, 300, 200, 6], { projections: {}, prototypeQuery: { From: from, Select: [] } }),
        vc('h1', 'card', [10, 600, 100, 50, 8], { display: { mode: 'hidden' }, projections: { Values: [{ queryRef: '_m.Total' }] }, prototypeQuery: { From: from, Select: [selMeasure('m', 'Total', '_m.Total')] } }),
        vc('o1', 'textbox', [2000, 10, 100, 50, 9], { objects: { general: [{ properties: { paragraphs: [{ textRuns: [{ value: 'parked' }] }] } }] } }),
        vc('l1', 'shape', [10, 650, 400, 20, 10], { objects: { shape: [{ properties: { tileShape: lit("'line'") } }], outline: [{ properties: { lineColor: themeColor(3), weight: lit('2D') }, selector: { id: 'default' } }, { properties: { show: lit('true') } }] } }),
        vc('i2', 'image', [500, 600, 180, 100, 11], { objects: { image: [{ properties: { sourceFile: { image: { url: { expr: { ResourcePackageItem: { PackageName: 'RegisteredResources', PackageType: 1, ItemName: 'logo123.png' } } }, scaling: lit("'Normal'") } }, fit: lit("'Stretch'") } }] } }),
        vc('c2', 'card', [700, 600, 150, 100, 12], {
          projections: { Values: [{ queryRef: '_m.Total' }] },
          prototypeQuery: { From: from, Select: [selMeasure('m', 'Total', '_m.Total')] },
          objects: { labels: [{ properties: { color: themeColor(0, -0.3), fontSize: lit('25D') } }], categoryLabels: [{ properties: { show: lit('false') } }] },
        }),
        vc('tb1', 'tableEx', [10, 450, 400, 120, 13], {
          projections: { Values: [{ queryRef: 'd_product.name' }, { queryRef: 'd_product_cible.name' }, { queryRef: 'Sum(f_sales.montant)' }] },
          prototypeQuery: {
            From: from,
            Select: [selCol('p', 'name', 'd_product.name'), selCol('q', 'name', 'd_product_cible.name'), selAgg('f', 'montant', 0, 'Sum(f_sales.montant)')],
            OrderBy: [{ Direction: 2, Expression: { Aggregation: { Expression: { Column: { Expression: { SourceRef: { Source: 'f' } }, Property: 'montant' } }, Function: 0 } } }],
          },
        }, [
          { type: 'TopN', expression: col('d_product', 'name'), filter: { Version: 2, From: [{ Name: 'subquery', Expression: { Subquery: { Query: { Version: 2, From: from, Select: [{ Column: { Expression: { SourceRef: { Source: 'p' } }, Property: 'name' }, Name: 'field' }], OrderBy: [{ Direction: 2, Expression: { Aggregation: { Expression: { Column: { Expression: { SourceRef: { Source: 'f' } }, Property: 'qty' } }, Function: 0 } } }], Top: 3 } } }, Type: 2 }, { Name: 'p', Entity: 'd_product', Type: 0 }], Where: [{ Condition: { In: { Expressions: [{ Column: { Expression: { SourceRef: { Source: 'p' } }, Property: 'name' } }], Table: { SourceRef: { Source: 'subquery' } } } } }] } },
          { type: 'RelativeDate', expression: col('f_sales', 'd'), filter: { Version: 2, From: [{ Name: 'f', Entity: 'f_sales', Type: 0 }], Where: [{ Condition: { Between: { Expression: { Column: { Expression: { SourceRef: { Source: 'f' } }, Property: 'd' } }, LowerBound: { DateSpan: { Expression: { DateAdd: { Expression: { Now: {} }, Amount: -30, TimeUnit: 0 } }, TimeUnit: 0 } }, UpperBound: { DateSpan: { Expression: { DateAdd: { Expression: { Now: {} }, Amount: -1, TimeUnit: 0 } }, TimeUnit: 0 } } } } }] } },
        ]),
        vc('hs1', 'slicer', [10, 690, 100, 20, 14], {
          display: { mode: 'hidden' },
          projections: { Values: [{ queryRef: 'd_product.status' }] },
          prototypeQuery: { From: from, Select: [selCol('p', 'status', 'd_product.status')] },
          objects: { general: [{ properties: { filter: { filter: { Version: 2, From: [{ Name: 'p', Entity: 'd_product', Type: 0 }], Where: [{ Condition: { In: { Expressions: [{ Column: { Expression: { SourceRef: { Source: 'p' } }, Property: 'status' } }], Values: [[{ Literal: { Value: "'paid'" } }]] } } }] } } } }] },
        }),
        vc('e1', 'card', [700, 700, 150, 50, 15], {
          projections: { Values: [{ queryRef: '_m.Evo' }] },
          prototypeQuery: { From: from, Select: [selMeasure('m', 'Evo', '_m.Evo')] },
          objects: { categoryLabels: [{ properties: { show: lit('false') } }] },
        }),
        vc('sk1', 'sankeyArtDEADBEEF', [10, 700, 600, 20, 16], {
          projections: { Source: [{ queryRef: 'd_product.name' }], Destination: [{ queryRef: 'd_product_cible.name' }], Weight: [{ queryRef: 'Sum(f_sales.qty)' }] },
          prototypeQuery: { From: from, Select: [selCol('p', 'name', 'd_product.name'), selCol('q', 'name', 'd_product_cible.name'), selAgg('f', 'qty', 0, 'Sum(f_sales.qty)')] },
          objects: { hideNodeSettings: [{ properties: { hiddenNodeNames: lit("'n/a'") } }] },
        }),
        vc('d1', 'card', [900, 400, 200, 100, 7], {
          projections: { Values: [{ queryRef: '_m.LY' }] },
          prototypeQuery: { From: from, Select: [selMeasure('m', 'LY', '_m.LY')] },
        }),
      ],
    }],
    config: JSON.stringify({ version: '5.68', themeCollection: { baseTheme: { name: 'Base' }, customTheme: { name: 'Custom1.json' } } }),
    filters: '[]',
  };
}

// Base theme + custom theme layered over it, as a template ships them.
const BASE_THEME = { name: 'Base', dataColors: ['#111111', '#222222'], background: '#FFFFFF', foreground: '#000000', textClasses: { label: { color: '#ABCDEF', fontSize: 10 }, callout: { color: '#FEDCBA', fontSize: 30 } } };
const CUSTOM_THEME = { name: 'Custom', dataColors: ['#8800FF', '#00BCF2'], visualStyles: { '*': { '*': { background: [{ transparency: 100 }] } } }, textClasses: { label: { color: '#FFFFFF' } } };

function utf16(json) {
  return Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(JSON.stringify(json), 'utf16le')]);
}

function legacyPbit() {
  const zip = new AdmZip();
  zip.addFile('DataModelSchema', utf16(schema()));
  zip.addFile('Report/Layout', utf16(legacyLayout()));
  zip.addFile('Report/StaticResources/RegisteredResources/logo123.png', Buffer.from('89504e470d0a1a0a', 'hex'));
  zip.addFile('Report/StaticResources/SharedResources/BaseThemes/Base.json', Buffer.from(JSON.stringify(BASE_THEME), 'utf8'));
  zip.addFile('Report/StaticResources/RegisteredResources/Custom1.json', Buffer.from(JSON.stringify(CUSTOM_THEME), 'utf8'));
  // A third-party visual packaged with the template.
  zip.addFile('Report/CustomVisuals/sankeyArtDEADBEEF/package.json', Buffer.from('{}', 'utf8'));
  zip.addFile('Report/CustomVisuals/sankeyArtDEADBEEF/resources/sankeyArtDEADBEEF.pbiviz.json', Buffer.from(JSON.stringify({ visual: { name: 'sankeyArt', displayName: 'Sankey Art', guid: 'sankeyArtDEADBEEF' } }), 'utf8'));
  zip.addFile('Version', Buffer.from('1.28', 'utf8'));
  return zip.toBuffer();
}

function pbirPbit() {
  const zip = new AdmZip();
  zip.addFile('DataModelSchema', Buffer.from(JSON.stringify(schema()), 'utf8'));
  const j = (p, o) => zip.addFile(p, Buffer.from(JSON.stringify(o), 'utf8'));
  j('Report/definition/version.json', { version: '2.0.0' });
  j('Report/definition/report.json', { themeCollection: { baseTheme: { name: 'Base' }, customTheme: { name: 'Custom1.json' } }, filterConfig: { filters: [{ name: 'rf', type: 'Categorical', field: col('d_product', 'category'), filter: { Version: 2, From: [{ Name: 'p', Entity: 'd_product', Type: 0 }], Where: [{ Condition: { Not: { Expression: { In: { Expressions: [{ Column: { Expression: { SourceRef: { Source: 'p' } }, Property: 'category' } }], Values: [[{ Literal: { Value: "'Z'" } }]] } } } } }] } }] } });
  j('Report/StaticResources/SharedResources/BaseThemes/Base.json', BASE_THEME);
  j('Report/StaticResources/RegisteredResources/Custom1.json', CUSTOM_THEME);
  j('Report/definition/pages/pages.json', { pageOrder: ['p1', 'p2'], activePageName: 'p1' });
  j('Report/definition/pages/p1/page.json', { name: 'p1', displayName: 'Matrix', width: 1280, height: 720 });
  j('Report/definition/pages/p1/visuals/v1/visual.json', {
    name: 'v1', position: { x: 0, y: 0, width: 640, height: 300, z: 0 },
    visual: {
      visualType: 'pivotTable',
      query: { queryState: {
        Rows: { projections: [{ field: col('d_product', 'category'), queryRef: 'd_product.category' }] },
        Columns: { projections: [{ field: col('d_product', 'status'), queryRef: 'd_product.status' }] },
        Values: { projections: [{ field: measure('_m', 'Total'), queryRef: '_m.Total' }, { field: measure('_m', 'Ratio'), queryRef: '_m.Ratio' }] },
      } },
      objects: {}, visualContainerObjects: { title: [{ properties: { text: lit("'By category'"), show: lit('false') } }] },
    },
    filterConfig: { filters: [{ name: 'a', type: 'Advanced', field: measure('_m', 'Total'), filter: { Version: 2, From: [{ Name: 'm', Entity: '_m', Type: 0 }], Where: [{ Condition: { Not: { Expression: { Comparison: { ComparisonKind: 0, Left: { Measure: { Expression: { SourceRef: { Source: 'm' } }, Property: 'Total' } }, Right: { Literal: { Value: 'null' } } } } } } }] } }] },
  });
  j('Report/definition/pages/p1/visuals/v2/visual.json', {
    name: 'v2', position: { x: 0, y: 320, width: 640, height: 300, z: 1 },
    visual: {
      visualType: 'lineChart',
      query: { queryState: {
        Category: { projections: [{ field: { HierarchyLevel: { Expression: { Hierarchy: { Expression: { PropertyVariationSource: { Expression: { SourceRef: { Entity: 'f_sales' } }, Name: 'Variation', Property: 'd' } }, Hierarchy: 'Hiérarchie de dates' } }, Level: 'Jour' } }, queryRef: 'f_sales.d.Variation.Hiérarchie de dates.Jour', active: true }, { field: { HierarchyLevel: { Expression: { Hierarchy: { Expression: { PropertyVariationSource: { Expression: { SourceRef: { Entity: 'f_sales' } }, Name: 'Variation', Property: 'd' } }, Hierarchy: 'Hiérarchie de dates' } }, Level: 'Année' } }, queryRef: 'f_sales.d.Variation.Année' }] },
        Y: { projections: [{ field: measure('_m', 'Total'), queryRef: '_m.Total' }] },
      } },
    },
  });
  j('Report/definition/pages/p1/visuals/v4/visual.json', {
    name: 'v4', position: { x: 700, y: 0, width: 200, height: 80, z: 2 },
    visual: {
      visualType: 'cardVisual',
      query: { queryState: { Data: { projections: [{ field: { Aggregation: { Expression: col('d_product', 'name'), Function: 3 } }, queryRef: 'Min(d_product.name)' }] } } },
      objects: { label: [{ properties: { show: lit('false') } }], value: [{ properties: { fontSize: lit('14D'), fontColor: { solid: { color: lit("'#ABCDEF'") } }, fontFamily: lit("'wf_standard-font_light, helvetica, arial, sans-serif'") } }] },
    },
  });
  j('Report/definition/pages/p1/visuals/v5/visual.json', {
    name: 'v5', position: { x: 700, y: 100, width: 250, height: 50, z: 3 },
    visual: {
      visualType: 'slicer',
      query: { queryState: { Values: { projections: [{ field: col('f_sales', 'd'), queryRef: 'f_sales.d' }] } } },
      objects: { data: [{ properties: { mode: lit("'Between'"), startDate: lit("datetime'2026-05-01T00:00:00'"), endDate: lit("datetime'2026-05-31T00:00:00'") } }] },
    },
  });
  j('Report/definition/pages/p1/visuals/v6/visual.json', {
    name: 'v6', position: { x: 700, y: 200, width: 250, height: 200, z: 4 },
    visual: {
      visualType: 'pieChart',
      query: { queryState: {
        Category: { projections: [{ field: col('d_product', 'status'), queryRef: 'd_product.status' }] },
        Y: { projections: [{ field: measure('_m', 'Total'), queryRef: '_m.Total' }] },
      } },
      objects: { labels: [{ properties: { show: lit('true'), labelStyle: lit("'Both'"), position: lit("'outside'") } }] },
    },
  });
  j('Report/definition/pages/p1/visuals/v7/visual.json', {
    name: 'v7', position: { x: 0, y: 640, width: 300, height: 60, z: 5 },
    visual: {
      visualType: 'slicer',
      query: { queryState: { Values: { projections: [{ field: col('d_product', 'sel_status'), queryRef: 'd_product.sel_status' }] } } },
      objects: { general: [{ properties: { orientation: lit('1D') } }] },
    },
  });
  j('Report/definition/pages/p1/visuals/v8/visual.json', {
    name: 'v8', position: { x: 700, y: 420, width: 500, height: 200, z: 6 },
    visual: {
      visualType: 'lineChart',
      query: { queryState: {
        Category: { projections: [{ field: col('d_product', 'status'), queryRef: 'd_product.status' }] },
        Y: { projections: [{ field: measure('_m', 'Total'), queryRef: '_m.Total' }, { field: measure('_m', 'Ratio'), queryRef: '_m.Ratio' }] },
      } },
      objects: {
        dataPoint: [{ properties: { fill: { solid: { color: lit("'#F97000'") } } }, selector: { metadata: '_m.Total' } }],
        lineStyles: [{ properties: { showMarker: lit('true'), lineChartType: lit("'smooth'") } }],
        valueAxis: [{ properties: { gridlineStyle: lit("'dotted'"), gridlineThickness: lit('0.3D') } }],
      },
    },
  });
  j('Report/definition/pages/p2/page.json', { name: 'p2', displayName: 'Hidden', width: 1280, height: 720, visibility: 'HiddenInViewMode' });
  j('Report/definition/pages/p2/visuals/v3/visual.json', {
    name: 'v3', position: { x: 0, y: 0, width: 200, height: 100, z: 0 },
    visual: { visualType: 'tableEx', query: { queryState: { Values: { projections: [{ field: col('d_product', 'name'), queryRef: 'd_product.name', displayName: 'Product' }, { field: { Aggregation: { Expression: col('f_sales', 'qty'), Function: 2 } }, queryRef: 'CountDistinct(f_sales.qty)' }] } } } },
  });
  return zip.toBuffer();
}

describe('pbit — Power Query expressions', () => {
  test('reads the connector, navigation target, kept and renamed columns', () => {
    const r = parseMExpression(M_SALES);
    expect(r.source).toMatchObject({ kind: 'postgres', host: 'db.example.com', port: 5433, database: 'shop' });
    expect(r.schema).toBe('sales');
    expect(r.table).toBe('fact_sales');
    expect(r.keptColumns).toEqual(['id', 'product_id', 'product2_id', 'd', 'amount', 'qty']);
    expect(r.renames).toEqual({ montant: 'amount' });
    expect(r.complexSteps).toEqual([]);
  });
  test('flags transformations it does not translate', () => {
    const r = parseMExpression(M_PRODUCT);
    expect(r.complexSteps.map((s) => s.fn)).toEqual(['Table.SelectRows']);
  });
  test('recognises unions, references and native queries', () => {
    expect(parseMExpression('let Source = Table.Combine({q_a, #"q b"}) in Source').combine).toEqual(['q_a', 'q b']);
    expect(parseMExpression('let Source = f_meteo, R = Table.RenameColumns(Source,{{"t", "t_n1"}}) in R')).toMatchObject({ reference: 'f_meteo', renames: { t_n1: 't' } });
    expect(parseMExpression('let Source = Sql.Database("h", "db"), Q = Value.NativeQuery(Source, "SELECT 1") in Q').nativeQuery).toBe('SELECT 1');
    const sqls = parseMExpression('let Source = Sql.Databases("srv"), db = Source{[Name="warehouse"]}[Data], t = db{[Schema="dbo",Item="t"]}[Data] in t');
    expect(sqls.source).toMatchObject({ kind: 'sqlserver', host: 'srv', database: 'warehouse' });
    expect(sqls.table).toBe('t');
  });
});

describe('pbit — DAX translation', () => {
  const ctx = {
    resolveTable: (t) => ({ table: t }),
    resolveColumn: (t, c) => ({ table: t, column: c, sqlRef: `"${t}"."${c}"`, dimName: `${t}.${c}`, dataType: 'double' }),
    resolveMeasure: (n) => (n === 'Total' ? { name: '_calc.total' } : null),
    helper: (res) => `_calc.helper_${res.aggregation}`,
  };
  test('plain and filtered aggregates', () => {
    expect(translateDax('SUM(t[a])', ctx).result).toMatchObject({ kind: 'agg', aggregation: 'sum', table: 't', column: 'a', filters: [] });
    const r = translateDax('CALCULATE(COUNT(t[a]), d[s] = "paid", NOT(d[k] IN {"x", "y"}), ISBLANK(d[z]))', ctx).result;
    expect(r.filters).toEqual([
      { field: 'd.s', isMeasure: false, op: 'eq', value: 'paid', values: [] },
      { field: 'd.k', isMeasure: false, op: 'not_in', value: '', values: ['x', 'y'] },
      { field: 'd.z', isMeasure: false, op: 'is_empty', value: '', values: [] },
    ]);
  });
  test('arithmetic, DIVIDE and measure references become a custom expression', () => {
    expect(translateDax('DIVIDE([Total], SUM(t[q]), 0)', ctx).result.sql).toBe('COALESCE((${_calc.total}) / NULLIF((SUM("t"."q")), 0), 0)');
    expect(translateDax('VAR x = SUM(t[a]) RETURN x / 100', ctx).result.sql).toBe('(SUM("t"."a")) / 100');
    // a filtered aggregate inside an expression is hoisted into a helper measure
    expect(translateDax('CALCULATE(SUM(t[a]), d[s] = "x") - SUM(t[b])', ctx).result.sql).toBe('(${_calc.helper_sum}) - (SUM("t"."b"))');
  });
  test('blank fallbacks are dropped with a note', () => {
    const r = translateDax('IF(ISBLANK(AVERAGE(t[v])), "-", AVERAGE(t[v]) / 100)', ctx);
    expect(r.ok).toBe(true);
    expect(r.notes[0]).toMatch(/blank fallback/);
  });
  test('a moved date selection becomes the measure\'s periodShift', () => {
    expect(translateDax('CALCULATE([Total], SAMEPERIODLASTYEAR(d[dt]))', ctx).result)
      .toEqual({ kind: 'expr', sql: '${_calc.total}', filters: [], periodShift: { dim: 'd.dt', unit: 'year', n: -1 } });
    expect(translateDax('CALCULATE(SUM(t[a]), DATEADD(d[dt], -2, QUARTER), d[s] = "paid")', ctx).result)
      .toMatchObject({ kind: 'agg', aggregation: 'sum', periodShift: { dim: 'd.dt', unit: 'quarter', n: -2 }, filters: [expect.objectContaining({ field: 'd.s' })] });
    const prev = translateDax('CALCULATE([Total], PREVIOUSMONTH(d[dt]))', ctx);
    expect(prev.result.periodShift).toEqual({ dim: 'd.dt', unit: 'month', n: -1 });
    expect(prev.notes[0]).toMatch(/PREVIOUSMONTH read as the selection moved one month back/);
    // Inside a larger expression the shifted part lives as its own measure.
    expect(translateDax('[Total] - CALCULATE([Total], SAMEPERIODLASTYEAR(d[dt]))', ctx).result.sql).toBe('(${_calc.total}) - (${_calc.helper_undefined})');
    expect(translateDax('CALCULATE([Total], DATEADD(d[dt], 0, MONTH))', ctx)).toMatchObject({ ok: false, tag: 'n1' });
    expect(translateDax('CALCULATE([Total], SAMEPERIODLASTYEAR(d[dt]), PREVIOUSYEAR(d[dt]))', ctx)).toMatchObject({ ok: false, tag: 'n1' });
  });
  test('what cannot be translated says why', () => {
    expect(translateDax('CALCULATE([Total], DATESYTD(d[dt]))', ctx)).toMatchObject({ ok: false, tag: 'ytd' });
    expect(translateDax('"a" & FORMAT([Total], "0")', ctx)).toMatchObject({ ok: false, tag: 'text' });
    expect(translateDax('[Missing] * 2', ctx)).toMatchObject({ ok: false, tag: 'dependency' });
    expect(translateDax('SUMX(t, t[a] * t[b])', ctx)).toMatchObject({ ok: false, tag: 'iterator' });
  });
});

describe('pbit — legacy Layout template', () => {
  const plan = analyzePbit(legacyPbit(), { fileName: 'Shop report.pbit' });

  test('detects the datasource and builds the model on database names', () => {
    expect(plan.source.reportFormat).toBe('legacy');
    expect(plan.datasource).toMatchObject({ dbType: 'postgres', host: 'db.example.com', port: 5433, dbName: 'shop' });
    const f = plan.model.fields;
    expect(f.name).toBe('Shop report');
    expect(f.selected_tables).toEqual(['sales.fact_sales', 'product']);
    // the renamed column is read under its database name, labelled with the Power BI one
    expect(f.dimensions).toContainEqual({ name: 'sales.fact_sales.amount', table: 'sales.fact_sales', column: 'amount', type: 'decimal', label: 'montant' });
    expect(f.dimensions.find((d) => d.name === 'sales.fact_sales.doubled')).toBeUndefined();
    // The calculated column is a calculated dimension: row-level SQL on its table.
    expect(f.dimensions.find((d) => d.name === '_calcdim.f_sales_doubled')).toMatchObject({ table: 'sales.fact_sales', column: '', type: 'decimal', expression: '(("sales"."fact_sales"."qty") * (2))' });
    // And a measure over it is that SQL aggregated.
    expect(f.measures.find((m) => m.name === '_calc.avgdoubled')).toMatchObject({ aggregation: 'custom', expression: 'AVG(((("sales"."fact_sales"."qty") * (2))))' });
    expect(f.joins).toEqual([{ from_table: 'product', from_column: 'id', to_table: 'sales.fact_sales', to_column: 'product_id', type: 'LEFT', cardinality: { from: '1', to: '*' } }]);
    expect(f.date_column).toBeNull();
    expect(plan.model.yaml).toMatch(/^openreport_model:/m);
  });

  test('translates measures, hoists helpers, keeps drafts', () => {
    const byName = Object.fromEntries(plan.model.fields.measures.map((m) => [m.name, m]));
    expect(byName['_calc.total']).toMatchObject({ table: 'sales.fact_sales', column: 'amount', aggregation: 'sum', label: 'Total', format: { decimals: 0, thousandSep: ' ' } });
    expect(byName['_calc.paid']).toMatchObject({ aggregation: 'count', column: 'id', filterRules: [{ field: 'product.status', op: 'eq', value: 'paid' }], overrideFilters: false });
    expect(byName['_calc.ratio']).toMatchObject({ aggregation: 'custom', expression: '((${_calc.paid}) / NULLIF((${_calc.total}), 0)) * 100', format: { decimals: 1, suffix: ' %' } });
    expect(byName['_calc.mix'].expression).toBe('(${_calc.mix_part1}) / NULLIF((SUM("sales"."fact_sales"."qty")), 0)');
    expect(byName['_calc.mix_part1']).toMatchObject({ aggregation: 'sum', filterRules: [{ field: 'product.category', op: 'in', values: ['A', 'B'] }] });
    // The same selection a year back: a shifted copy of Total, no draft.
    expect(byName['_calc.ly']).toMatchObject({ aggregation: 'custom', expression: '${_calc.total}', periodShift: { dim: 'sales.fact_sales.d', unit: 'year', n: -1 } });
    expect(byName['_calc.ly'].description).not.toMatch(/^DRAFT/);
    expect(plan.warnings).not.toContainEqual(expect.objectContaining({ code: 'dax_n1', measure: 'LY' }));
    expect(plan.warnings).toContainEqual(expect.objectContaining({ code: 'dax_text', measure: 'Label' }));
    // Drafts are listed up front with the visuals that depend on them: none
    // here, since nothing binds Label and the Evo card is rebuilt on its base.
    expect(plan.model.draftMeasures.map((d) => [d.name, d.tag, d.uses])).toEqual([['Label', 'text', 0], ['Evo', 'text', 0]]);
    expect(plan.model.draftMeasures[0]).toMatchObject({ measureName: '_calc.label', reason: expect.stringMatching(/text/), dax: '"Total: " & FORMAT([Total], "0")' });
    expect(plan.warnings).toContainEqual(expect.objectContaining({ code: 'calculated_column', column: 'doubled' }));
    expect(plan.warnings).toContainEqual(expect.objectContaining({ code: 'transformed_table', table: 'd_product' }));
    // aggregation placed on a column by a visual
    expect(byName['sales.fact_sales.amount_sum']).toMatchObject({ aggregation: 'sum', column: 'amount', label: 'montant (sum)' });
    expect(plan.stats).toMatchObject({ tables: 2, measuresTranslated: 6, measuresDraft: 2, pages: 1, visuals: 14, unsupported: 2, customVisuals: 1 });
  });

  test('rebuilds the page: widgets, positions, filters, resources', () => {
    const { report } = plan.report.bundle;
    expect(plan.report.bundle.format).toBe('open-report.report.v1');
    expect(report.settings).toMatchObject({ pageWidth: 1280, pageHeight: 720, snapToGrid: false, backgroundColor: '#202020' });
    // single page → its filter is a report filter
    // … and so is the selection of the hidden slicer.
    expect(report.settings.reportFilters).toEqual([
      { field: 'product.category', isMeasure: false, op: 'in', value: '', values: ['A'] },
      { field: 'product.status', isMeasure: false, op: 'in', value: '', values: ['paid'] },
    ]);
    const page = report.pages[0];
    expect(page.name).toBe('Overview');
    const widgets = Object.values(page.widgets);
    const byType = (t) => widgets.filter((w) => w.type === t);
    // The hidden card and the text box parked off the page are not imported.
    expect(widgets.map((w) => w.type).sort()).toEqual(['bar', 'filter', 'image', 'image', 'scorecard', 'scorecard', 'scorecard', 'scorecard', 'shape', 'shape', 'table', 'text', 'text', 'text']);
    expect(widgets.find((w) => w.data && w.data.text === 'parked')).toBeUndefined();
    expect(plan.warnings).toContainEqual(expect.objectContaining({ code: 'offpage_visual' }));
    // Every widget carries its layer, back to front.
    expect(page.layout.map((l) => l.z)).toEqual(page.layout.map((_, i) => i + 1));

    const card = byType('scorecard').find((w) => w.config.title === 'Sales total');
    expect(card.dataBinding).toEqual({ selectedMeasures: ['_calc.total'], widgetFilters: [{ field: 'product.status', isMeasure: false, op: 'in', value: '', values: ['paid', 'pending'] }] });
    expect(card.config.label).toBe('Chiffre');

    const bar = byType('bar')[0];
    // Series colour by member, legend off, the theme's data colours as palette.
    expect(bar.config).toMatchObject({ subType: 'grouped', barDirection: 'vertical', showLegend: false, legendColors: { B: '#F97000' }, palette: ['#8800FF', '#00BCF2'], color: '#8800FF', transparentBg: true, borderEnabled: false });
    expect(bar.dataBinding).toEqual({
      selectedDimensions: ['product.name'], selectedMeasures: ['sales.fact_sales.amount_sum'], groupBy: ['product.category'],
      widgetFilters: [{ field: '_calc.total', isMeasure: true, op: 'top_n', value: '5', values: [] }],
    });
    const barLayout = page.layout.find((l) => l.i === Object.keys(page.widgets).find((id) => page.widgets[id] === bar));
    expect(barLayout).toMatchObject({ x: 10, y: 121, w: 600, h: 300 });
    // z-order: the shape (z=0) is laid out first
    expect(page.widgets[page.layout[0].i].type).toBe('shape');

    const text = byType('text').find((w) => w.data.text === 'Hello world');
    expect(text.config).toMatchObject({ fontSize: 16, color: '#00bcf2', textAlign: 'flex-start', verticalAlign: 'flex-start', transparentBg: true });
    // Runs keep only what differs from the box-level style.
    expect(text.data.runs).toEqual([{ text: 'Hello ' }, { text: 'world' }]);
    const placeholder = byType('text').find((w) => w !== text);
    expect(placeholder.data.text).toMatch(/"map" is not supported/);
    expect(plan.warnings).toContainEqual(expect.objectContaining({ code: 'unsupported_visual', visualType: 'map' }));

    const image = byType('image').find((w) => w.config.fit === 'contain');
    expect(image.config.pbitResource).toBe('logo123.png');
    // "Stretch" fills the box regardless of the picture's ratio.
    expect(byType('image').find((w) => w !== image).config.fit).toBe('fill');
    expect(plan.resources['logo123.png']).toMatchObject({ mime: 'image/png', size: 8 });

    expect(byType('shape').find((w) => w.config.shape === 'square').config).toMatchObject({ backgroundColor: '#454545', borderEnabled: false, borderRadius: 12 });
    // A line: its colour comes from the theme (ColorId 3 = second data colour),
    // and nothing is drawn behind or around it.
    expect(byType('shape').find((w) => w.config.shape === 'line').config).toMatchObject({ lineColor: '#00bcf2', lineThickness: 2, transparentBg: true, borderEnabled: false });

    // Card styling: the theme background shaded 30 % towards black for the
    // value, its point size capped by the box, the hidden category label.
    const styled = byType('scorecard').find((w) => w.config.showLabel === false);
    expect(styled.config).toMatchObject({ valueColor: '#b3b3b3', valueSize: 33, labelColor: '#FFFFFF', labelPosition: 'below', transparentBg: true });
    // The default card value colour is the theme's callout class.
    expect(card.config.valueColor).toBe('#FEDCBA');
    // "(Total − LY) ÷ Total" with LY = Total a year back: the card binds
    // Total and shows only its N-1 % evolution, divided by the current period.
    const evo = byType('scorecard').find((w) => w.config.showValue === false);
    expect(evo.dataBinding).toMatchObject({ selectedMeasures: ['_calc.total'], compareDateDim: 'sales.fact_sales.d' });
    expect(evo.config).toMatchObject({ showN1Percent: true, showLabel: false, n1PercentStyle: expect.objectContaining({ base: 'current', label: '', iconEnabled: false }) });
    expect(plan.warnings).toContainEqual(expect.objectContaining({ code: 'evolution_card' }));

    // Table: sorted as the visual was, Top 3 by a measure the filter hid in
    // a subquery, and a rolling window turned into a time preset.
    // A third-party visual is identified by name, kept as a placeholder and
    // flagged once, however many pages use it — never mapped onto something else.
    const custom = byType('text').find((w) => /Custom visual "Sankey Art" is not imported/.test(w.data.text));
    expect(custom).toBeTruthy();
    expect(plan.report.customVisuals).toEqual([{ type: 'sankeyArtDEADBEEF', name: 'Sankey Art', uses: 1 }]);
    expect(plan.warnings).toContainEqual(expect.objectContaining({ code: 'custom_visual', name: 'Sankey Art', uses: 1 }));
    expect(plan.warnings).not.toContainEqual(expect.objectContaining({ code: 'unsupported_visual', visualType: 'sankeyArtDEADBEEF' }));
    // The role table's column, on a table, is read as a lookup through the
    // key the role was joined on.
    const lookup = plan.model.fields.dimensions.find((d) => d.name === '_calcdim.d_product_cible_f_sales_name');
    expect(lookup).toMatchObject({ table: 'sales.fact_sales', column: '', expression: '(SELECT r.name FROM product r WHERE r.id = "sales"."fact_sales"."product2_id")' });
    expect(plan.warnings).toContainEqual(expect.objectContaining({ code: 'role_table', table: 'd_product_cible' }));

    const table = byType('table')[0];
    expect(table.dataBinding.selectedDimensions).toEqual(['product.name', '_calcdim.d_product_cible_f_sales_name']);
    expect(table.config.tableConfig.sort).toEqual({ columnName: expect.stringMatching(/montant/), direction: 'desc' });
    expect(table.config.tableConfig.rows).toMatchObject({ striped: false, bgColor: 'transparent' });
    expect(table.dataBinding.widgetFilters).toContainEqual({ field: 'sales.fact_sales.qty_sum', isMeasure: true, op: 'top_n', value: '3', values: [] });
    expect(table.dataBinding.timePeriod).toEqual({ dim: 'sales.fact_sales.d', preset: 'last_30_days' });
    expect(byType('filter')[0].dataBinding).toEqual({ selectedDimensions: ['product.category'] });
    expect(byType('filter')[0].config.slicerStyle).toBe('dropdown');
    // a draft measure still binds so the widget keeps its place
    expect(byType('scorecard').find((w) => w.dataBinding.selectedMeasures[0] === '_calc.ly')).toBeTruthy();
  });
});

describe('pbit — PBIR template', () => {
  const plan = analyzePbit(pbirPbit(), { fileName: 'matrix.pbit' });

  test('reads pages, matrix zones, measure filters and report filters', () => {
    expect(plan.source.reportFormat).toBe('pbir');
    const { report } = plan.report.bundle;
    expect(report.pages.map((p) => p.name)).toEqual(['Matrix', 'Hidden']);
    expect(report.settings.reportFilters).toEqual([{ field: 'product.category', isMeasure: false, op: 'not_in', value: '', values: ['Z'] }]);
    const pivot = Object.values(report.pages[0].widgets).find((w) => w.type === 'pivotTable');
    expect(pivot.config.title).toBeUndefined();
    expect(pivot.dataBinding).toEqual({
      selectedDimensions: ['product.category'], columnDimensions: ['product.status'], selectedMeasures: ['_calc.total', '_calc.ratio'],
      widgetFilters: [{ field: '_calc.total', isMeasure: true, op: 'is_not_empty', value: '', values: [] }],
    });
    const table = Object.values(report.pages[1].widgets).find((w) => w.type === 'table');
    expect(table.dataBinding).toMatchObject({ selectedDimensions: ['product.name'], selectedMeasures: ['sales.fact_sales.qty_count_distinct'] });
    expect(plan.model.fields.measures.find((m) => m.name === 'sales.fact_sales.qty_count_distinct')).toMatchObject({ table: 'sales.fact_sales', column: 'qty', aggregation: 'count_distinct' });
    expect(plan.warnings).toContainEqual(expect.objectContaining({ code: 'hidden_page' }));
  });

  test('a date hierarchy expanded down to the day is the date itself, in its natural order', () => {
    const line = Object.values(plan.report.bundle.report.pages[0].widgets).find((w) => w.type === 'line');
    expect(line.dataBinding.selectedDimensions).toEqual(['sales.fact_sales.d']);
    expect(line.config.zoneSorts).toEqual({ axis: 'asc' });
    expect(line.config.showXAxisTitle).toBe(false);
    // Power BI's plain line: straight, no markers, the theme's first colour.
    expect(line.config).toMatchObject({ smooth: false, lineSymbol: 'none', color: '#8800FF' });
  });

  test('line styles, one colour per measure and the gridline style follow the template', () => {
    const line = Object.values(plan.report.bundle.report.pages[0].widgets).find((w) => w.type === 'line' && w.dataBinding.selectedMeasures.length === 2);
    // The measure the template coloured keeps its colour; the other takes
    // the theme colour of its rank, as Power BI paints series.
    expect(line.config.legendColors).toEqual({ Total: '#F97000', Ratio: '#00BCF2' });
    expect(line.config).toMatchObject({ smooth: true, lineSymbol: 'circle', gridLineStyle: 'dotted', gridLineWidth: 0.3 });
  });

  test('the new card visual, a Between slicer and pie labels', () => {
    const widgets = Object.values(plan.report.bundle.report.pages[0].widgets);
    const card = widgets.find((w) => w.type === 'scorecard');
    expect(card.dataBinding.selectedMeasures).toEqual(['product.name_min']);
    expect(card.config).toMatchObject({ showLabel: false, valueColor: '#ABCDEF', valueSize: 19 });
    // A Power BI system font is not a web font: only its weight is kept, and
    // the card prints dates the way the template's culture (fr-FR) writes them.
    expect(card.config).toMatchObject({ valueWeight: 300, dateFormat: 'dd/MM/yyyy' });
    expect(card.config.valueFontFamily).toBeUndefined();
    const between = widgets.find((w) => w.type === 'filter' && w.config.slicerStyle === 'dateRange');
    expect(between.config).toMatchObject({ dateLayout: 'horizontal', dateFrom: '2026-05-01', dateTo: '2026-05-31', selectedValues: ['2026-05-01', '2026-05-31'] });
    const pie = widgets.find((w) => w.type === 'pie');
    expect(pie.config).toMatchObject({ showDataLabels: true, dataLabelContent: 'nameValue' });
  });

  test('a SELECTEDVALUE helper column binds as the column it reads; TRUE() translates', () => {
    const f = plan.model.fields;
    const slicer = Object.values(plan.report.bundle.report.pages[0].widgets).find((w) => w.type === 'filter' && w.dataBinding.selectedDimensions[0] === 'product.status');
    expect(slicer).toBeTruthy();
    // A horizontal list slicer is a row of buttons.
    expect(slicer.config.slicerStyle).toBe('buttons');
    expect(f.dimensions.find((d) => d.name === '_calcdim.d_product_is_paid').expression).toBe("CASE WHEN ((((\"product\".\"status\") = ('paid'))) AND (TRUE)) THEN 1 ELSE 0 END");
    expect(f.dimensions.find((d) => d.name === '_calcdim.d_product_sel_status')).toBeUndefined();
  });

  test('a table keeps the names its columns were given', () => {
    const table = Object.values(plan.report.bundle.report.pages[1].widgets).find((w) => w.type === 'table');
    expect(table.config.tableConfig.columns).toEqual({ name: { displayName: 'Product' } });
  });
});

describe('pbit — the plan compiles once imported', () => {
  test('translated, hoisted and draft measures all produce SQL', async () => {
    const owner = seedUser({ role: 'editor' });
    const ds = seedDatasource({ userId: owner, dbType: 'postgres' });
    const plan = analyzePbit(legacyPbit(), { fileName: 'compile.pbit' });
    const imp = await request(app).post('/api/models/import').set('x-test-user', owner)
      .send({ yaml: plan.model.yaml, datasourceId: ds });
    expect(imp.status).toBe(201);
    const modelId = imp.body.model.id;
    const q = await request(app).post(`/api/models/${modelId}/query`).set('x-test-user', owner)
      .send({ dimensionNames: ['product.name'], measureNames: ['_calc.total', '_calc.paid', '_calc.ratio', '_calc.mix', '_calc.ly'], sqlOnly: true });
    expect(q.status).toBe(200);
    const sql = q.body.sql;
    expect(sql).toContain('SUM("sales"."fact_sales"."amount") AS "Total"');
    // the CALCULATE filter became a CASE WHEN inside the aggregate
    expect(sql).toContain('COUNT(CASE WHEN "product"."status" = \x27paid\x27 THEN "sales"."fact_sales"."id" END) AS "Paid"');
    expect(sql).toContain(') * 100) AS "Ratio"');
    // No date filter in the query: the shifted measure reads as its base.
    expect(sql).toContain('(SUM(CAST("sales"."fact_sales"."amount" AS NUMERIC))) AS "LY"');
    expect(sql).toContain('LEFT JOIN "product" ON "product"."id" = "sales"."fact_sales"."product_id"');
    // The role table's column compiles as its lookup, grouped by it, with no
    // second join on the product table.
    const q2 = await request(app).post(`/api/models/${modelId}/query`).set('x-test-user', owner)
      .send({ dimensionNames: ['_calcdim.d_product_cible_f_sales_name'], measureNames: ['_calc.total'], sqlOnly: true });
    expect(q2.status).toBe(200);
    expect(q2.body.sql).toContain('((SELECT r.name FROM product r WHERE r.id = "sales"."fact_sales"."product2_id")) AS "name (d_product_cible)"');
    expect(q2.body.sql).toContain('GROUP BY ((SELECT r.name FROM product r WHERE r.id = "sales"."fact_sales"."product2_id"))');
    expect(q2.body.sql).not.toContain('LEFT JOIN');
  });
});

describe('POST /api/import/pbit', () => {
  test('returns the plan, rejects other files and anonymous callers', async () => {
    const editor = seedUser({ role: 'editor' });
    const viewer = seedUser({ role: 'viewer' });
    const ok = await request(app).post('/api/import/pbit').set('x-test-user', editor)
      .attach('file', legacyPbit(), 'Shop report.pbit');
    expect(ok.status).toBe(200);
    expect(ok.body.plan.model.name).toBe('Shop report');
    expect(ok.body.plan.datasource.dbType).toBe('postgres');

    const bad = await request(app).post('/api/import/pbit').set('x-test-user', editor)
      .attach('file', Buffer.from('nope'), 'notes.txt');
    expect(bad.status).toBe(400);

    const notZip = await request(app).post('/api/import/pbit').set('x-test-user', editor)
      .attach('file', Buffer.from('nope'), 'broken.pbit');
    expect(notZip.status).toBe(400);
    expect(notZip.body.error).toMatch(/zip/i);

    // Analysis writes nothing: in the OSS edition any signed-in user may run it,
    // the create endpoints it feeds enforce their own rules (cloud adds authz).
    const viewerRun = await request(app).post('/api/import/pbit').set('x-test-user', viewer)
      .attach('file', legacyPbit(), 'Shop report.pbit');
    expect(viewerRun.status).toBe(200);

    const anon = await request(app).post('/api/import/pbit').attach('file', legacyPbit(), 'Shop report.pbit');
    expect(anon.status).toBe(401);
  });
});
