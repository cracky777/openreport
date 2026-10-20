// The page menu in the designer's hands (utils/ai/pageNav.js): its place, its
// colors, its font, an icon per page by name — never an image. The server's
// lists and the browser's (client utils/pageNav.js) are the same.
const fs = require('fs');
const path = require('path');
const { validateDesignProposal } = require('../utils/ai/validateProposal');
const { PAGE_ICONS, navLook, cleanPageNav, pageNavLines } = require('../utils/ai/pageNav');
const { buildSystemPrompt } = require('../utils/ai/prompt');

const client = fs.readFileSync(path.join(__dirname, '../../client/src/utils/pageNav.js'), 'utf8');
const between = (text, start, end) => { const i = text.indexOf(start); return text.slice(i + start.length, text.indexOf(end, i)); };
const ctx = (extra = {}) => ({
  page: { width: 1140, height: 800 },
  pageContext: { theme: 'light', themes: ['light', 'dark'], pageWidth: 1140, pageHeight: 800, widgets: [], pageId: 'pg-a', pageName: 'Overview', otherPages: [{ id: 'pg-b', name: 'Sales', widgets: [] }], ...extra },
  effective: { dimensions: [], measures: [] },
});

describe('the server and the browser hold the same lists', () => {
  test('the icons', () => {
    const names = [...between(client, 'export const PAGE_ICONS = {', '};').matchAll(/'([a-z-]+)':/g)].map((m) => m[1]);
    expect(names.sort()).toEqual([...PAGE_ICONS].sort());
  });
  test('the look', () => {
    const keys = [...between(client, 'export const PAGE_NAV_KEYS = [', '];').matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(keys.sort()).toEqual(Object.keys(navLook(() => undefined)).sort());
  });
});

describe('the page_nav op', () => {
  test('the look held to its ranges, icons by page alias landing on the page ids', () => {
    const { ops, errors } = validateDesignProposal({
      summary: 's',
      ops: [{ op: 'page_nav', set: { position: 'top', activeBgColor: '#c2410c', fontFamily: 'Playfair Display', fontSize: 40, itemRadius: 8 }, icons: { p1: 'dashboard', p2: 'euro' } }],
    }, ctx());
    expect(errors).toEqual([]);
    expect(ops).toEqual([{ op: 'page_nav', set: { position: 'top', activeBgColor: '#c2410c', fontFamily: 'Playfair Display', fontSize: 18, itemRadius: 8 }, icons: { 'pg-a': 'dashboard', 'pg-b': 'euro' } }]);
  });

  test('a key, an icon or a page it does not know goes back; "none" takes an icon off', () => {
    const errorOf = (op) => validateDesignProposal({ summary: 's', ops: [{ op: 'page_nav', ...op }] }, ctx()).errors[0];
    expect(errorOf({ set: { logo: 'http://x/logo.png' } })).toMatch(/logo is not a setting/);
    expect(errorOf({ set: { position: 'bottom' } })).toMatch(/position is not a valid value/);
    expect(errorOf({ icons: { p1: 'unicorn' } })).toMatch(/not an icon/);
    expect(errorOf({ icons: { p9: 'home' } })).toMatch(/p9 is not a page/);
    expect(validateDesignProposal({ summary: 's', ops: [{ op: 'page_nav', icons: { p2: 'none' } }] }, ctx()).ops[0].icons).toEqual({ 'pg-b': null });
  });

  test('what the browser says of the menu: its look and icons, never an image; the prompt names them by page', () => {
    const fontCheck = (v) => (v === null ? null : v === 'Inter' ? v : undefined);
    const nav = cleanPageNav({ position: 'right', fontFamily: 'Inter', logo: 'data:image/png;base64,AAAA', icons: { 'pg-b': 'euro', 'pg-x': 'unicorn' }, hasLogo: true }, fontCheck);
    expect(nav).toEqual({ position: 'right', fontFamily: 'Inter', icons: { 'pg-b': 'euro' }, hasLogo: true });
    const [line] = pageNavLines({ ...ctx().pageContext, pageNav: nav });
    expect(line).toContain('"position":"right"');
    expect(line).toContain('icons {"p2":"euro"}');
    const prompt = buildSystemPrompt({ schema: { dimensions: [], measures: [] }, coverage: [], pageContext: { ...ctx().pageContext, palette: [], pageNav: nav }, mode: 'report', canQueryData: false, studio: true });
    expect(prompt).toContain('Page menu (op page_nav)');
  });
});

describe('the look of the report and its menu go together', () => {
  const restyle = { op: 'report_settings', set: { surroundColor: '#f8f1ea' } };
  test('a report-wide look without page_nav goes back once, while the menu has no look of its own', () => {
    expect(validateDesignProposal({ summary: 's', ops: [restyle] }, ctx()).warnings.join(' ')).toMatch(/page menu has no look yet: add a page_nav op/);
    expect(validateDesignProposal({ summary: 's', ops: [restyle, { op: 'page_nav', set: { position: 'top' } }] }, ctx()).warnings).toEqual([]);
    // A menu already styled, or a single page: nothing to add.
    expect(validateDesignProposal({ summary: 's', ops: [restyle] }, ctx({ pageNav: { activeBgColor: '#c2410c' } })).warnings).toEqual([]);
    expect(validateDesignProposal({ summary: 's', ops: [restyle] }, ctx({ otherPages: [] })).warnings).toEqual([]);
  });

  test('asked about the menu, a reading of colors alone keeps the op', () => {
    const r = validateDesignProposal({ summary: 's', reading: { colors: true }, ops: [{ op: 'page_nav', set: { position: 'right' } }] }, ctx());
    expect(r.ops.map((op) => op.op)).toEqual(['page_nav']);
  });
});

// The company's logo at the head of the menu (asked by Jonathan): only an
// image the user added to the conversation, by name, never a URL of the model's.
describe('the menu logo', () => {
  const withAssets = (extra) => ({ ...ctx(), assets: [{ name: 'logo.png', url: '/uploads/images/abc123.png' }], ...extra });
  test('an image the user added, by name, lands as its URL with its height', () => {
    const { ops, errors } = validateDesignProposal({ summary: 's', ops: [{ op: 'page_nav', logo: 'logo.png', set: { logoSize: 200, headerLayout: 'vertical' } }] }, withAssets());
    expect(errors).toEqual([]);
    expect(ops).toEqual([{ op: 'page_nav', set: { logoSize: 120, headerLayout: 'vertical' }, icons: {}, logo: '/uploads/images/abc123.png' }]);
  });
  test('anything else goes back; "none" takes it off', () => {
    const run = (logo, extra) => validateDesignProposal({ summary: 's', ops: [{ op: 'page_nav', logo }] }, withAssets(extra));
    expect(run('https://evil.test/x.png').errors[0]).toMatch(/an image the user added, by name: logo\.png/);
    expect(run('logo.png', { assets: [] }).errors[0]).toMatch(/none was added/);
    expect(run('none').ops).toEqual([{ op: 'page_nav', set: {}, icons: {}, logo: null }]);
  });
});
