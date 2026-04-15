import { useState, useRef, useEffect } from 'react';

const SQL_FUNCTIONS = ['SUM', 'AVG', 'COUNT', 'MIN', 'MAX', 'NULLIF', 'COALESCE', 'CASE WHEN', 'DISTINCT', 'ROUND'];

export default function SqlExpressionInput({ value, onChange, model, style }) {
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [cursorWord, setCursorWord] = useState('');
  const [cursorPos, setCursorPos] = useState(0);
  const textareaRef = useRef(null);
  const suggestionsRef = useRef(null);

  // Build all available fields
  const allFields = [];
  if (model) {
    for (const d of (model.dimensions || [])) {
      const table = d.table.includes('.') ? `"${d.table.split('.').join('"."')}"` : `"${d.table}"`;
      allFields.push({
        label: d.label || d.column,
        insert: `${table}."${d.column}"`,
        source: `${d.table}.${d.column}`,
        type: 'dim',
      });
    }
    for (const m of (model.measures || [])) {
      if (m.aggregation !== 'custom' && m.column && m.column !== '*') {
        const table = m.table.includes('.') ? `"${m.table.split('.').join('"."')}"` : `"${m.table}"`;
        allFields.push({
          label: m.label || m.column,
          insert: `${table}."${m.column}"`,
          source: `${m.table}.${m.column}`,
          type: 'meas',
        });
      }
    }
  }

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
    const before = value.substring(0, pos - wordLen);
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
    <div style={{ position: 'relative' }}>
      {/* Functions bar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 4 }}>
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
        placeholder="SQL expression — type a field name to see suggestions"
        rows={3}
        style={{ ...inputStyle, ...style, fontFamily: 'monospace', fontSize: 11, resize: 'vertical' }}
      />

      {/* Autocomplete dropdown */}
      {showSuggestions && (
        <div ref={suggestionsRef} style={dropdownStyle}>
          {suggestions.map((s, i) => (
            <div
              key={i}
              onClick={() => insertSuggestion(s)}
              onMouseEnter={() => setSelectedIdx(i)}
              style={{
                ...suggestionItem,
                backgroundColor: i === selectedIdx ? '#eff6ff' : 'transparent',
              }}
            >
              <span style={{
                fontSize: 9, fontWeight: 700, marginRight: 6, padding: '0 3px',
                borderRadius: 2,
                backgroundColor: s.type === 'dim' ? '#dbeafe' : '#dcfce7',
                color: s.type === 'dim' ? '#3b82f6' : '#16a34a',
              }}>
                {s.type === 'dim' ? 'DIM' : 'MES'}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>{s.label}</span>
              <span style={{ fontSize: 9, color: '#94a3b8', whiteSpace: 'nowrap', marginLeft: 4 }}>
                {s.source.includes('.') ? s.source.split('.').slice(-2).join('.') : s.source}
              </span>
            </div>
          ))}
          <div style={{ fontSize: 9, color: '#94a3b8', padding: '3px 8px', borderTop: '1px solid #f1f5f9' }}>
            ↑↓ navigate &nbsp; Tab/Enter select &nbsp; Esc close
          </div>
        </div>
      )}
    </div>
  );
}

const inputStyle = {
  width: '100%', padding: '4px 6px', border: '1px solid #ddd6fe', borderRadius: 3,
  fontSize: 11, outline: 'none', boxSizing: 'border-box',
};

const fnChip = {
  fontSize: 9, padding: '1px 5px', border: '1px solid #e2e8f0', borderRadius: 3,
  background: '#fff', color: '#475569', cursor: 'pointer', fontFamily: 'monospace',
};

const dropdownStyle = {
  position: 'absolute', left: 0, right: 0, zIndex: 100,
  backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: 6,
  boxShadow: '0 4px 12px rgba(0,0,0,0.12)', overflow: 'hidden',
};

const suggestionItem = {
  display: 'flex', alignItems: 'center', padding: '5px 8px',
  fontSize: 11, cursor: 'pointer', borderBottom: '1px solid #f8fafc',
};
