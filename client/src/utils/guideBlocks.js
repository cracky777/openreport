// The marks the user guide (server/utils/ai/help.md) uses, read into blocks the
// /help page renders as React elements: bullets, one level of nested bullets,
// numbered steps and plain lines.

/** A section body → blocks: { kind: 'p', text } | { kind: 'ul', items: [{ text, children }] } | { kind: 'ol', items: [text] } */
export function guideBlocks(body) {
  const blocks = [];
  const last = () => blocks[blocks.length - 1];
  for (const line of String(body || '').split(/\r?\n/)) {
    const bullet = /^(\s*)-\s+(.*)$/.exec(line);
    const step = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (bullet) {
      const nested = bullet[1].length >= 2;
      if (last()?.kind !== 'ul') blocks.push({ kind: 'ul', items: [] });
      const items = last().items;
      if (nested && items.length) items[items.length - 1].children.push(bullet[2]);
      else items.push({ text: bullet[2], children: [] });
    } else if (step) {
      if (last()?.kind !== 'ol') blocks.push({ kind: 'ol', items: [] });
      last().items.push(step[1]);
    } else if (line.trim()) {
      blocks.push({ kind: 'p', text: line.trim() });
    }
  }
  return blocks;
}
