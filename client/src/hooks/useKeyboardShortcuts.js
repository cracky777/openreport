import { useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { clampPos } from '../utils/pageBounds';

// Editor keyboard shortcuts: Delete/Backspace (remove selected widget),
// Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z (undo/redo), Ctrl+C / Ctrl+V (copy/paste
// widget), and the arrow keys (nudge the selected widget). Typing inside an
// input/textarea/select is always left alone. Pure side-effect hook — owns no
// state; every value it touches is passed in.
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
  setLayout,
  setLayoutLive,
  settings,
}) {
  // A held arrow repeats ~30 times a second. Recording each one would bury the
  // undo stack, so a burst moves silently and is committed once on key-up —
  // the same "one gesture, one undo step" a drag already follows.
  const nudgingRef = useRef(false);

  useEffect(() => {
    // One grid cell per press, matching what a drag snaps to; 1px when the
    // grid is off, which is the point of turning it off. Shift moves ten
    // cells, the usual coarse step.
    const step = (settings?.snapToGrid ?? true) ? (settings?.gridSize || 20) : 1;
    const pw = settings?.pageWidth || 1140;
    const ph = settings?.pageHeight || 800;

    const handleKeyDown = (e) => {
      // Delete selected widget
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedWidget) {
        // Don't delete if user is typing in an input
        const tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

        e.preventDefault();
        handleDeleteWidget(selectedWidget);
      }

      // Arrow keys = nudge the selected widget. Committed through setLayout so
      // one press is one undo step, like a completed drag.
      if (ARROWS[e.key] && selectedWidget) {
        const tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return;
        // Ctrl/Cmd+arrow belongs to the browser (word jump, history); leaving
        // it alone also keeps Ctrl+Z reachable from the same hand position.
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        e.preventDefault();
        const [dx, dy] = ARROWS[e.key];
        const amount = e.shiftKey ? step * 10 : step;
        nudgingRef.current = true;
        setLayoutLive?.((prev) => prev.map((item) => (item.i === selectedWidget
          ? { ...item, ...clampPos((item.x || 0) + dx * amount, (item.y || 0) + dy * amount, item.w || 0, item.h || 0, pw, ph) }
          : item)));
        return;
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

    const handleKeyUp = (e) => {
      if (!ARROWS[e.key] || !nudgingRef.current) return;
      nudgingRef.current = false;
      // A fresh array so history.set sees a change and records it: the state
      // is already at its final position, only the snapshot is missing.
      setLayout?.((prev) => [...prev]);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [selectedWidget, history, clipboard, widgets, layout, setLayoutAndWidgets, setLayout, setLayoutLive, settings]); // eslint-disable-line react-hooks/exhaustive-deps
}

const ARROWS = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};
