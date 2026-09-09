/**
 * Container styling shared by the members of a merged frame.
 *
 * Merging two visuals is asking for one block. If each half kept its own
 * background, border and shadow, the seam would still read as two cards — so
 * the group agrees on one container look, and a later edit on any member is
 * applied to all of them.
 *
 * Geometry is deliberately absent: `rotation` sits in the same panel section
 * but turns each widget around its own centre, which would tear a merged block
 * apart rather than turn it.
 */

export const CONTAINER_KEYS = [
  'backgroundColor',
  'transparentBg',
  'gradientBg',
  'borderEnabled',
  'borderColor',
  'borderRadius',
  'shadow',
];

/** The container half of a widget config, with absent keys left absent. */
export function pickContainer(config) {
  const out = {};
  for (const k of CONTAINER_KEYS) {
    if (config && config[k] !== undefined) out[k] = config[k];
  }
  return out;
}

/**
 * Which side's container look the merged group should adopt.
 *
 * An existing group wins over a lone widget: dragging a third visual onto a
 * pair must not repaint the pair in the newcomer's colours. Between two groups
 * the larger one wins — fewer widgets change appearance — and a tie goes to
 * `preferId`, the widget that stays put during the merge and is therefore the
 * one the eye is anchored on.
 */
export function containerSource(widgets, aId, bId, preferId) {
  const groupOf = (id) => widgets[id]?.config?.mergeGroup || null;
  const sizeOf = (gid) => (gid
    ? Object.values(widgets).filter((w) => w?.config?.mergeGroup === gid).length
    : 0);

  const aGid = groupOf(aId);
  const bGid = groupOf(bId);
  if (aGid && !bGid) return aId;
  if (bGid && !aGid) return bId;
  if (!aGid && !bGid) return preferId ?? aId;

  const aSize = sizeOf(aGid);
  const bSize = sizeOf(bGid);
  if (aSize !== bSize) return aSize > bSize ? aId : bId;
  return preferId ?? aId;
}

/**
 * Apply `container` to every widget in `gid`, leaving the rest untouched.
 * Keys the source does not define are cleared, so a member never keeps a
 * border the group has dropped.
 */
export function applyContainerToGroup(widgets, gid, container) {
  if (!gid) return widgets;
  const next = { ...widgets };
  for (const [wid, w] of Object.entries(widgets)) {
    if (w?.config?.mergeGroup !== gid) continue;
    const config = { ...(w.config || {}) };
    for (const k of CONTAINER_KEYS) delete config[k];
    next[wid] = { ...w, config: { ...config, ...container } };
  }
  return next;
}
