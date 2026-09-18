import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TbBold, TbItalic, TbUnderline, TbClearFormatting } from 'react-icons/tb';
import FontPicker from '../FontPicker/FontPicker';
import { ColorInput } from '../PropertyPanel/controls';
import {
  renderRuns, runsFromDom, runsToText, applyRunStyle, styleInRange, CLEAR_RUN_STYLE,
} from '../../utils/textRuns';

// The editing surface of the Text visual: a contenteditable filled with one
// span per run, plus a floating toolbar that formats the selection. The DOM
// is the draft while typing (re-rendering React children under a caret
// loses it); runs are read back from it whenever formatting is applied and
// when the edit ends. `plaintext-only` keeps whatever the user types or
// pastes as bare text, so formatting can only come from the toolbar.
//
// The edit ends on Ctrl+Enter, or on a press anywhere that is not the
// editor, its toolbar or a popover one of the toolbar's pickers opened
// (marked `data-floating-ui`). Not on blur: picking a colour or a font moves
// focus away without the user being done.
const FLOATING_SELECTOR = '[data-floating-ui]';
const BAR_HEIGHT = 36;
const BAR_WIDTH = 420;

const EDITOR_STYLE = {
  display: 'block',
  width: '100%',
  maxHeight: '100%',
  overflow: 'auto',
  outline: 'none',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  minHeight: '1em',
};
const BAR_STYLE = {
  position: 'fixed',
  zIndex: 1000,
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  height: BAR_HEIGHT,
  padding: '0 6px',
  boxSizing: 'border-box',
  background: 'var(--bg-panel)',
  border: '1px solid var(--border-default)',
  borderRadius: 6,
  boxShadow: '0 6px 16px rgba(0,0,0,0.12)',
};
const BTN_STYLE = {
  width: 26, height: 26, padding: 0, border: '1px solid transparent', borderRadius: 4,
  background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};
const BTN_ACTIVE_STYLE = {
  ...BTN_STYLE, background: 'var(--bg-active)', color: 'var(--accent-primary)', borderColor: 'var(--border-default)',
};
const SIZE_STYLE = {
  width: 48, height: 26, boxSizing: 'border-box', padding: '0 4px', fontSize: 12,
  border: '1px solid var(--border-default)', borderRadius: 4, background: 'var(--bg-panel)', color: 'var(--text-primary)',
};
const FONT_STYLE = { width: 140 };
const SEP_STYLE = { width: 1, height: 20, background: 'var(--border-default)', margin: '0 2px' };
const HINT_STYLE = { fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap', marginLeft: 2 };

// Text offset of a DOM point, counting a <br> as one character like
// runsFromDom does.
function offsetOf(root, container, offset) {
  const r = root.ownerDocument.createRange();
  r.setStart(root, 0);
  r.setEnd(container, offset);
  return r.toString().length + r.cloneContents().querySelectorAll('br').length;
}

function selectionOffsets(root) {
  const sel = root.ownerDocument.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  return {
    start: offsetOf(root, range.startContainer, range.startOffset),
    end: offsetOf(root, range.endContainer, range.endOffset),
  };
}

// DOM point for a text offset, walking the same way offsetOf counts.
function pointAt(root, offset) {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let acc = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) {
      const len = node.nodeValue.length;
      if (offset <= acc + len) return [node, offset - acc];
      acc += len;
    } else if (node.tagName === 'BR') {
      if (offset === acc) return [node.parentNode, Array.prototype.indexOf.call(node.parentNode.childNodes, node)];
      acc += 1;
    }
  }
  return [root, root.childNodes.length];
}

function setSelection(root, start, end) {
  const sel = root.ownerDocument.getSelection();
  const range = root.ownerDocument.createRange();
  range.setStart(...pointAt(root, start));
  range.setEnd(...pointAt(root, end));
  sel.removeAllRanges();
  sel.addRange(range);
}

