/**
 * Dragging a field without the browser's own drag.
 *
 * The panels use HTML5 drag-and-drop (`draggable` + `dataTransfer`), which no
 * mobile browser fires from a touch: on a phone the field list simply could not
 * be dragged anywhere. This replays the same contract over pointer events.
 *
 * The compact editor sends its MOUSE drags here too (`withMouse`), for a reason
 * that has nothing to do with input: there the fields and the drop zones take
 * turns on screen, so one of them has to come forward mid-drag — and a native
 * drag whose source is hidden under it leaves Chromium wedged, the page dead
 * until it is reloaded. Nothing here can be wedged that way.
 *
 * The payload travels as a plain object instead of a DataTransfer, and the drop
 * zones are found in the DOM (`[data-touch-drop]`) rather than by bubbling —
 * the finger is somewhere on the screen, and `elementFromPoint` is the question
 * that answers. Zones hear about it through DOM events on their own node, so
 * nothing has to be registered anywhere:
 *
 *   or:dragenter / or:dragleave   — highlight, no detail
 *   or:drop                       — detail = { fieldName, fieldType, sourceZone }
 *
 * `or:dragstart` and `or:dragend` fire on `window` so the editor can bring the
 * right panel forward while the finger is still down.
 *
 * A press starts a drag, not a scroll: the field list has to stay scrollable, so
 * a FINGER only starts dragging after LONG_PRESS_MS without moving, and moving
 * before that is a scroll that cancels the arming. A mouse press scrolls
 * nothing, so there the first move past MOVE_TOLERANCE is the drag.
 */

const LONG_PRESS_MS = 260;
// Beyond this the finger is scrolling, not pressing — and the mouse is dragging.
const MOVE_TOLERANCE = 10;

let armed = null; // { timer, x, y, payload, label, pointerId }
let dragging = null; // { ghost, zone, payload, pointerId }
// A drag released over its own row would fire a click on it — opening the field
// editor nobody asked for. Rows consult this before acting on a tap.
let clickDeadUntil = 0;

const zoneAt = (x, y) => {
  const el = document.elementFromPoint(x, y);
  return el ? el.closest('[data-touch-drop]') : null;
};

/**
 * Where inside the zone the finger is pointing.
 *
 * A mouse gets this from `dragover` firing on each chip in turn; a finger never
 * touches those chips, so the position has to be worked out from the zone. Get
 * it wrong and every drop lands at the end of the list — and reordering the
 * last chip to the end is a no-op, so moving a column looked like it did
 * nothing at all.
 *
 * Measured against every chip rather than the one under the finger: the gaps
 * between chips, the zone's own padding and the space above the first chip are
 * all places a finger legitimately stops, and none of them is a chip.
 */
const indexAt = (zone, y) => {
  if (!zone) return null;
  const items = zone.querySelectorAll('[data-touch-drop-item]');
  if (!items.length) return null;
  for (let i = 0; i < items.length; i += 1) {
    const r = items[i].getBoundingClientRect();
    // Above this chip's middle means "before it" — which, for the first chip,
    // is how you get to the top of the list at all.
    if (y < r.top + r.height / 2) return i;
  }
  return items.length;
};

const makeGhost = (label) => {
  const g = document.createElement('div');
  g.textContent = label;
  Object.assign(g.style, {
    position: 'fixed', zIndex: '10000', pointerEvents: 'none',
    padding: '7px 12px', borderRadius: '8px', maxWidth: '60vw',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    font: '600 13px system-ui, sans-serif',
    background: 'var(--accent-primary, #7c3aed)', color: '#fff',
    boxShadow: '0 6px 18px rgba(0,0,0,0.28)', opacity: '0.95',
    transform: 'translate(-50%, -140%)',
  });
  document.body.appendChild(g);
  return g;
};

const moveGhost = (x, y) => {
  if (dragging) { dragging.ghost.style.left = `${x}px`; dragging.ghost.style.top = `${y}px`; }
};

const setZone = (next) => {
  if (!dragging || dragging.zone === next) return;
  if (dragging.zone) dragging.zone.dispatchEvent(new CustomEvent('or:dragleave'));
  dragging.zone = next;
  if (next) next.dispatchEvent(new CustomEvent('or:dragenter'));
};

// Told on every move, not only on entry: the insertion point follows the finger
// within a zone the way it follows the cursor between chips.
const setIndex = (zone, index) => {
  if (!zone || !dragging || dragging.index === index) return;
  dragging.index = index;
  zone.dispatchEvent(new CustomEvent('or:dragover', { detail: { index } }));
};

function disarm() {
  if (armed) { clearTimeout(armed.timer); armed = null; }
}

// Everything a finished or abandoned drag has to put back.
function teardown() {
  try { document.body.releasePointerCapture(dragging.pointerId); } catch { /* already released */ }
  dragging.ghost.remove();
  document.body.style.removeProperty('user-select');
  dragging = null;
  clickDeadUntil = Date.now() + 400;
  window.dispatchEvent(new CustomEvent('or:dragend'));
}

