import { useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { clampPos, topZ } from '../utils/pageBounds';
import { copyEntry, writeClipboard, readClipboard, pasteEntry } from '../utils/widgetClipboard';
import { toast } from '../components/Toast/toast';

// Editor keyboard shortcuts: Delete/Backspace (remove selected widget),
// Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z (undo/redo), Ctrl+C / Ctrl+V (copy/paste
// widget, from one report to another too — see utils/widgetClipboard), and the arrow keys (nudge the selected widget). Typing inside an
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
  setLayout,
  setLayoutLive,
  settings,
  setSettings,
  model,
  reportId,
  pageId,
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

      // Ctrl+C = copy selected widget. Not while the author types or has
      // text selected on the page: that copy is theirs.
      const mod = e.ctrlKey || e.metaKey;
      const typing = () => {
        const tag = e.target.tagName;
        return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable;
      };
      if (mod && e.key === 'c' && selectedWidget && !typing() && !String(window.getSelection?.() || '')) {
        const widgetData = widgets[selectedWidget];
        const layoutItem = layout.find((l) => l.i === selectedWidget);
        if (widgetData && layoutItem) {
          writeClipboard(copyEntry({ widget: widgetData, layoutItem, settings, model, reportId, pageId }));
        }
      }

      // Ctrl+V = paste the copied widget, whichever report it was copied in
      if (mod && e.key === 'v' && !typing()) {
        const entry = readClipboard();
        if (!entry) return;
        e.preventDefault();
        const newId = uuidv4();
        const { widget, layoutItem, settingsPatch, missing } = pasteEntry(entry, {
          newId, reportId, pageId, settings, model, pageWidth: pw, pageHeight: ph,
        });
        if (settingsPatch) setSettings?.(settingsPatch);
        setLayoutAndWidgets(
          (prev) => [...prev, { ...layoutItem, z: topZ(prev) }],
          (prev) => ({ ...prev, [newId]: widget }),
        );
        setSelectedWidget(newId);
        // The next paste on this page lands one step further, not on this one.
        if (entry.from?.reportId === reportId && entry.from?.pageId === pageId) writeClipboard({ ...entry, layout: layoutItem });
        if (missing.length) {
          toast(`${missing.length === 1 ? 'One field' : `${missing.length} fields`} of this visual ${missing.length === 1 ? 'is' : 'are'} not in this report's model: ${missing.join(', ')}`);
        }
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
  }, [selectedWidget, history, widgets, layout, setLayoutAndWidgets, setLayout, setLayoutLive, settings, model, reportId, pageId]); // eslint-disable-line react-hooks/exhaustive-deps
}

const ARROWS = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};
