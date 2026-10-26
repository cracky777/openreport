// The colors of Let's Talk (server utils/ai/talkTheme.js): the user's theme,
// or Open Report's own accent as the base, computed for the app's theme.
export const OPEN_REPORT_BASE = '#7c3aed';

/** What the answers should be drawn with now. */
export function talkColorsFor(talkTheme, surface) {
  return {
    base: talkTheme?.base || OPEN_REPORT_BASE,
    harmony: talkTheme?.harmony || 'categorical',
    theme: surface === 'dark' ? 'dark' : 'light',
  };
}

/** Whether an answer was drawn with these colors (`proposal.colors`, set by the server). */
export const sameColors = (a, b) => !!a && !!b && a.base === b.base && a.harmony === b.harmony && a.theme === b.theme;

/** The widgets of an answer, whatever its kind, and how to put recolored configs back. */
export function answerWidgets(proposal) {
  if (proposal?.kind === 'widgets') return proposal.widgets || [];
  if (proposal?.kind === 'report') return (proposal.pages || []).flatMap((p) => p.widgets || []);
  return [];
}

export function withConfigs(proposal, configs, colors) {
  let k = 0;
  const redraw = (widgets) => (widgets || []).map((w) => ({ ...w, config: configs[k++] || w.config }));
  const next = proposal.kind === 'report'
    ? { ...proposal, pages: proposal.pages.map((p) => ({ ...p, widgets: redraw(p.widgets) })) }
    : { ...proposal, widgets: redraw(proposal.widgets) };
  return { ...next, colors };
}
