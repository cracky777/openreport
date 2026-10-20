// Every option of every visual in the assistant's hands (asked by Jonathan:
// fonts, label colors, frames, gradients, a border taken off where a visual
// reads better without), each held to the property panel's own ranges and
// choices; the page's look through report_settings; the brand rule with a
// second color and the frame. The server's lists and the browser's must not
// drift apart: a key the server accepts and the browser drops was the case
// of ten keys before this file.
const fs = require('fs');
const path = require('path');
const { DESIGN_CONFIG, TABLE_LOOK, PAGE_LOOK, validateDesignProposal, pickDesignConfig } = require('../utils/ai/validateProposal');
const { FONT_FAMILIES } = require('../utils/ai/fonts');
const { colorOps, contrast, SURFACES } = require('../utils/ai/colorScheme');

const client = (file) => fs.readFileSync(path.join(__dirname, '../../client/src', file), 'utf8');
const quoted = (text) => [...text.matchAll(/'([^']+)'/g)].map((m) => m[1]);
const between = (text, start, end) => { const i = text.indexOf(start); return text.slice(i + start.length, text.indexOf(end, i)); };

describe('the server and the browser hold the same lists', () => {
  const proposal = client('utils/aiProposal.js');
  test('the design keys', () => {
    expect(quoted(between(proposal, 'export const DESIGN_KEYS = [', '];')).sort()).toEqual(Object.keys(DESIGN_CONFIG).sort());
  });
  test('the look of a table, group by group', () => {
    const body = between(proposal, 'const TABLE_LOOK = {', '};');
    for (const [group, keys] of Object.entries(TABLE_LOOK)) {
      const line = body.split('\n').find((l) => l.trim().startsWith(`${group}:`));
      expect(quoted(line).sort()).toEqual(Object.keys(keys).sort());
    }
  });
  test('the page\'s look', () => {
    expect(quoted(between(proposal, 'export const PAGE_LOOK_KEYS = [', '];')).sort()).toEqual(Object.keys(PAGE_LOOK).sort());
  });
  test('the fonts the client bundles', () => {
    const families = [...between(client('utils/googleFonts.js'), 'export const GOOGLE_FONTS = [', '];').matchAll(/family: '([^']+)'/g)].map((m) => m[1]);
    expect(families.filter((f) => f !== 'System default').sort()).toEqual([...FONT_FAMILIES].sort());
  });
});

const ctx = (widgets, extra = {}) => ({
  page: { width: 1140, height: 800 },
  pageContext: { theme: 'light', themes: ['light', 'dark'], pageWidth: 1140, pageHeight: 800, widgets, ...extra },
  effective: { dimensions: [{ name: 't.d', label: 'Day', type: 'date' }, { name: 't.c', label: 'Country', type: 'string' }], measures: [] },
});
const W = (id, type, dataBinding = {}) => ({ id, type, title: id, dataBinding, layout: { x: 20, y: 20, w: 400, h: 200 }, config: {} });

describe('every option of a visual', () => {
  test('fonts of the list, objects key by key, the panel\'s ranges', () => {
    const picked = pickDesignConfig({
      titleFontFamily: 'Playfair Display', valueFontFamily: 'Comic Sans', labelFontFamily: null,
      gradientBg: { enabled: true, angle: 400, color1: '#142D5A', color2: 'navy', extra: 1 },
      shadow: { enabled: true, blur: 99 }, valueSize: 200, borderEnabled: false,
      n1PercentStyle: { position: 'left', positiveColor: '#16a34a', base: 'current' },
      tableConfig: { header: { fontFamily: 'Inter', alignment: 'center', fontSize: 40 }, grid: { cellPadding: 1 } },
      legendImages: { a: 'http://x' }, url: '/uploads/x.png', dataLimit: 10,
    });
    expect(picked).toEqual({
      titleFontFamily: 'Playfair Display', labelFontFamily: null,
      gradientBg: { enabled: true, angle: 360, color1: '#142D5A' },
      shadow: { enabled: true, blur: 40 }, valueSize: 72, borderEnabled: false,
      n1PercentStyle: { position: 'left', positiveColor: '#16a34a' },
      tableConfig: { header: { fontFamily: 'Inter', alignment: 'center', fontSize: 24 }, grid: { cellPadding: 2 } },
    });
  });

  test('the page\'s gradient, the color around it, its border and shadow through report_settings', () => {
    const { ops, errors } = validateDesignProposal({ summary: 's', ops: [{ op: 'report_settings', set: { gradientBg: { enabled: true, color1: '#f8fafc', color2: '#e2e8f0' }, surroundColor: null, showShadow: false } }] }, ctx([]));
    expect(errors).toEqual([]);
    expect(ops).toEqual([{ op: 'report_settings', set: { gradientBg: { enabled: true, color1: '#f8fafc', color2: '#e2e8f0' }, surroundColor: null, showShadow: false } }]);
    expect(validateDesignProposal({ summary: 's', ops: [{ op: 'report_settings', set: { showBorder: 'yes' } }] }, ctx([])).errors[0]).toMatch(/showBorder/);
  });
});

describe('the brand rule', () => {
  const widgets = [W('trend', 'line', { selectedDimensions: ['t.d'], selectedMeasures: ['m1', 'm2'] }), W('kpi', 'scorecard', { selectedMeasures: ['m1'] }), W('logo', 'image')];
  test('the second color is the series a comparison sets against the first, readable as a line', () => {
    const [trend] = colorOps('monochromatic', '#142D5A', { theme: 'light', widgets }, [], { accentHex: '#F58C1E' });
    expect(trend.set.palette[1]).not.toBe(trend.set.palette[0]);
    expect(contrast(trend.set.palette[1], SURFACES.light.background)).toBeGreaterThanOrEqual(3);
  });
  test('the frame: titles readable as text, borders, the page tinted — never on the dressing', () => {
    const ops = colorOps('monochromatic', '#142D5A', { theme: 'light', widgets }, [], { frame: true });
    const kpi = ops.find((o) => o.widgetId === 'kpi');
    expect(kpi.set).toMatchObject({ borderEnabled: true });
    expect(contrast(kpi.set.titleColor, SURFACES.light.background)).toBeGreaterThanOrEqual(4.5);
    expect(ops.find((o) => o.widgetId === 'logo')).toBeUndefined();
    expect(ops.find((o) => o.op === 'report_settings').set.pageBackground).toMatch(/^#[0-9a-f]{6}$/);
  });
  test('the frame stays the model\'s to adjust: a figure without a border', () => {
    const { ops, errors } = validateDesignProposal({
      summary: 's', colorScheme: 'monochromatic', baseColor: '#142D5A', frame: true,
      ops: [{ op: 'update_config', widgetId: 'trend', set: { borderEnabled: false, palette: ['#000000'] } }],
    }, ctx(widgets));
    expect(errors).toEqual([]);
    const byHand = ops.filter((o) => o.widgetId === 'trend').pop();
    expect(byHand.set).toEqual({ borderEnabled: false });
  });
});
