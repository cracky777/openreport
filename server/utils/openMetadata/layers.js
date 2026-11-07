// The medallion layer of a catalog entity (bronze, silver, gold), drawn on the
// lineage card. OpenMetadata has no field for it: its Tier classification
// (Tier1…Tier5) says how much an asset matters, not where it sits. Read, first
// one that answers: the asset's certification (Bronze / Silver / Gold are the
// default levels), a tag named Bronze, Silver or Gold in any classification,
// then the admin's rules — an FQN prefix per layer, for a catalog that tags
// nothing (Nyukom: `garage_s3.rawdata` bronze, `garage_s3.staging` silver,
// `postgres_dwh` gold).

const LAYERS = ['bronze', 'silver', 'gold'];
const MAX_RULES = 30;
const MAX_PREFIX = 256;

const leafOf = (tagFqn) => String(tagFqn || '').split('.').pop().toLowerCase();

const layerOfTag = (tagFqn) => (LAYERS.includes(leafOf(tagFqn)) ? leafOf(tagFqn) : null);

/** The admin's rules, kept only when well formed. Throws on a bad one: the form says which. */
function cleanLayerRules(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new Error('Layer rules must be a list');
  if (raw.length > MAX_RULES) throw new Error(`At most ${MAX_RULES} layer rules`);
  return raw.map((r, i) => {
    const prefix = String((r && r.prefix) || '').trim();
    const layer = String((r && r.layer) || '').toLowerCase();
    if (!prefix || prefix.length > MAX_PREFIX || [...prefix].some((ch) => ch.charCodeAt(0) < 32)) throw new Error(`Layer rule ${i + 1}: give the start of a fully qualified name, such as garage_s3.rawdata`);
    if (!LAYERS.includes(layer)) throw new Error(`Layer rule ${i + 1}: the layer is bronze, silver or gold`);
    return { prefix, layer };
  });
}

// The longest prefix that is the FQN itself or ends at one of its dots.
function layerOfFqn(fqn, rules = []) {
  const f = String(fqn || '').toLowerCase();
  let best = null;
  for (const r of rules) {
    const p = r.prefix.toLowerCase();
    if ((f === p || f.startsWith(`${p}.`)) && (!best || p.length > best.prefix.length)) best = { prefix: p, layer: r.layer };
  }
  return best ? best.layer : null;
}

/**
 * @param {string} fqn
 * @param {{ tags?: object[], certification?: object }|null} entity  as OpenMetadata returns it, or null when not read
 * @param {{ prefix: string, layer: string }[]} rules
 * @returns {string|null} bronze | silver | gold
 */
function layerOf(fqn, entity, rules) {
  const certified = entity && entity.certification && entity.certification.tagLabel && layerOfTag(entity.certification.tagLabel.tagFQN);
  if (certified) return certified;
  const tagged = entity && Array.isArray(entity.tags) ? entity.tags.map((t) => layerOfTag(t && t.tagFQN)).find(Boolean) : null;
  return tagged || layerOfFqn(fqn, rules);
}

/** "Tier1"… when the asset carries one, shown beside the layer. */
function tierOf(entity) {
  const tag = entity && Array.isArray(entity.tags) ? entity.tags.find((t) => t && /^Tier\./.test(t.tagFQN || '')) : null;
  return tag ? tag.tagFQN.slice(5) : null;
}

module.exports = { layerOf, tierOf, cleanLayerRules, LAYERS };
