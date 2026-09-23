import { useState, useEffect, useMemo } from 'react';
import { fontStack, loadGoogleFont } from '../../utils/googleFonts';
import { runsFromData, runsToText, normalizeRuns, runStyle } from '../../utils/textRuns';
import RichTextEditor from './RichTextEditor';

const _hs0 = { opacity: 0.4, fontStyle: 'italic' };

// Per-axis alignment values are stored using flex keywords so a single style
// object can drive both the display container (`alignItems`/`justifyContent`)
// and the CSS textAlign of the lines inside it. Centralised here so the
// PropertyPanel selects, the display path and the edit path stay in sync.
// `left`/`right` are legacy values still present in older reports.
const H_TO_TEXT_ALIGN = { 'flex-start': 'left', left: 'left', center: 'center', 'flex-end': 'right', right: 'right' };

// The text block fills the container's width so `textAlign` places each
// line; the container's flex alignment places the block vertically.
const BLOCK_STYLE = { width: '100%', whiteSpace: 'pre-wrap', wordBreak: 'break-word' };

// Text widget — shows `data.text`, formatted by `data.runs` when present;
// double-click to edit inline. Edit mode keeps the display container (flex
// alignment, padding, font) and swaps the text block for the editor, so
// the typing surface sits exactly where the rendered text does.
export default function TextWidget({ data, config, onDataUpdate }) {
  if (config?.fontFamily) loadGoogleFont(config.fontFamily);
  const runs = useMemo(() => runsFromData(data), [data]);
  useEffect(() => {
    for (const r of runs) if (r.fontFamily) loadGoogleFont(r.fontFamily);
  }, [runs]);
  const [isEditing, setIsEditing] = useState(false);
  // The editing wrapper, as state: the toolbar is placed from it, and a ref
  // object is still empty when the editor's own layout effect runs (a child's
  // effects run before its parent's ref is attached). Only the double run of
  // development's StrictMode hid that — built, the toolbar never showed.
  const [anchor, setAnchor] = useState(null);

  const commit = (edited) => {
    const next = normalizeRuns(edited);
    if (onDataUpdate && JSON.stringify(next) !== JSON.stringify(runs)) {
      onDataUpdate({ text: runsToText(next), runs: next });
    }
    setIsEditing(false);
  };

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
        ref={setAnchor}
        // Stop click bubbling so clicking inside the editing surface doesn't
        // re-trigger canvas selection / drag-start handlers.
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        // Outline instead of border: a border would shrink the content box
        // by 1px and shift the text relative to display mode.
        style={{ ...baseStyle, outline: '1px dashed var(--accent-primary)', outlineOffset: -1 }}
      >
        <RichTextEditor
          runs={runs}
          textAlign={baseStyle.textAlign}
          defaults={{ fontSize: baseStyle.fontSize, color: baseStyle.color }}
          anchor={anchor}
          onCommit={commit}
          onCancel={() => setIsEditing(false)}
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
      {runs.length > 0 ? (
        <div style={BLOCK_STYLE}>
          {runs.map((run, i) => <span key={i} style={runStyle(run)}>{run.text}</span>)}
        </div>
      ) : (
        <span style={_hs0}>
          {onDataUpdate ? 'Double-click to edit' : ''}
        </span>
      )}
    </div>
  );
}
