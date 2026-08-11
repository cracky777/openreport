import { createPortal } from 'react-dom';

// Renders its children at the end of <body>, outside whatever stage asked for
// them.
//
// A stage lives on the journey ribbon, and the ribbon carries a transform to
// slide between stages. A transformed ancestor becomes the containing block of
// every `position: fixed` descendant, so a modal meant to cover the window
// covered the ribbon instead: it centred itself across all three columns and
// slid along with them. Leaving the ribbon is what makes `fixed` mean the
// window again.
//
// React context still flows through — the portal moves the DOM node, not the
// component's place in the tree.
export default function Portal({ children }) {
  return createPortal(children, document.body);
}
