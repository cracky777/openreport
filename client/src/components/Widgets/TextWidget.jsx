import { useState, useRef, useEffect } from 'react';
import { fontStack, loadGoogleFont } from '../../utils/googleFonts';

const _hs0 = { opacity: 0.4, fontStyle: 'italic' };

// Per-axis alignment values are stored using flex keywords so a single style
// object can drive both the display container (`alignItems`/`justifyContent`)
// and a CSS textAlign mapping for the edit-mode textarea. Centralised here so
// the PropertyPanel selects, the display path and the edit path stay in sync.
// `left`/`right` are legacy values still present in older reports.
const H_TO_TEXT_ALIGN = { 'flex-start': 'left', left: 'left', center: 'center', 'flex-end': 'right', right: 'right' };

// Edit mode keeps the display container (flex alignment, padding, font) and
// drops a content-sized textarea inside it: the textarea inherits the font,
// carries no padding of its own and grows with its text, so the flex
// container places it exactly where the rendered text sits. A textarea
// rather than contentEditable so the value stays a plain controlled string
// that undo/redo can replace safely.
const EDIT_TEXTAREA_STYLE = {
  display: 'block',
  width: '100%',
  maxHeight: '100%',
  padding: 0,
  margin: 0,
  border: 'none',
  outline: 'none',
  resize: 'none',
  background: 'transparent',
  font: 'inherit',
  color: 'inherit',
  lineHeight: 'inherit',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  overflow: 'auto',
  boxSizing: 'border-box',
};

// Grow the textarea to its content so the surrounding flex container can
// align it vertically the same way it aligns the rendered text block.
function fitToContent(el) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

// Text widget — displays a string from data.text; double-click to edit inline.
export default function TextWidget({ data, config, onDataUpdate }) {
  if (config?.fontFamily) loadGoogleFont(config.fontFamily);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(data?.text || '');
  const textareaRef = useRef(null);
  // Keep draft in sync when external text changes outside an edit session
  // (e.g. undo/redo replaces widget.data.text from history).
  useEffect(() => {
    if (!isEditing) setDraft(data?.text || '');
  }, [data?.text, isEditing]);
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      // Place caret at end rather than selecting all — selecting all and
      // then typing wipes the user's previous text on the first keystroke,
      // a common foot-gun when they just wanted to append a word.
      const len = textareaRef.current.value.length;
      textareaRef.current.setSelectionRange(len, len);
    }
  }, [isEditing]);
  useEffect(() => {
    if (isEditing && textareaRef.current) fitToContent(textareaRef.current);
  }, [isEditing, draft]);

  const commit = () => {
    if (onDataUpdate && draft !== (data?.text || '')) {
      onDataUpdate('text', draft);
    }
    setIsEditing(false);
  };
  const cancel = () => {
    setDraft(data?.text || '');
    setIsEditing(false);
  };

  const text = data?.text || '';
  const hAlign = config?.textAlign || 'center';
  const baseStyle = {
    height: '100%',
    width: '100%',
    display: 'flex',
    // Default to centred both ways — the most common intent for a text
    // box on a dashboard (titles / KPIs / annotations). The wrapper's
    // contentPadding is 0 for text widgets in ReportCanvas, so the flex
    // alignment here reaches the actual outer edges.
    alignItems: config?.verticalAlign || 'center',
    // `justifyContent` centres the BLOCK of text inside the flex container,
    // but each line inside that block still aligns per `text-align` (default
    // left) — so a centred multi-line block had each line flush-left within
    // the centred box. Apply the matching CSS textAlign so the lines
    // themselves also align as the user expects.
    justifyContent: hAlign,
    textAlign: H_TO_TEXT_ALIGN[hAlign] || 'center',
    // Configurable inner padding — small default so text doesn't hug
    // the border even when alignment is corner-pinned.
    padding: config?.padding ?? 8,
    fontSize: config?.fontSize || 16,
    color: config?.color || '#334155',
    fontFamily: config?.fontFamily ? fontStack(config.fontFamily) : undefined,
    fontWeight: config?.bold ? 700 : 400,
    fontStyle: config?.italic ? 'italic' : 'normal',
    overflow: 'auto',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    boxSizing: 'border-box',
  };

  if (isEditing) {
    return (
      <div
        // Stop click bubbling so clicking inside the editing surface doesn't
        // re-trigger canvas selection / drag-start handlers.
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        // Outline instead of border: a border would shrink the content box
        // by 1px and shift the text relative to display mode.
        style={{ ...baseStyle, outline: '1px dashed var(--accent-primary)', outlineOffset: -1 }}
      >
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            // Esc cancels. Stop propagation so the canvas's global Esc handler
            // (deselect / close panel) doesn't ALSO fire on the same key.
            if (e.key === 'Escape') { e.stopPropagation(); cancel(); }
            // Ctrl/Cmd+Enter commits; plain Enter inserts a newline so users
            // can compose multi-line content without forcing them through the
            // property panel.
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commit(); }
          }}
          style={{ ...EDIT_TEXTAREA_STYLE, textAlign: baseStyle.textAlign }}
        />
      </div>
    );
  }

  return (
    <div
      onDoubleClick={(e) => {
        // No-op if the parent didn't wire up an updater (e.g. read-only
        // Viewer). Lets the same component render in both Editor and
        // Viewer without a separate read-only fork.
        if (!onDataUpdate) return;
        e.stopPropagation();
        setIsEditing(true);
      }}
      title={onDataUpdate ? 'Double-click to edit' : undefined}
      style={baseStyle}
    >
      {text || (
        <span style={_hs0}>
          {onDataUpdate ? 'Double-click to edit' : ''}
        </span>
      )}
    </div>
  );
}
