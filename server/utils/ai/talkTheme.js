// The colors of Let's Talk. By default Open Report's own: its accent (the
// violet of the app) as the base of the categorical rule (colorScheme.js),
// computed for the surface the user reads on — dark or light, the app's
// theme. A user who asks for other colors gets a theme of their own (a base
// and a rule), kept on their account (`users.talk_theme`) and applied to
// every answer of Let's Talk from then on. A visual added to a report leaves
// these colors behind: it takes the report's (routes/reports.js).

const { HARMONIES, harmonySeries, SURFACES } = require('./colorScheme');

const OPEN_REPORT_BASE = '#7c3aed';
const HEX = /^#[0-9a-f]{6}$/i;

/** A stored or sent theme, or null: { base: '#rrggbb', harmony: one of HARMONIES }. */
function cleanTalkTheme(raw) {
  const t = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { /* not JSON: no theme */ return null; } })() : raw;
  if (!t || typeof t !== 'object' || !HEX.test(t.base || '')) return null;
  const harmony = Object.prototype.hasOwnProperty.call(HARMONIES, t.harmony) ? t.harmony : 'categorical';
  return { base: t.base.toLowerCase(), harmony };
}

/** The colors Let's Talk draws with for this user: their theme, else Open Report's. */
function talkColorsOf(stored) {
  return cleanTalkTheme(stored) || { base: OPEN_REPORT_BASE, harmony: 'categorical' };
}

/** A few colors of a theme, for the card that offers it. */
function swatchesOf({ base, harmony }, theme = 'light') {
  return harmonySeries(harmony, base, SURFACES[theme === 'dark' ? 'dark' : 'light']).slice(0, 6);
}

module.exports = { OPEN_REPORT_BASE, cleanTalkTheme, talkColorsOf, swatchesOf };
