import { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { TbArrowsMaximize, TbArrowsMinimize } from 'react-icons/tb';
import api from '../../utils/api';
import { tokenizeSql } from '../../utils/sqlHighlight';
import { btnAccentSoft, btnPrimary } from '../formTokens';
import { readableTables } from '../../utils/readableTables';

const _hs0 = { position: 'relative' };
const _hs1 = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 3, marginBottom: 4 };
const _hs2 = { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const _hs3 = { fontSize: 9, color: 'var(--text-disabled)', whiteSpace: 'nowrap', marginLeft: 8, flex: '0 0 auto', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '50%' };
const _hs4 = { fontSize: 9, color: 'var(--text-disabled)', padding: '3px 8px', borderTop: '1px solid var(--border-default)' };

// Function chips per expression kind. A measure aggregates; a calculated
// dimension is a row-level value, so it gets the text-shaping and
// conditional functions instead. `caret` places the cursor inside a
// snippet that has a hole to fill; absent, the cursor lands at its end.
const fn = (name) => ({ label: name, insert: `${name}(` });
const CASE_WHEN = { label: 'CASE WHEN', insert: 'CASE WHEN  THEN  ELSE  END', caret: 10 };
const FUNCTION_CHIPS = {
  measure: [fn('SUM'), fn('AVG'), fn('COUNT'), fn('MIN'), fn('MAX'), fn('NULLIF'), fn('COALESCE'), CASE_WHEN, { label: 'DISTINCT', insert: 'DISTINCT ' }, fn('ROUND')],
  dimension: [
    fn('CONCAT'), { label: '||', insert: ' || ' }, fn('UPPER'), fn('LOWER'), fn('TRIM'), fn('SUBSTRING'), fn('REPLACE'),
    fn('COALESCE'), CASE_WHEN, { label: 'CAST', insert: 'CAST( AS )', caret: 5 }, fn('ROUND'), fn('EXTRACT'),
  ],
};

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

// `onSubmit` (optional) is the enclosing form's save action: the large editor
// then offers a Save button so a measure can be tested, saved and closed
// without leaving the overlay. Validation of the form stays with the caller.
// `kind` says what the expression will become — a measure (aggregated) or a
// calculated dimension (row-level) — which only changes how Test runs it;
// `dimensionTable` is the table a calculated dimension is attached to, so the
// probe resolves bare column names the way the saved dimension will.
export default function SqlExpressionInput({ value, onChange, onSubmit, model, style, kind = 'measure', dimensionTable = '' }) {
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
  // Filter of the overlay's field list.
  const [fieldSearch, setFieldSearch] = useState('');
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

  const submit = () => {
    setExpanded(false);
    onSubmit?.();
  };

  // Escape closes the overlay and Ctrl/Cmd+Enter saves (only when the
  // autocomplete isn't the one consuming the key).
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e) => {
      if (showSuggestions) return;
      if (e.key === 'Escape') setExpanded(false);
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && onSubmit) {
        e.preventDefault();
        setExpanded(false);
        onSubmit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded, showSuggestions, onSubmit]);

  // Build all available fields. Three "kinds":
  //   - dim/meas: insert the raw "table"."column"
  //   - calc: insert `${name}` so the server's inliner expands it to the
  //     referenced measure's expression at query time
  //
  // A calculated dimension may only read its home table and the tables that
  // table reaches on the one side of a join (the server refuses the rest, see
  // readableTables), and never an aggregate — so in dimension mode the list
  // is cut down to exactly what the expression can use.
  const allFields = useMemo(() => {
    const fields = [];
    const forDimension = kind === 'dimension';
    const readable = forDimension && dimensionTable ? readableTables(dimensionTable, model?.joins) : null;
    const usable = (table) => !readable || readable.has(table);
    if (model) {
      for (const d of (model.dimensions || [])) {
        if (d.expression) {
          if (d.table && !usable(d.table)) continue;
          // A calculated dimension has no column: its SQL is inlined where it
          // is used, parenthesised so it composes with the surrounding text.
          fields.push({ label: d.label || d.name, insert: `(${d.expression})`, source: d.name, type: 'calc' });
          continue;
        }
        if (!d.table || !d.column || !usable(d.table)) continue;
        const table = d.table.includes('.') ? `"${d.table.split('.').join('"."')}"` : `"${d.table}"`;
        fields.push({
          label: d.label || d.column,
          insert: `${table}."${d.column}"`,
          source: `${d.table}.${d.column}`,
          type: 'dim',
        });
      }
      for (const m of forDimension ? [] : (model.measures || [])) {
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
  }, [model, kind, dimensionTable]);

  // Insert a field where the caret is (the overlay's field list; the
  // autocomplete has its own word-replacing variant below).
  const insertField = (field) => {
    const el = textareaRef.current;
    const start = el ? el.selectionStart : value.length;
    const end = el ? el.selectionEnd : value.length;
    const newVal = value.substring(0, start) + field.insert + value.substring(end);
    onChange(newVal);
    setTimeout(() => {
      if (!el) return;
      el.focus();
      el.selectionStart = el.selectionEnd = start + field.insert.length;
    }, 0);
  };

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

  const insertFunction = (chip) => {
    const el = textareaRef.current;
    const text = chip.insert;
    if (!el) { onChange(value + text); return; }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const newVal = value.substring(0, start) + text + value.substring(end);
    onChange(newVal);
    setTimeout(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + (chip.caret ?? text.length);
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
    const checkName = kind === 'dimension' ? '_calcdim.__sql_check' : '_calc.__sql_check';
    setValidation({ status: 'running', checked: value });
    try {
      const reportMeasures = (model.measures || [])
        .filter((m) => m._source === 'report' && m.name !== checkName);
      const reportDims = (model.dimensions || [])
        .filter((d) => d._source === 'report' && d.name !== checkName);
      // A dimension expression is a row-level value: it is probed on the
      // first row the database hands out (`sample` — no DISTINCT, no ORDER
      // BY, so a big table is not sorted for one value), and an aggregate
      // inside it fails here the same way it would on a widget.
      const res = await api.post(`/models/${model.id}/query`, kind === 'dimension'
        ? {
          dimensionNames: [checkName],
          measureNames: [],
          extraDimensions: [...reportDims, { name: checkName, label: 'SQL check', type: 'string', table: dimensionTable || '', column: '', expression: value }],
          extraMeasures: reportMeasures,
          sample: true,
          limit: 1,
        }
        : {
          dimensionNames: [],
          measureNames: [checkName],
          extraDimensions: reportDims,
          extraMeasures: [...reportMeasures, { name: checkName, label: 'SQL check', aggregation: 'custom', expression: value }],
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
        {(FUNCTION_CHIPS[kind] || FUNCTION_CHIPS.measure).map((chip) => (
          <button key={chip.label} onClick={() => insertFunction(chip)} style={fnChip}>{chip.label}</button>
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
        {big && onSubmit && (
          <button
            onClick={submit}
            title="Save the measure and close the editor (Ctrl+Enter)"
            style={saveBtn}
          >
            ✓ Save
          </button>
        )}
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
            <div style={overlayEditor}>
              <div style={overlayTitle}>SQL expression</div>
              {editorUI(true)}
            </div>
            {/* Fields the expression may use, one click away — the way a
                custom column dialog lists its available columns. */}
            <div style={fieldsPanel}>
              <div style={overlayTitle}>
                {kind === 'dimension' ? (dimensionTable ? `Available fields (from ${dimensionTable})` : 'Available fields') : 'Available fields'}
              </div>
              <input
                type="text"
                value={fieldSearch}
                onChange={(e) => setFieldSearch(e.target.value)}
                placeholder="Search…"
                style={fieldsSearch}
              />
              <div style={fieldsList}>
                {allFields
                  .filter((f) => !fieldSearch || f.label.toLowerCase().includes(fieldSearch.toLowerCase()) || f.source.toLowerCase().includes(fieldSearch.toLowerCase()))
                  .map((f) => (
                    <div
                      key={`${f.type}:${f.source}`}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => insertField(f)}
                      title={`Insert ${f.insert}`}
                      style={fieldsItem}
                    >
                      <span style={fieldBadge(f.type)}>{f.type === 'dim' ? 'DIM' : (f.type === 'calc' ? 'ƒ' : 'MES')}</span>
                      <span style={_hs2}>{f.label}</span>
                      {f.type !== 'calc' && (
                        <span style={_hs3}>{f.source.includes('.') ? f.source.split('.').slice(-2).join('.') : f.source}</span>
                      )}
                    </div>
                  ))}
                {allFields.length === 0 && (
                  <div style={fieldsEmpty}>
                    {kind === 'dimension' && !dimensionTable ? 'Pick the table the dimension belongs to.' : 'No field available.'}
                  </div>
                )}
              </div>
            </div>
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
              <span style={fieldBadge(s.type)}>
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
const saveBtn = btnPrimary;

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
  width: 'min(1080px, 94vw)', maxHeight: '82vh',
  background: 'var(--bg-panel)', borderRadius: 8, padding: 14,
  boxShadow: '0 12px 40px rgba(0,0,0,0.3)',
  display: 'flex', gap: 14,
};
const overlayEditor = { flex: 1, minWidth: 0, overflow: 'auto' };
const overlayTitle = {
  fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8,
};
const fieldsPanel = {
  flex: '0 0 240px', minWidth: 0, display: 'flex', flexDirection: 'column',
  borderLeft: '1px solid var(--border-default)', paddingLeft: 14,
};
const fieldsSearch = {
  fontSize: 11, padding: '4px 6px', marginBottom: 6,
  border: '1px solid var(--border-default)', borderRadius: 4,
  background: 'var(--bg-input)', color: 'var(--text-primary)',
};
const fieldsList = { flex: 1, minHeight: 0, overflowY: 'auto' };
const fieldsItem = {
  display: 'flex', alignItems: 'center', padding: '4px 6px', borderRadius: 4,
  fontSize: 11, cursor: 'pointer', color: 'var(--text-primary)',
};
const fieldsEmpty = { fontSize: 11, color: 'var(--text-muted)', padding: '4px 6px' };
const fieldBadge = (type) => ({
  fontSize: 9, fontWeight: 700, marginRight: 6, padding: '0 3px',
  borderRadius: 2, flex: '0 0 auto',
  backgroundColor: type === 'dim' ? 'var(--accent-primary-soft)' : (type === 'calc' ? 'var(--state-warning-soft)' : 'var(--state-success-soft)'),
  color: type === 'dim' ? 'var(--accent-primary)' : (type === 'calc' ? 'var(--state-warning)' : 'var(--state-success)'),
});

const dropdownStyle = {
  position: 'fixed', zIndex: 2000,
  backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border-default)', borderRadius: 6,
  boxShadow: '0 4px 12px rgba(0,0,0,0.25)', overflow: 'hidden',
};

const suggestionItem = {
  display: 'flex', alignItems: 'center', padding: '5px 8px',
  fontSize: 11, cursor: 'pointer', borderBottom: '1px solid var(--border-subtle)',
};
