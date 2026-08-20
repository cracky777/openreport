import { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { TbArrowsMaximize, TbArrowsMinimize } from 'react-icons/tb';
import api from '../../utils/api';
import { tokenizeSql } from '../../utils/sqlHighlight';
import { btnAccentSoft } from '../formTokens';

const _hs0 = { position: 'relative' };
const _hs1 = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 3, marginBottom: 4 };
const _hs2 = { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const _hs3 = { fontSize: 9, color: 'var(--text-disabled)', whiteSpace: 'nowrap', marginLeft: 8, flex: '0 0 auto', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '50%' };
const _hs4 = { fontSize: 9, color: 'var(--text-disabled)', padding: '3px 8px', borderTop: '1px solid var(--border-default)' };

const SQL_FUNCTIONS = ['SUM', 'AVG', 'COUNT', 'MIN', 'MAX', 'NULLIF', 'COALESCE', 'CASE WHEN', 'DISTINCT', 'ROUND'];

// Highlight palette — keyed by tokenizeSql token types. Monospace bold keeps
// the same advance width, so styled spans never desync the overlay from the
// textarea's caret.
const TOKEN_COLORS = {
  keyword: { color: 'var(--accent-primary)', fontWeight: 600 },
  function: { color: 'var(--accent-cyan)', fontWeight: 600 },
  string: { color: 'var(--state-success)' },
  // Fixed amber: readable on both themes, and no token maps to it
  // (--state-warning is brown in light mode).
  number: { color: '#d97706' },
  identifier: { color: 'var(--accent-primary)' },
  calc: { color: 'var(--state-warning)', fontWeight: 600 },
  comment: { color: 'var(--text-disabled)', fontStyle: 'italic' },
};

const renderTokens = (text) => tokenizeSql(text).map((t, i) => (
  TOKEN_COLORS[t.type] ? <span key={i} style={TOKEN_COLORS[t.type]}>{t.text}</span> : t.text
));

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
  // Large-editor overlay for long expressions.
  const [expanded, setExpanded] = useState(false);
  // Last "Test" run: { status: 'running'|'ok'|'error', value?, message?,
  // checked } — `checked` is the expression that was tested, so the result
  // can be greyed out (not hidden) once the user edits further.
  const [validation, setValidation] = useState(null);
  const textareaRef = useRef(null);
  const suggestionsRef = useRef(null);
  // Caret index captured when the inline editor hands off to the overlay,
  // so the big textarea reopens with the cursor where the user clicked.
  const caretRef = useRef(null);

  // Clicking (or tabbing) into the inline editor escalates straight to the
  // large overlay — the side panel is too narrow for real SQL work. The
  // timeout lets the browser finish placing the caret before we read it.
  const openExpandedFromInline = (e) => {
    const el = e.target;
    setTimeout(() => {
      // Snapshot the value alongside the caret: a keystroke can race the
      // handoff (focus → overlay mount), and restoring a caret captured
      // before that keystroke would scramble everything typed after it.
      caretRef.current = { caret: el.selectionStart ?? null, value: el.value };
      setExpanded(true);
    }, 0);
  };

  // When the overlay opens, move focus into its textarea and restore the
  // caret captured from the inline editor — but only if nothing was typed
  // in between; otherwise fall back to end-of-text so fast typing through
  // the handoff stays in order.
  useEffect(() => {
    if (!expanded) return;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    const snap = caretRef.current;
    caretRef.current = null;
    if (snap && snap.caret != null && snap.value === el.value) {
      el.setSelectionRange(snap.caret, snap.caret);
    } else {
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [expanded]);

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

  // Escape closes the overlay (only when the autocomplete isn't the one
  // consuming the key).
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e) => {
      if (e.key === 'Escape' && !showSuggestions) setExpanded(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded, showSuggestions]);

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

  // Real validation: run the expression as a throwaway custom measure
  // against the actual datasource (LIMIT 1, no dimensions). The server
  // already accepts unpersisted extras from the model owner/admin — the
  // same path the widget preview uses — so the dialect, the schema and the
  // ${calc} inlining are all the real thing. Report-scoped calc measures
  // ride along as extras so references to them resolve too.
  const runValidation = async () => {
    if (!model?.id || !value.trim()) return;
    const checkName = '_calc.__sql_check';
    setValidation({ status: 'running', checked: value });
    try {
      const reportExtras = (model.measures || [])
        .filter((m) => m._source === 'report' && m.name !== checkName);
      const res = await api.post(`/models/${model.id}/query`, {
        dimensionNames: [],
        measureNames: [checkName],
        extraMeasures: [...reportExtras, { name: checkName, label: 'SQL check', aggregation: 'custom', expression: value }],
        limit: 1,
      });
      const row = (res.data.rows || [])[0];
      const sample = row ? row[Object.keys(row)[0]] : null;
      setValidation({ status: 'ok', value: sample, checked: value });
    } catch (err) {
      setValidation({
        status: 'error',
        message: sanitizeDbError(err.response?.data?.error || err.message),
        checked: value,
      });
    }
  };

  // Driver errors can arrive as half-serialized JSON with control bytes
  // (DuckDB binder errors, notably). Pull out the embedded message when
  // possible, strip what isn't printable, and cap the length.
  const sanitizeDbError = (msg) => {
    let s = String(msg || 'Unknown error');
    const embedded = s.match(/exception_message\\?"\s*:\s*\\?"((?:[^"\\]|\\.)+)/);
    if (embedded) s = embedded[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
    // Keep printable ASCII, newlines and accented Latin; drop control bytes
    // and mojibake (replacement chars, stray CJK from corrupt buffers).
    s = s.replace(/[^\x20-\x7E\nÀ-ſ]/g, '').trim();
    return s.length > 280 ? s.slice(0, 280) + '…' : s;
  };

  const formatSample = (v) => {
    if (v == null) return 'NULL';
    const n = Number(v);
    return Number.isFinite(n) ? n.toLocaleString() : String(v);
  };

  const editorUI = (big) => (
    <div style={_hs0}>
      {/* Functions bar + actions */}
      <div style={_hs1}>
        {SQL_FUNCTIONS.map((fn) => (
          <button key={fn} onClick={() => insertFunction(fn)} style={fnChip}>{fn}</button>
        ))}
        <span style={{ flex: 1 }} />
        <button
          onClick={runValidation}
          disabled={!model?.id || !value.trim() || validation?.status === 'running'}
          title="Run the expression against the datasource (LIMIT 1) to check it"
          style={{ ...testBtn, opacity: (!model?.id || !value.trim()) ? 0.5 : 1 }}
        >
          {validation?.status === 'running' ? 'Testing…' : '▶ Test'}
        </button>
        <button
          onClick={() => setExpanded(!big)}
          title={big ? 'Close large editor (Esc)' : 'Open large editor'}
          style={iconBtn}
        >
          {big ? <TbArrowsMinimize size={12} /> : <TbArrowsMaximize size={12} />}
        </button>
      </div>

      {/* Editor — a highlighted <pre> and a transparent-text textarea stacked
          in the same grid cell. The pre's natural height auto-grows the box
          with the content (the container scrolls past maxHeight), and the
          identical font metrics keep the caret aligned with the colors. */}
      <div style={{ ...editorBox, ...(big ? editorBoxBig : editorBoxInline), ...style }}>
        <pre aria-hidden style={highlightLayer}>{renderTokens(value)}{'\n'}</pre>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          onFocus={big ? undefined : openExpandedFromInline}
          placeholder="SQL expression — type a field or measure name (e.g. ${TotalSales}) to see suggestions"
          spellCheck={false}
          style={{ ...textareaLayer, color: value ? 'transparent' : 'var(--text-disabled)' }}
        />
      </div>

      {/* Test result — greyed (not hidden) once the expression is edited
          past the tested text. */}
      {validation && validation.status !== 'running' && (
        <div style={{
          ...resultLine,
          color: validation.status === 'ok' ? 'var(--state-success)' : 'var(--state-danger)',
          opacity: validation.checked === value ? 1 : 0.55,
        }}>
          {validation.status === 'ok'
            ? `✓ Valid — sample result: ${formatSample(validation.value)}`
            : `✗ ${validation.message}`}
          {validation.checked !== value ? ' (edited since)' : ''}
        </div>
      )}
    </div>
  );

  return (
    <>
      {expanded ? createPortal(
        <div
          style={overlayBackdrop}
          onMouseDown={(e) => { if (e.target === e.currentTarget) setExpanded(false); }}
        >
          <div style={overlayBox}>
            <div style={overlayTitle}>SQL expression</div>
            {editorUI(true)}
          </div>
        </div>,
        document.body,
      ) : editorUI(false)}

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
                backgroundColor: s.type === 'dim' ? 'var(--accent-primary-soft)' : (s.type === 'calc' ? 'var(--state-warning-soft)' : 'var(--state-success-soft)'),
                color: s.type === 'dim' ? 'var(--accent-primary)' : (s.type === 'calc' ? 'var(--state-warning)' : 'var(--state-success)'),
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
    </>
  );
}

// Shared text metrics — MUST stay strictly identical between the highlight
// <pre> and the textarea, or the caret drifts off the colored glyphs.
const codeFont = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: 12, lineHeight: 1.5, tabSize: 2,
  padding: '6px 8px', margin: 0,
  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
  boxSizing: 'border-box', minWidth: 0,
};

const editorBox = {
  display: 'grid', overflow: 'auto', position: 'relative',
  border: '1px solid var(--accent-primary-border)', borderRadius: 4,
  background: 'var(--bg-panel)', width: '100%', boxSizing: 'border-box',
};
const editorBoxInline = { minHeight: 72, maxHeight: 240 };
const editorBoxBig = { minHeight: '35vh', maxHeight: '58vh' };

const highlightLayer = {
  ...codeFont, gridArea: '1 / 1', pointerEvents: 'none',
  color: 'var(--text-primary)',
};
const textareaLayer = {
  ...codeFont, gridArea: '1 / 1', width: '100%',
  resize: 'none', overflow: 'hidden', border: 'none', outline: 'none',
  background: 'transparent', caretColor: 'var(--text-primary)',
};

const resultLine = { fontSize: 10, marginTop: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-word' };

const fnChip = {
  fontSize: 9, padding: '1px 5px', border: '1px solid var(--border-default)', borderRadius: 3,
  background: 'var(--bg-panel)', color: 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'monospace',
};

const testBtn = btnAccentSoft;

const iconBtn = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  padding: '1px 4px', border: '1px solid var(--border-default)', borderRadius: 3,
  background: 'var(--bg-panel)', color: 'var(--text-secondary)', cursor: 'pointer',
};

const overlayBackdrop = {
  position: 'fixed', inset: 0, zIndex: 1500,
  background: 'rgba(15, 23, 42, 0.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};
const overlayBox = {
  width: 'min(860px, 92vw)', maxHeight: '82vh', overflow: 'auto',
  background: 'var(--bg-panel)', borderRadius: 8, padding: 14,
  boxShadow: '0 12px 40px rgba(0,0,0,0.3)',
};
const overlayTitle = {
  fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8,
};

const dropdownStyle = {
  position: 'fixed', zIndex: 2000,
  backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border-default)', borderRadius: 6,
  boxShadow: '0 4px 12px rgba(0,0,0,0.25)', overflow: 'hidden',
};

const suggestionItem = {
  display: 'flex', alignItems: 'center', padding: '5px 8px',
  fontSize: 11, cursor: 'pointer', borderBottom: '1px solid var(--border-subtle)',
};
