import { useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';

// Editor keyboard shortcuts: Delete/Backspace (remove selected widget),
// Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z (undo/redo), Ctrl+C / Ctrl+V (copy/paste
// widget). Extracted verbatim from pages/Editor.jsx (LOT 6.3). Typing inside
// an input/textarea/select is always left alone. Pure side-effect hook — owns
// no state; every value it touches is passed in so the closure + dependency
// array stay identical to the inline original.
export function useKeyboardShortcuts({
  selectedWidget,
  setSelectedWidget,
  handleDeleteWidget,
  history,
  widgets,
  layout,
  setLayoutAndWidgets,
  clipboard,
  setClipboard,
}) {
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Delete selected widget
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedWidget) {
        // Don't delete if user is typing in an input
        const tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

        e.preventDefault();
        handleDeleteWidget(selectedWidget);
      }

      // Ctrl+Z = undo
      if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        history.undo();
      }

      // Ctrl+Y or Ctrl+Shift+Z = redo
      if ((e.ctrlKey && e.key === 'y') || (e.ctrlKey && e.shiftKey && e.key === 'z')) {
        e.preventDefault();
        history.redo();
      }

      // Ctrl+C = copy selected widget
      if (e.ctrlKey && e.key === 'c' && selectedWidget) {
        const tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        const widgetData = widgets[selectedWidget];
        const layoutItem = layout.find((l) => l.i === selectedWidget);
        if (widgetData && layoutItem) {
          setClipboard({ widget: JSON.parse(JSON.stringify(widgetData)), layout: { ...layoutItem } });
        }
      }

      // Ctrl+V = paste copied widget
      if (e.ctrlKey && e.key === 'v' && clipboard) {
        const tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault();
        const newId = uuidv4();
        const newLayout = {
          ...clipboard.layout,
          i: newId,
          x: (clipboard.layout.x || 0) + 20,
          y: (clipboard.layout.y || 0) + 20,
        };
        const newWidget = JSON.parse(JSON.stringify(clipboard.widget));
        // Clear fetched data to avoid stale cache
        if (newWidget.data) delete newWidget.data._fetchedBinding;
        setLayoutAndWidgets(
          (prev) => [...prev, newLayout],
          (prev) => ({ ...prev, [newId]: newWidget }),
        );
        setSelectedWidget(newId);
        // Update clipboard position for next paste
        setClipboard({ widget: clipboard.widget, layout: newLayout });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedWidget, history, clipboard, widgets, layout, setLayoutAndWidgets]); // eslint-disable-line react-hooks/exhaustive-deps
}
