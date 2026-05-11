/**
 * Helpers for number inputs that should accept "no value" — i.e. the user
 * can clear the field and the renderer falls back to its own default rather
 * than to a hardcoded 0 that the original `parseInt(value) || 0` pattern
 * silently writes into config.
 *
 * Usage pattern:
 *
 *     <input type="number"
 *       value={widget.config?.fontSize ?? ''}
 *       placeholder="auto"
 *       onChange={(e) => updateConfig('fontSize', parseIntOrNull(e.target.value))}
 *     />
 *
 * And on the read side:
 *
 *     const fontSize = widget.config?.fontSize ?? 12;
 *
 * If the user clears the input, `parseIntOrNull` returns `null` → the
 * merged config has `fontSize: null` → the read-side `??` falls back to 12.
 * If the user types `14`, the parsed integer is written and used.
 */

export function parseIntOrNull(value) {
  if (value === '' || value == null) return null;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

export function parseFloatOrNull(value) {
  if (value === '' || value == null) return null;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}
