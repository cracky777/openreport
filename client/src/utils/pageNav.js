// The report's page menu, as the author and the designer assistant set it
// (`settings.pageNav`; server utils/ai/pageNav.js holds the same keys and the
// same icon names, tests/aiPageNav.test.js keeps them equal): where it sits,
// its colors by state, its font, and an icon per page by name.
import {
  TbHome, TbLayoutDashboard, TbChartBar, TbChartLine, TbChartPie, TbChartDonut, TbTable, TbListDetails,
  TbUsers, TbUser, TbBuilding, TbBuildingStore, TbBuildingBank, TbTruck, TbTruckDelivery, TbPackage, TbCar,
  TbMap, TbMapPin, TbWorld, TbCalendar, TbCalendarStats, TbClock, TbCurrencyEuro, TbCoin, TbCash,
  TbReceipt, TbShoppingCart, TbBriefcase, TbHeart, TbStethoscope, TbPill, TbFlask, TbShield, TbAlertTriangle,
  TbTarget, TbTrendingUp, TbGauge, TbScale, TbPercentage, TbBed, TbToolsKitchen2, TbChefHat, TbPhone,
  TbMail, TbStar, TbFlag, TbFileText, TbSettings,
} from 'react-icons/tb';
import { fontStack, loadGoogleFont } from './googleFonts';

export const PAGE_ICONS = {
  'home': TbHome, 'dashboard': TbLayoutDashboard, 'chart-bar': TbChartBar, 'chart-line': TbChartLine, 'chart-pie': TbChartPie,
  'chart-donut': TbChartDonut, 'table': TbTable, 'list': TbListDetails, 'users': TbUsers, 'user': TbUser,
  'building': TbBuilding, 'store': TbBuildingStore, 'bank': TbBuildingBank, 'truck': TbTruck, 'delivery': TbTruckDelivery,
  'package': TbPackage, 'car': TbCar, 'map': TbMap, 'map-pin': TbMapPin, 'world': TbWorld,
  'calendar': TbCalendar, 'calendar-stats': TbCalendarStats, 'clock': TbClock, 'euro': TbCurrencyEuro, 'coin': TbCoin,
  'cash': TbCash, 'receipt': TbReceipt, 'cart': TbShoppingCart, 'briefcase': TbBriefcase, 'heart': TbHeart,
  'stethoscope': TbStethoscope, 'pill': TbPill, 'flask': TbFlask, 'shield': TbShield, 'alert': TbAlertTriangle,
  'target': TbTarget, 'trending-up': TbTrendingUp, 'gauge': TbGauge, 'scale': TbScale, 'percentage': TbPercentage,
  'bed': TbBed, 'kitchen': TbToolsKitchen2, 'chef': TbChefHat, 'phone': TbPhone, 'mail': TbMail,
  'star': TbStar, 'flag': TbFlag, 'file': TbFileText, 'settings': TbSettings,
};

// The menu's look the assistant may set (server pageNav.navLook).
export const PAGE_NAV_KEYS = [
  'position', 'bgColor', 'textColor', 'hoverBgColor', 'activeBgColor', 'activeTextColor', 'titleColor', 'borderColor',
  'fontFamily', 'fontSize', 'fontWeight', 'buttonSize', 'width', 'itemRadius', 'title', 'headerAlign',
  'logoSize', 'logoBgColor', 'headerLayout', 'headerLogoPosition',
];

// Theme-aware defaults when nothing is set.
const STATE_DEFAULTS = {
  default: { bg: 'transparent', text: 'var(--text-muted)' },
  hover: { bg: 'var(--bg-subtle)', text: 'var(--accent-primary)' },
  active: { bg: 'var(--bg-active)', text: 'var(--accent-primary)' },
  pressed: { bg: 'var(--bg-active)', text: 'var(--accent-primary)' },
};

/** The colors of an item in a state, from the menu's own colors, then the theme. */
export function navStateColors(config, state) {
  const c = config || {};
  const base = STATE_DEFAULTS[state] || STATE_DEFAULTS.default;
  if (state === 'active' || state === 'pressed') return { bg: c.activeBgColor || base.bg, text: c.activeTextColor || base.text };
  if (state === 'hover') return { bg: c.hoverBgColor || base.bg, text: c.activeTextColor || base.text };
  return { bg: base.bg, text: c.textColor || base.text };
}

/** The menu's font: a curated family (loaded on demand) or a CSS stack the settings panel wrote. */
export function navFont(family) {
  if (!family) return 'inherit';
  if (family.includes(',')) return family;
  loadGoogleFont(family);
  return fontStack(family);
}

/** A page's icon component by its name, or null. */
export function pageIconOf(config, pageId) {
  const entry = (config?.pageIcons || {})[pageId];
  const name = entry && typeof entry === 'object' ? entry.icon : null;
  return (name && PAGE_ICONS[name]) || null;
}

/**
 * The report settings with a `page_nav` op of the designer applied: the look
 * merged into the menu's, an icon set (or taken off, null) per page, the
 * logo set to an image the user added (or taken off, null). A page's
 * uploaded icon is never touched.
 */
export function withPageNav(settings, op) {
  const nav = { ...(settings?.pageNav || {}) };
  for (const k of PAGE_NAV_KEYS) if (op?.set?.[k] !== undefined) nav[k] = op.set[k];
  const icons = { ...(nav.pageIcons || {}) };
  for (const [pageId, name] of Object.entries(op?.icons || {})) {
    const entry = icons[pageId] && typeof icons[pageId] === 'object' ? { ...icons[pageId] } : (typeof icons[pageId] === 'string' ? { default: { image: icons[pageId] } } : {});
    if (name && PAGE_ICONS[name]) entry.icon = name;
    else delete entry.icon;
    if (Object.keys(entry).length) icons[pageId] = entry;
    else delete icons[pageId];
  }
  nav.pageIcons = icons;
  if (op?.logo) nav.logo = op.logo;
  else if (op?.logo === null) delete nav.logo;
  return { ...(settings || {}), pageNav: nav };
}

/** What the assistant is told of the menu: its look and icons, never an image. */
export function describePageNav(config) {
  const c = config || {};
  const out = {};
  for (const k of PAGE_NAV_KEYS) if (c[k] !== undefined && c[k] !== null && c[k] !== '') out[k] = c[k];
  const icons = {};
  for (const [id, entry] of Object.entries(c.pageIcons || {})) if (entry && typeof entry === 'object' && entry.icon) icons[id] = entry.icon;
  if (Object.keys(icons).length) out.icons = icons;
  if (c.logo) out.hasLogo = true;
  return out;
}
