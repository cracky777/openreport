// What is currently being dragged out of the field list.
//
// A DataTransfer only hands its values over on drop: during the drag a page
// can see the format NAMES but not what is in them. That is enough for a zone
// that just lights up, and not enough for a visual that has to say WHERE the
// field would land — which depends on the field itself. So the payload is also
// left here, next to the drag, for anything that needs to think ahead.
//
// The drop itself still reads the DataTransfer (or the touch event's detail):
// this is a preview aid, never the source of truth. Touch drags feed it too
// (utils/touchDrag), so both ways of dragging preview the same.

let current = null;

export function setFieldDrag(payload) {
  current = payload && payload.fieldName ? payload : null;
}

export function clearFieldDrag() {
  current = null;
}

export function currentFieldDrag() {
  return current;
}
