// What the assistant's cards say of the measures a proposal defines and of
// the visuals it adds (server: utils/ai/reportMeasures.js, the closed kinds).

/** A measure the proposal defines, in words: what it is made of — and whether it replaces one the assistant made before. */
export function measureLine(m) {
  return m.redefines ? `${madeOf(m)} (replaces the earlier definition)` : madeOf(m);
}

function madeOf(m) {
  if (m.lastValue) return `${m.label}: ${m.aggregation} of ${m.column} on the last date of ${m.lastValue.dim}`;
  if (m.runningTotal) return `${m.label}: running total of ${m.column}`;
  if (m.since) return `${m.label}: ${m.aggregation} of the days from ${m.since} to ${m.column}`;
  if (m.times) return `${m.label}: sum of ${m.column} × ${m.times}, row by row`;
  if (m.perPeriod) return `${m.label}: ${m.aggregation} of ${m.column}, added for each ${m.perPeriod.dim}`;
  if (m.aggregation === 'custom') return `${m.label} = ${String(m.expression || '').replace(/\$\{([^}]+)\}/g, '$1')}`;
  const rules = (m.filterRules || []).map((r) => `${r.field} ${r.op} ${(r.values && r.values.length ? r.values : [r.value]).filter((v) => v !== '' && v != null).join(', ')}`).join(' and ');
  return `${m.label}: ${m.aggregation} of ${m.column}${rules ? ` where ${rules}` : ''}`;
}

/**
 * A visual by what the reader sees of it: its title, else its label; the
 * page's dressing by what it is — never its type's internal name ("image",
 * "text" on a card, seen with Karim).
 */
export function visualName(w) {
  if (!w) return 'A visual';
  const c = w.config || {};
  if (c.title || c.label) return c.title || c.label;
  if (w.type === 'text') { const t = String(w.data?.text || '').trim(); return t ? `Text “${t.slice(0, 40)}”` : 'Text'; }
  if (w.type === 'image') return c.alt ? `Image (${c.alt})` : 'Image';
  if (w.type === 'shape') return c.shape === 'line' ? 'Line' : 'Shape';
  return `${w.type} visual`;
}
