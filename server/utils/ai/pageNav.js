// The report's page menu in the designer's hands (asked by Jonathan: "l'agent
// designer peut aussi avoir la main sur le design du menu — icônes, couleurs,
// format, police, emplacement"). The menu's look lives in the report settings
// (`settings.pageNav`, client PagesColumn / PagesTabs); the design tool sets
// it with ONE op, `page_nav`: the look of the menu as a whole, and an icon per
// page, by name from a closed catalogue (client utils/pageNav.js draws them —
// the two lists are held equal by tests/aiPageNav.test.js). An image only
// as the menu's LOGO, and only one the user added to the conversation, by
// name (asked by Jonathan: the company's logo in the menu); a page's
// uploaded icon stays the author's.

const HEX = /^#[0-9a-f]{6}$/i;
const color = (v) => (typeof v === 'string' && HEX.test(v) ? v : undefined);
const num = (min, max) => (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(Math.max(v, min), max)) : undefined);
const oneOf = (list) => (v) => (list.includes(v) ? v : undefined);
const text = (max) => (v) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);

function navLook(fontCheck) {
  return {
    // Where the menu sits: a column on the left or the right, a bar on top.
    position: oneOf(['left', 'top', 'right']),
    bgColor: color,
    textColor: color,
    hoverBgColor: color,
    activeBgColor: color,
    activeTextColor: color,
    titleColor: color,
    borderColor: color,
    fontFamily: fontCheck,
    fontSize: num(10, 18),
    fontWeight: oneOf([400, 500, 600, 700]),
    buttonSize: num(24, 56),
    width: num(120, 320),
    itemRadius: num(0, 20),
    title: text(60),
    headerAlign: oneOf(['left', 'center', 'right']),
    // The logo at the head of the menu: its height (a wordmark wants room),
    // logo and title side by side or stacked, the logo first or last.
    logoSize: num(16, 120),
    // A plate behind the logo: a dark logo on a dark menu (Mutuelle Horizon's
    // navy wordmark vanished on its navy column) without restyling the menu.
    logoBgColor: color,
    headerLayout: oneOf(['horizontal', 'vertical']),
    headerLogoPosition: oneOf(['before', 'after']),
  };
}

const PAGE_ICONS = [
  'home', 'dashboard', 'chart-bar', 'chart-line', 'chart-pie', 'chart-donut', 'table', 'list',
  'users', 'user', 'building', 'store', 'bank', 'truck', 'delivery', 'package', 'car',
  'map', 'map-pin', 'world', 'calendar', 'calendar-stats', 'clock', 'euro', 'coin', 'cash',
  'receipt', 'cart', 'briefcase', 'heart', 'stethoscope', 'pill', 'flask', 'shield', 'alert',
  'target', 'trending-up', 'gauge', 'scale', 'percentage', 'bed', 'kitchen', 'chef', 'phone',
  'mail', 'star', 'flag', 'file', 'settings',
];
const ICONS = new Set(PAGE_ICONS);
const PAGE_ALIAS = /^p(\d+)$/;

// The page an alias names: p1 the page shown, p2… the others in context order.
function pageIdOf(alias, pageContext) {
  if (alias === 'p1') return pageContext.pageId || null;
  const m = PAGE_ALIAS.exec(String(alias || ''));
  const other = m ? (pageContext.otherPages || [])[Number(m[1]) - 2] : null;
  return other ? other.id : null;
}

/**
 * One `page_nav` op, checked: `{ op, set, icons }` with page ids, or `{ error }`.
 * `icons` maps a page alias to an icon name, or to "none" to take it off.
 */
const ASSET_URL = /^\/uploads\/images\/[A-Za-z0-9._-]+$/;

function validatePageNavOp(raw, pageContext, fontCheck, assets = []) {
  const look = navLook(fontCheck);
  const src = raw.set && typeof raw.set === 'object' ? raw.set : {};
  const set = {};
  for (const [key, value] of Object.entries(src)) {
    if (!look[key]) return { error: `${key} is not a setting of the page menu (${Object.keys(look).join(', ')})` };
    const v = look[key](value);
    if (v === undefined) return { error: `${key} is not a valid value for the page menu` };
    set[key] = v;
  }
  const icons = {};
  const asked = raw.icons && typeof raw.icons === 'object' ? raw.icons : {};
  for (const [alias, name] of Object.entries(asked)) {
    const id = pageIdOf(alias, pageContext);
    if (!id) return { error: `icons: ${alias} is not a page (p1 is the page shown, p2… the others)` };
    if (name !== 'none' && !ICONS.has(name)) return { error: `icons: ${JSON.stringify(name)} is not an icon of the catalogue` };
    icons[id] = name === 'none' ? null : name;
  }
  // The logo: an image the user added, by name, or "none" to take it off.
  let logo;
  if (raw.logo !== undefined) {
    if (raw.logo === 'none') logo = null;
    else {
      const asset = assets.find((a) => a && a.name === raw.logo);
      if (!asset || !ASSET_URL.test(asset.url)) return { error: `logo: an image the user added, by name${assets.length ? `: ${assets.map((a) => a.name).join(', ')}` : ' — none was added to this conversation'}` };
      logo = asset.url;
    }
  }
  if (!Object.keys(set).length && !Object.keys(icons).length && logo === undefined) return { error: 'page_nav: nothing to set' };
  return { op: { op: 'page_nav', set, icons, ...(logo !== undefined ? { logo } : {}) } };
}

/** The menu as the browser describes it, cleaned: its look and its icons by page id. */
function cleanPageNav(raw, fontCheck) {
  if (!raw || typeof raw !== 'object') return null;
  const look = navLook(fontCheck);
  const out = {};
  for (const [key, check] of Object.entries(look)) {
    const v = check(raw[key]);
    if (v !== undefined && v !== null) out[key] = v;
  }
  const icons = {};
  for (const [id, name] of Object.entries(raw.icons && typeof raw.icons === 'object' ? raw.icons : {}).slice(0, 40)) {
    if (ICONS.has(name)) icons[String(id).slice(0, 80)] = name;
  }
  if (Object.keys(icons).length) out.icons = icons;
  if (raw.hasLogo === true) out.hasLogo = true;
  return out;
}

/** The prompt's lines on the menu: its look now, its icons by page alias. */
function pageNavLines(pageContext) {
  const nav = pageContext.pageNav || {};
  const aliases = new Map([[pageContext.pageId, 'p1'], ...(pageContext.otherPages || []).map((p, i) => [p.id, `p${i + 2}`])]);
  const { icons = {}, ...look } = nav;
  const byAlias = Object.fromEntries(Object.entries(icons).map(([id, name]) => [aliases.get(id), name]).filter(([a]) => a));
  return [
    `Page menu (op page_nav): now ${JSON.stringify(look)}${Object.keys(byAlias).length ? `, icons ${JSON.stringify(byAlias)}` : ', no icons'} — the app's defaults where a key is missing (a column on the left, theme colors). Icons, by name: ${PAGE_ICONS.join(', ')}. Its head may carry the company's logo ("logo": the name of an image the user added, "none" to take it off; logoSize its height, logoBgColor a plate behind it when the logo would not read on the menu, headerLayout horizontal or vertical beside or above the title) — a logo in the menu is seen on every page.`,
  ];
}

module.exports = { PAGE_ICONS, navLook, validatePageNavOp, cleanPageNav, pageNavLines };
