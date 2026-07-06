import { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';

const _hs0 = { position: 'relative' };
const _hs1 = { display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 4 };
const _hs2 = { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const _hs3 = { fontSize: 9, color: 'var(--text-disabled)', whiteSpace: 'nowrap', marginLeft: 8, flex: '0 0 auto', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '50%' };
const _hs4 = { fontSize: 9, color: 'var(--text-disabled)', padding: '3px 8px', borderTop: '1px solid var(--border-default)' };

const SQL_FUNCTIONS = ['SUM', 'AVG', 'COUNT', 'MIN', 'MAX', 'NULLIF', 'COALESCE', 'CASE WHEN', 'DISTINCT', 'ROUND'];

export default function SqlExpressionInput({ value, onChange, model, style }) {
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [cursorWord, setCursorWord] = useState('');
  const [cursorPos, setCursorPos] = useState(0);
  // Anchor rect of the textarea — the dropdown is portalled to document.body
  // so it escapes any `overflow: auto` ancestor (e.g. the measure-edit
  // panel's scroll container). The rect is recomputed each time suggestions
  // open AND while they're visible (on scroll / resize) so the popover
  // tracks the textarea correctly.
  const [anchorRect, setAnchorRect] = useState(null);
  const textareaRef = useRef(null);
  const suggestionsRef = useRef(null);

  // Recompute the anchor rect when the dropdown is open. Listen on scroll
  // (capture phase, so any scrolling ancestor triggers it) and resize.
  useEffect(() => {
    if (!showSuggestions) return;
    const update = () => {
      if (textareaRef.current) {
        setAnchorRect(textareaRef.current.getBoundingClientRect());
      }
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [showSuggestions]);

  // Build all available fields. Three "kinds":
  //   - dim/meas: insert the raw "table"."column"
  //   - calc: insert `${name}` so the server's inliner expands it to the
  //     referenced measure's expression at query time
  const allFields = useMemo(() => {
    const fields = [];
    if (model) {
      for (const d of (model.dimensions || [])) {
        const table = d.table.includes('.') ? `"${d.table.split('.').join('"."')}"` : `"${d.table}"`;
        fields.push({
          label: d.label || d.column,
          insert: `${table}."${d.column}"`,
          source: `${d.table}.${d.column}`,
          type: 'dim',
        });
      }
      for (const m of (model.measures || [])) {
        if (m.aggregation === 'custom') {
          fields.push({
            label: m.label || m.name,
            insert: `\${${m.name}}`,
            source: m.name,
            type: 'calc',
          });
        } else if (m.column && m.column !== '*') {
          const table = m.table.includes('.') ? `"${m.table.split('.').join('"."')}"` : `"${m.table}"`;
          fields.push({
            label: m.label || m.column,
            insert: `${table}."${m.column}"`,
            source: `${m.table}.${m.column}`,
            type: 'meas',
          });
        }
      }
    }
    return fields;
  }, [model]);

  // Extract the word being typed at cursor position
  const getWordAtCursor = (text, pos) => {
    const before = text.substring(0, pos);
    const match = before.match(/[a-zA-Z0-9_àâäéèêëïîôùûüç]+$/i);
    return match ? match[0] : '';
  };

  const handleInput = (e) => {
    const newVal = e.target.value;
    const pos = e.target.selectionStart;
    onChange(newVal);
    setCursorPos(pos);

    const word = getWordAtCursor(newVal, pos);
    setCursorWord(word);

    if (word.length >= 2) {
      const lower = word.toLowerCase();
      const matches = allFields.filter((f) =>
        f.label.toLowerCase().includes(lower) || f.source.toLowerCase().includes(lower)
      );
      setSuggestions(matches.slice(0, 8));
      setShowSuggestions(matches.length > 0);
      setSelectedIdx(0);
    } else {
      setShowSuggestions(false);
    }
  };

  const insertSuggestion = (field) => {
    const el = textareaRef.current;
    const pos = cursorPos;
    const wordLen = cursorWord.length;
    let before = value.substring(0, pos - wordLen);
    // If the user already typed `${` (or `$`) right before the partial word,
    // strip those characters from the prefix so the calc-measure insert
    // (which already contains `${...}`) doesn't end up duplicated.
    if (field.type === 'calc') {
      if (before.endsWith('${')) before = before.slice(0, -2);
      else if (before.endsWith('$')) before = before.slice(0, -1);
    }
    const after = value.substring(pos);
    const newVal = before + field.insert + after;
    onChange(newVal);
    setShowSuggestions(false);

    setTimeout(() => {
      if (el) {
        el.focus();
        const newPos = before.length + field.insert.length;
        el.selectionStart = el.selectionEnd = newPos;
      }
    }, 0);
  };

  const insertFunction = (fn) => {
    const el = textareaRef.current;
    if (!el) { onChange(value + `${fn}(`); return; }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const text = `${fn}(`;
    const newVal = value.substring(0, start) + text + value.substring(end);
    onChange(newVal);
    setTimeout(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + text.length;
    }, 0);
  };

  const handleKeyDown = (e) => {
    if (!showSuggestions) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx((prev) => Math.min(prev + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      if (suggestions[selectedIdx]) {
        e.preventDefault();
        insertSuggestion(suggestions[selectedIdx]);
      }
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  };

  // Close suggestions on click outside
  useEffect(() => {
    const handleClick = (e) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target) &&
          textareaRef.current && !textareaRef.current.contains(e.target)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div style={_hs0}>
      {/* Functions bar */}
      <div style={_hs1}>
        {SQL_FUNCTIONS.map((fn) => (
          <button key={fn} onClick={() => insertFunction(fn)} style={fnChip}>{fn}</button>
        ))}
      </div>

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        placeholder="SQL expression — type a field or measure name (e.g. ${TotalSales}) to see suggestions"
        rows={3}
        style={{ ...inputStyle, ...style, fontFamily: 'monospace', fontSize: 11, resize: 'vertical' }}
      />

      {/* Autocomplete dropdown — portalled to <body> so it escapes any
          `overflow: auto` ancestor (e.g. the measure-edit panel). Position
          is recomputed from the textarea's bounding rect. */}
      {showSuggestions && anchorRect && createPortal(
        <div ref={suggestionsRef} style={{
          ...dropdownStyle,
          top: anchorRect.bottom + 2,
          left: anchorRect.left,
          width: anchorRect.width,
        }}>
          {suggestions.map((s, i) => (
            <div
              key={i}
              onClick={() => insertSuggestion(s)}
              onMouseEnter={() => setSelectedIdx(i)}
              title={s.source}
              style={{
                ...suggestionItem,
                backgroundColor: i === selectedIdx ? 'var(--bg-active)' : 'transparent',
                color: 'var(--text-primary)',
              }}
            >
              <span style={{
                fontSize: 9, fontWeight: 700, marginRight: 6, padding: '0 3px',
                borderRadius: 2, flex: '0 0 auto',
                backgroundColor: s.type === 'dim' ? '#ede9fe' : (s.type === 'calc' ? '#fef3c7' : '#dcfce7'),
                color: s.type === 'dim' ? '#7c3aed' : (s.type === 'calc' ? '#b45309' : '#16a34a'),
              }}>
                {s.type === 'dim' ? 'DIM' : (s.type === 'calc' ? 'ƒ' : 'MES')}
              </span>
              <span style={_hs2}>{s.label}</span>
              {s.type !== 'calc' && (
                <span style={_hs3}>
                  {s.source.includes('.') ? s.source.split('.').slice(-2).join('.') : s.source}
                </span>
              )}
            </div>
          ))}
          <div style={_hs4}>
            ↑↓ navigate &nbsp; Tab/Enter select &nbsp; Esc close
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

const inputStyle = {
  width: '100%', padding: '4px 6px', border: '1px solid #ddd6fe', borderRadius: 3,
  fontSize: 11, outline: 'none', boxSizing: 'border-box',
};

const fnChip = {
  fontSize: 9, padding: '1px 5px', border: '1px solid var(--border-default)', borderRadius: 3,
  background: 'var(--bg-panel)', color: 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'monospace',
};

const dropdownStyle = {
  position: 'fixed', zIndex: 1000,
  backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border-default)', borderRadius: 6,
  boxShadow: '0 4px 12px rgba(0,0,0,0.25)', overflow: 'hidden',
};

const suggestionItem = {
  display: 'flex', alignItems: 'center', padding: '5px 8px',
  fontSize: 11, cursor: 'pointer', borderBottom: '1px solid #f8fafc',
};
