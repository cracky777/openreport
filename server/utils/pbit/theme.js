// The report theme: what Power BI colours mean when a visual does not spell
// them out. A visual property can hold `ThemeDataColor { ColorId, Percent }`
// instead of a literal: ColorId 0 is the theme background, 1 its foreground,
// 2 and up the data colours in order; Percent shades it towards white (>0)
// or black (<0). The theme also carries defaults every visual inherits —
// text classes (callout / label / title / header colours and sizes) and
// per-object styles such as "every visual background is transparent".
//
// A template ships its base theme (SharedResources/BaseThemes) and,
// optionally, a custom one (RegisteredResources) layered over it.

function hexToRgb(hex) {
  const m = String(hex || '').trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('');
}

// Power BI's shade: `percent` in [-1, 1], positive mixes with white,
// negative with black.
function shade(hex, percent) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const p = Number(percent) || 0;
  if (!p) return rgbToHex(rgb);
  const target = p > 0 ? 255 : 0;
  const t = Math.min(1, Math.abs(p));
  return rgbToHex(rgb.map((c) => c + (target - c) * t));
}

function mergeTheme(base, custom) {
  const b = base || {};
  const c = custom || {};
  const textClasses = { ...(b.textClasses || {}) };
  for (const [k, v] of Object.entries(c.textClasses || {})) textClasses[k] = { ...(textClasses[k] || {}), ...v };
  return {
    name: c.name || b.name || null,
    dataColors: Array.isArray(c.dataColors) && c.dataColors.length ? c.dataColors : (b.dataColors || []),
    background: c.background || b.background || '#FFFFFF',
    foreground: c.foreground || b.foreground || '#252423',
    tableAccent: c.tableAccent || b.tableAccent || null,
    textClasses,
    // Custom styles win object by object; the base fills the rest.
    visualStyles: [b.visualStyles || {}, c.visualStyles || {}],
  };
}

function loadTheme(pbit, themeCollection) {
  const tc = themeCollection || {};
  const read = (p) => { try { return pbit.readJson(p); } catch { /* a theme file that is not JSON: ignored */ return null; } };
  const base = tc.baseTheme && tc.baseTheme.name ? read(`Report/StaticResources/SharedResources/BaseThemes/${tc.baseTheme.name}.json`) : null;
  const custom = tc.customTheme && tc.customTheme.name ? read(`Report/StaticResources/RegisteredResources/${tc.customTheme.name}`) : null;
  return mergeTheme(base, custom);
}

function themeColor(theme, colorId, percent) {
  const id = Number(colorId);
  let hex;
  if (id === 0) hex = theme.background;
  else if (id === 1) hex = theme.foreground;
  else hex = theme.dataColors[id - 2];
  if (!hex) return null;
  return shade(hex, percent);
}

// `visualStyles[visualType]['*'][objectName][0][prop]`, the '*' visual as a
// fallback, custom theme before base. Undefined when no theme says.
function themeStyle(theme, visualType, objectName, prop) {
  const layers = [...(theme.visualStyles || [])].reverse();
  for (const styles of layers) {
    for (const vt of [visualType, '*']) {
      const entries = styles && styles[vt] && styles[vt]['*'] && styles[vt]['*'][objectName];
      const e = Array.isArray(entries) ? entries[0] : null;
      if (e && e[prop] !== undefined) return e[prop];
    }
  }
  return undefined;
}

// A text class's colour / size, custom over base.
function textClass(theme, name) {
  return (theme.textClasses && theme.textClasses[name]) || {};
}

// Deep copy of `node` with every ThemeDataColor expression replaced by the
// literal it resolves to, so the readers only ever see literals.
function resolveThemeColors(node, theme) {
  if (Array.isArray(node)) return node.map((n) => resolveThemeColors(n, theme));
  if (!node || typeof node !== 'object') return node;
  if (node.ThemeDataColor && typeof node.ThemeDataColor === 'object') {
    const hex = themeColor(theme, node.ThemeDataColor.ColorId, node.ThemeDataColor.Percent);
    return hex ? { Literal: { Value: `'${hex}'` } } : node;
  }
  const out = {};
  for (const [k, v] of Object.entries(node)) out[k] = resolveThemeColors(v, theme);
  return out;
}

const EMPTY_THEME = mergeTheme(null, null);

module.exports = { loadTheme, mergeTheme, themeColor, themeStyle, textClass, resolveThemeColors, shade, EMPTY_THEME };