// The gesture was taken away from us — a system edge-swipe, a call coming in.
// Nothing lands.
function abort() {
  if (!dragging) return;
  if (dragging.zone) dragging.zone.dispatchEvent(new CustomEvent('or:dragleave'));
  teardown();
}

function finish(x, y) {
  if (!dragging) return;
  const zone = typeof x === 'number' ? zoneAt(x, y) : dragging.zone;
  if (dragging.zone && dragging.zone !== zone) dragging.zone.dispatchEvent(new CustomEvent('or:dragleave'));
  if (zone) {
    zone.dispatchEvent(new CustomEvent('or:drop', { detail: dragging.payload }));
    if (zone !== dragging.zone) zone.dispatchEvent(new CustomEvent('or:dragleave'));
  }
  teardown();
}

function onMove(e) {
  if (armed) {
    if (Math.hypot(e.clientX - armed.x, e.clientY - armed.y) <= MOVE_TOLERANCE) return;
    // A mouse has nothing to arbitrate with: a press on a list does not scroll
    // it, so the first move IS the drag — waiting out the long press would just
    // make the row feel stuck. A finger moving this early is scrolling.
    if (!armed.mouse) { disarm(); return; }
    // Falls through, so the ghost lands under the cursor instead of back at the
    // point it was picked up from.
    begin();
  }
  if (!dragging) return;
  moveGhost(e.clientX, e.clientY);
  const zone = zoneAt(e.clientX, e.clientY);
  setZone(zone);
  setIndex(zone, indexAt(zone, e.clientY));
}

// The one call that stops the page scrolling under the finger.
//
// `preventDefault` on a pointermove does NOT: scrolling is decided on the touch
// stream, and only a non-passive `touchmove` can veto it. Without this the
// browser reads the drag as a pan, takes the gesture for itself and fires
// `pointercancel` — the drag dies halfway, which is exactly what it looked
// like. `touch-action` cannot do this job either: it is read when the gesture
// starts, and at that point the press is still an ordinary press.
function onTouchMove(e) {
  if (dragging) e.preventDefault();
}

function onUp(e) {
  disarm();
  if (dragging) finish(e.clientX, e.clientY);
  detach();
}

function onCancel() {
  disarm();
  abort();
  detach();
}

function attach() {
  document.addEventListener('touchmove', onTouchMove, { passive: false });
  document.addEventListener('pointermove', onMove, { passive: false });
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onCancel);
}

function detach() {
  document.removeEventListener('touchmove', onTouchMove, { passive: false });
  document.removeEventListener('pointermove', onMove, { passive: false });
  document.removeEventListener('pointerup', onUp);
  document.removeEventListener('pointercancel', onCancel);
}

// Turn the armed press into a drag. Split out of the long-press timer because a
// mouse gets here from the first move instead.
function begin() {
  const { x, y, payload, label, pointerId } = armed;
  armed = null;
  dragging = { ghost: makeGhost(label || payload.fieldName), zone: null, index: undefined, payload, pointerId };
  moveGhost(x, y);
  // Stops the text-selection loupe from fighting the drag.
  document.body.style.userSelect = 'none';

  // A pointer is IMPLICITLY captured by the element it went down on.
  // Listeners on `or:dragstart` bring another panel forward, which hides
  // that element — and the browser answers a vanished capture target with
  // `pointercancel`, killing the drag mid-gesture. Move the capture to the
  // body BEFORE anyone can react, so what happens to the source no longer
  // concerns the pointer.
  try { document.body.setPointerCapture(pointerId); } catch { /* pointer already gone */ }

  window.dispatchEvent(new CustomEvent('or:dragstart', { detail: payload }));
}

/**
 * Arm a drag from a pointerdown.
 *
 * `withMouse` is for the callers that turn the native HTML5 drag off — the
 * compact editor, where the panel holding the fields and the panel holding the
 * zones take turns on screen. Bringing the other one forward mid-drag is a
 * layout change under the drag, and a native drag session does not survive
 * having its source hidden: Chromium wedges, and the page answers nothing until
 * it is reloaded. This layer has no such session to lose. Everywhere else the
 * mouse keeps the native drag, with the browser's own affordances.
 *
 * `payload` is what a drop zone receives: { fieldName, fieldType, sourceZone }.
 */
export function armTouchDrag(e, payload, label, withMouse = false) {
  const mouse = e.pointerType === 'mouse';
  if (mouse && !withMouse) return;
  if (!payload || !payload.fieldName) return;
  disarm();
  const { clientX: x, clientY: y, pointerId } = e;
  armed = {
    x, y, payload, label, pointerId, mouse,
    // A finger has to hold still first, or the list would stop scrolling.
    timer: mouse ? null : setTimeout(begin, LONG_PRESS_MS),
  };
  attach();
}

// True while a finger is dragging, and for a moment after it lets go — a row
// checks this before treating a tap as a tap.
export function isTouchDragging() {
  return !!dragging || Date.now() < clickDeadUntil;
}
