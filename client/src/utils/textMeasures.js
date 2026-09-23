import { parseAggVariant } from './aggVariant';

// Measures inside a Text visual.
//
// The text names a measure with a tag, "#revenue", written like any other
// word: the author binds measures in the Fields section, and each one is
// reachable in the text by its tag. A tag is the measure's label folded to
// one word — lower case, letters and digits, anything else an underscore —
// so "Avg basket" is #avg_basket and a column read as a measure, "Category
// (Max)", is #category_max. The same folding runs on what the author typed,
// so #Avg_Basket finds the measure too.
//
// The tag is a rendering concern only: what the visual queries is
// `dataBinding.selectedMeasures`, like a scorecard, and what it prints is the
// text with each known tag replaced by the value that came back.

export function measureTag(label) {
  return String(label || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '');
}

// The label a bound entry is known by in the model: a measure's own, or the
// column's plus its aggregation for a variant ("<label> (<fn>)") — the same
// spelling the query aliases it under, so panel, planner and data agree.
export function boundLabel(name, model) {
  const meas = (model?.measures || []).find((m) => m.name === name);
  if (meas) return meas.label || meas.name;
  const v = parseAggVariant(name);
  if (v) {
    const base = (model?.measures || []).find((m) => m.name === v.base)
      || (model?.dimensions || []).find((d) => d.name === v.base);
    if (base) return `${base.label || base.name} (${v.agg})`;
  }
  return name;
}

export function tagFor(name, model) {
  return measureTag(boundLabel(name, model));
}

// A word after '#': letters, digits and underscores, any script.
const TAG_RE = /#([\p{L}\p{N}_]+)/gu;

// The text with every tag that `render` knows replaced by what it returns;
// a tag it does not know (a typo, a measure not yet bound, a hashtag) stays
// as typed. `render(tag)` returns a string, or undefined to leave it.
export function fillTags(text, render) {
  return String(text || '').replace(TAG_RE, (whole, word) => {
    const out = render(measureTag(word));
    return out === undefined ? whole : out;
  });
}

export function tagsInText(text) {
  const out = new Set();
  for (const m of String(text || '').matchAll(TAG_RE)) out.add(measureTag(m[1]));
  return [...out];
}
