import { useEffect } from 'react';
import Portal from '../Portal/Portal';

// The one modal of the journey: a dimmed backdrop and a card centred over it.
//
// Every stage had been declaring that chrome itself, which is how the same idea
// ended up with two different backdrops and how the create-report dialog could
// be centred on the ribbon instead of the window. Going through Portal is not a
// detail here: a stage sits on a transformed ribbon, and a transformed ancestor
// becomes the containing block of its `position: fixed` descendants.
//
// `onClose` is what makes the backdrop and Escape dismiss the dialog. A modal
// that must be answered simply doesn't pass one.
export default function Modal({ children, onClose, width }) {
  useEffect(() => {
    if (!onClose) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <Portal>
      <div style={backdrop} onClick={onClose}>
        {/* The card swallows its own clicks, or every click inside the dialog
            would land on the backdrop and close it. */}
        <div
          role="dialog"
          aria-modal="true"
          style={width ? { ...card, width } : { ...card, minWidth: 360, maxWidth: 480 }}
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </div>
      </div>
    </Portal>
  );
}

const backdrop = {
  position: 'fixed', inset: 0, zIndex: 1000,
  background: 'rgba(15,23,42,0.35)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 24,
};
const card = {
  background: 'var(--bg-panel)', borderRadius: 10, padding: 20,
  // Tall forms — a datasource with every field, the schedule editor — must not
  // run past the window; the card scrolls instead of the page behind it.
  maxWidth: 'calc(100vw - 48px)', maxHeight: '85vh', overflowY: 'auto',
  boxShadow: '0 10px 30px rgba(15,23,42,0.25)',
};
