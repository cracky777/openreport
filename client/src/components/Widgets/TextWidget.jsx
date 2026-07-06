import { useState, useRef, useEffect } from 'react';
import { fontStack, loadGoogleFont } from '../../utils/googleFonts';

const _hs0 = { opacity: 0.4, fontStyle: 'italic' };

// Per-axis alignment values are stored using flex keywords so a single style
// object can drive both the display container (`alignItems`/`justifyContent`)
// and a CSS textAlign mapping for the edit-mode textarea. Centralised here so
// the PropertyPanel selects, the display path and the edit path stay in sync.
const H_TO_TEXT_ALIGN = { 'flex-start': 'left', 'center': 'center', 'flex-end': 'right' };

// Text widget — displays a string from data.text; double-click to edit
// inline. Editor is an absolute-positioned textarea overlaying the same
// padding/font so the typing surface matches the rendered surface. Vertical
// centring inside the textarea isn't a native CSS thing, so edit mode
// always lays out top-down — once the user blurs, the display mode honours
// the V-align config again. Worth the inconsistency: the alternative
// (rendering a contentEditable on the existing div) is much harder to keep
// in sync with React state across undo/redo.
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
        // Stop click bubbling so clicking inside the editing surface doesn't
        // re-trigger canvas selection / drag-start handlers.
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          ...baseStyle,
          // Textarea doesn't honour flex alignItems/justifyContent on its
          // OWN content; map the H-align to the CSS textAlign equivalent
          // and drop the V-align for the duration of the edit.
          display: 'block',
          textAlign: H_TO_TEXT_ALIGN[config?.textAlign || 'center'] || 'center',
          background: 'transparent',
          border: '1px dashed var(--accent-primary)',
          outline: 'none',
          resize: 'none',
        }}
      />
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