export default function RichTextEditor({ runs, textAlign, defaults, anchorRef, onCommit, onCancel }) {
  const editorRef = useRef(null);
  const toolbarRef = useRef(null);
  // Last selection seen inside the editor, kept while a picker holds focus.
  const selRef = useRef(null);
  // Caret at the end to start with: select-all would wipe the text on the
  // first key.
  const [active, setActive] = useState(() => {
    const len = runsToText(runs).length;
    return styleInRange(runs, len, len);
  });
  const [barPos, setBarPos] = useState(null);

  useLayoutEffect(() => {
    const el = editorRef.current;
    renderRuns(el, runs);
    el.focus();
    const len = runsToText(runs).length;
    setSelection(el, len, len);
    selRef.current = { start: len, end: len };
    // Initial content only: the DOM is the draft from here on.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Toolbar just above the visual, below it when there is no room above.
  useLayoutEffect(() => {
    const update = () => {
      const r = anchorRef.current?.getBoundingClientRect();
      if (!r) return;
      const above = r.top - BAR_HEIGHT - 6;
      setBarPos({
        top: above < 8 ? r.bottom + 6 : above,
        left: Math.max(8, Math.min(r.left, window.innerWidth - BAR_WIDTH - 8)),
      });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [anchorRef]);

  useEffect(() => {
    const onSelection = () => {
      const el = editorRef.current;
      const range = el && selectionOffsets(el);
      if (!range) return;
      selRef.current = range;
      setActive(styleInRange(runsFromDom(el), range.start, range.end));
    };
    document.addEventListener('selectionchange', onSelection);
    return () => document.removeEventListener('selectionchange', onSelection);
  }, []);

  const onCommitRef = useRef(onCommit);
  useEffect(() => { onCommitRef.current = onCommit; }, [onCommit]);
  const commit = () => onCommitRef.current(runsFromDom(editorRef.current));

  useEffect(() => {
    const onDown = (e) => {
      const t = e.target;
      if (editorRef.current?.contains(t) || toolbarRef.current?.contains(t)) return;
      if (t instanceof Element && t.closest(FLOATING_SELECTOR)) return;
      commit();
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, []);

  // Formats the selection; with nothing selected, the whole text.
  const format = (patchFor) => {
    const el = editorRef.current;
    const current = runsFromDom(el);
    const len = runsToText(current).length;
    let { start, end } = selRef.current || { start: 0, end: len };
    if (start === end) { start = 0; end = len; }
    const next = applyRunStyle(current, start, end, patchFor(styleInRange(current, start, end)));
    renderRuns(el, next);
    // Only put the selection back when the editor has focus: selecting into
    // it would pull focus off the picker the user is still using.
    if (document.activeElement === el) setSelection(el, start, end);
    selRef.current = { start, end };
    setActive(styleInRange(next, start, end));
  };
  const toggle = (key) => format((s) => ({ [key]: s[key] ? null : true }));

  const onKeyDown = (e) => {
    // Nothing typed here is a canvas shortcut (Delete would remove the visual).
    e.stopPropagation();
    if (e.key === 'Escape') { onCancel(); return; }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commit(); return; }
    if (e.key === 'Enter') {
      // A newline character rather than the <div> the browser would wrap
      // the line in, so offsets and runs stay one-to-one with the text.
      e.preventDefault();
      document.execCommand('insertText', false, '\n');
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      const key = { b: 'bold', i: 'italic', u: 'underline' }[e.key.toLowerCase()];
      if (key) { e.preventDefault(); toggle(key); }
    }
  };

  // Toolbar buttons keep the editor's focus and selection (no mousedown
  // default); the pickers take focus, which selRef covers.
  const keepFocus = (e) => e.preventDefault();
  const toolbar = barPos && createPortal(
    <div ref={toolbarRef} style={{ ...BAR_STYLE, top: barPos.top, left: barPos.left }}>
      <button type="button" title="Bold (Ctrl+B)" aria-label="Bold" onMouseDown={keepFocus} onClick={() => toggle('bold')}
        style={active.bold ? BTN_ACTIVE_STYLE : BTN_STYLE}><TbBold size={16} /></button>
      <button type="button" title="Italic (Ctrl+I)" aria-label="Italic" onMouseDown={keepFocus} onClick={() => toggle('italic')}
        style={active.italic ? BTN_ACTIVE_STYLE : BTN_STYLE}><TbItalic size={16} /></button>
      <button type="button" title="Underline (Ctrl+U)" aria-label="Underline" onMouseDown={keepFocus} onClick={() => toggle('underline')}
        style={active.underline ? BTN_ACTIVE_STYLE : BTN_STYLE}><TbUnderline size={16} /></button>
      <div style={SEP_STYLE} />
      <input type="number" min={6} max={200} title="Font size" aria-label="Font size"
        value={active.fontSize ?? ''} placeholder={String(defaults.fontSize)}
        onChange={(e) => { const n = parseInt(e.target.value, 10); format(() => ({ fontSize: Number.isFinite(n) ? n : null })); }}
        style={SIZE_STYLE} />
      <div style={FONT_STYLE}>
        <FontPicker value={active.fontFamily || null} onChange={(family) => format(() => ({ fontFamily: family }))} />
      </div>
      <ColorInput value={active.color || defaults.color} onChange={(c) => format(() => ({ color: c }))} allowTransparent={false} />
      <div style={SEP_STYLE} />
      <button type="button" title="Clear formatting" aria-label="Clear formatting" onMouseDown={keepFocus}
        onClick={() => format(() => CLEAR_RUN_STYLE)} style={BTN_STYLE}><TbClearFormatting size={16} /></button>
      <span style={HINT_STYLE}>Ctrl+Enter to finish</span>
    </div>,
    document.body,
  );

  return (
    <>
      <div
        ref={editorRef}
        contentEditable="plaintext-only"
        suppressContentEditableWarning
        spellCheck={false}
        onKeyDown={onKeyDown}
        style={{ ...EDITOR_STYLE, textAlign }}
      />
      {toolbar}
    </>
  );
}
