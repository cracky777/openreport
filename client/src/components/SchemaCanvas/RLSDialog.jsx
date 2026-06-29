import { useEffect, useState } from 'react';
import { TbX, TbPlus, TbTrash, TbAlertTriangle } from 'react-icons/tb';
import api from '../../utils/api';

/**
 * Row-level security configuration dialog for a single table.
 *
 * Props:
 *   modelId           — current model id (used for the /rls/rows fetch)
 *   tableName         — the table being configured
 *   tableColumns      — array of { column_name, data_type } available in this table
 *   rls               — current rls config from the model: { enabled, table, primaryKey, rules }
 *   onChange(rls)     — called whenever the config is modified
 *   onClose()         — close the dialog
 *
 * Pattern format (glob with `*` wildcard, case-insensitive):
 *   alice@openreport.io   exact email
 *   *@openreport.io       any email in the openreport.io domain
 *   alice*                emails starting with "alice"
 *   *admin*               emails containing "admin"
 *   *                     any authenticated user
 */
export default function RLSDialog({ modelId, tableName, tableColumns, rls, onChange, onClose }) {
  // "Active" = RLS truly enabled in the model, on this exact table.
  const isThisTableActive = rls?.enabled && rls?.table === tableName;
  // "Draft for this table" = a config (PK / rules) is being kept against this
  // table, even if not enabled yet. Lets the user prep the config before
  // flipping the toggle.
  const isDraftForThisTable = rls?.table === tableName;
  const [primaryKey, setPrimaryKey] = useState(isDraftForThisTable ? (rls?.primaryKey || '') : '');
  const [rows, setRows] = useState(null); // null = not loaded yet
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [newPattern, setNewPattern] = useState({}); // { rowKey: 'pending text' }
  const [activeRowKey, setActiveRowKey] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [search, setSearch] = useState('');
  const [truncated, setTruncated] = useState(false);
  // Latched flag so we can show "you can't enable yet" feedback once the
  // user actually tried to flip the toggle while the conditions weren't met.
  const [enableAttempted, setEnableAttempted] = useState(false);
  // "Explicit disable" latch. Set when the user manually unchecks the
  // toggle, cleared when they manually re-check it. While the latch is on,
  // adding more patterns won't auto-re-enable RLS (matches: "if I disabled
  // it on purpose, leave it disabled even if I keep editing patterns").
  // At mount we infer the latch: if RLS is disabled BUT patterns exist for
  // this table, the user almost certainly disabled it explicitly before.
  const [explicitlyDisabled, setExplicitlyDisabled] = useState(() => {
    if (!rls || rls.table !== tableName) return false;
    if (rls.enabled) return false;
    const r = rls.rules || {};
    return Object.values(r).some((arr) => Array.isArray(arr) && arr.length > 0);
  });

  // Rules are always read from the parent's draft for this table — patterns
  // entered while disabled persist exactly the same as those entered while
  // enabled.
  const rules = isDraftForThisTable && rls?.rules ? rls.rules : {};
  const hasAnyPattern = Object.values(rules).some((arr) => Array.isArray(arr) && arr.length > 0);
  // Preconditions for activating RLS on this table.
  const canEnable = !!primaryKey && hasAnyPattern;

  // Fetch user suggestions while typing in any row's input. Debounced.
  useEffect(() => {
    if (!activeRowKey) { setSuggestions([]); return; }
    const q = (newPattern[activeRowKey] || '').trim();
    // Don't autocomplete if it's a wildcard pattern — let the user type freely.
    if (q.length < 2 || q.includes('*')) { setSuggestions([]); return; }
    const handle = setTimeout(() => {
      api.get('/auth/users/search', { params: { q } })
        .then((res) => setSuggestions(res.data.users || []))
        .catch(() => setSuggestions([]));
    }, 200);
    return () => clearTimeout(handle);
  }, [activeRowKey, newPattern]);

  // Fetch rows when the primary key changes or the search query changes (debounced).
  // The server applies a LIKE filter on the primary key column, so the search reaches
  // every row in the table — not just the first 1000 displayed.
  useEffect(() => {
    if (!primaryKey || !tableName) { setRows(null); return; }
    let cancelled = false;
    const trimmed = search.trim();
    const timer = setTimeout(() => {
      if (cancelled) return;
      setLoading(true);
      setError(null);
      api.get(`/models/${modelId}/rls/rows`, {
        params: { table: tableName, primaryKey, search: trimmed || undefined },
      })
        .then((res) => {
          if (cancelled) return;
          setRows(res.data.rows || []);
          setTruncated(!!res.data.truncated);
        })
        .catch((err) => {
          if (cancelled) return;
          setError(err.response?.data?.error || err.message);
          setRows([]);
          setTruncated(false);
        })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, trimmed ? 300 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [modelId, tableName, primaryKey, search]);

  // Try to flip RLS to enabled. Refuses unless a PK is selected AND at
  // least one filter pattern exists somewhere — without those, RLS would
  // either crash or deny every row to viewers, which is almost never the
  // intent.
  const enableForThisTable = () => {
    if (!canEnable) {
      setEnableAttempted(true);
      return;
    }
    setEnableAttempted(false);
    setExplicitlyDisabled(false);
    onChange({ ...(rls || {}), enabled: true, table: tableName, primaryKey, rules });
  };

  const disable = () => {
    setExplicitlyDisabled(true);
    onChange({ ...(rls || {}), enabled: false });
  };

  // Persist PK + rules edits even while disabled, so the user can prep the
  // config (and we can then validate it before allowing them to enable).
  // Switching tables wipes the previous draft because the model only carries
  // ONE rls object.
  const setPK = (pk) => {
    setPrimaryKey(pk);
    onChange({
      ...(rls || {}),
      table: tableName,
      primaryKey: pk,
      rules: isDraftForThisTable ? (rls?.rules || {}) : {},
      enabled: isDraftForThisTable ? !!rls?.enabled : false,
    });
  };

  const addPattern = (rowKey) => {
    const pattern = (newPattern[rowKey] || '').trim();
    if (!pattern) return;
    const list = rules[rowKey] || [];
    if (list.includes(pattern)) {
      setNewPattern((s) => ({ ...s, [rowKey]: '' }));
      return;
    }
    // Auto-enable when adding a pattern unlocks the prerequisites — unless
    // the user has explicitly disabled this dialog session (latch). Once
    // the latch is set, no amount of pattern editing brings RLS back; the
    // user has to re-tick the box manually.
    const wasEnabled = isDraftForThisTable && !!rls?.enabled;
    const shouldAutoEnable = !explicitlyDisabled && !wasEnabled && !!primaryKey;
    onChange({
      ...(rls || {}),
      table: tableName,
      primaryKey,
      rules: { ...rules, [rowKey]: [...list, pattern] },
      enabled: shouldAutoEnable || wasEnabled,
    });
    setNewPattern((s) => ({ ...s, [rowKey]: '' }));
  };

  const removePattern = (rowKey, idx) => {
    const list = (rules[rowKey] || []).filter((_, i) => i !== idx);
    const next = { ...rules };
    if (list.length === 0) delete next[rowKey];
    else next[rowKey] = list;
    // If removing the last pattern emptied everything AND RLS was enabled,
    // auto-disable — keeping it enabled with zero patterns means viewers
    // see nothing, which is nearly always a bug.
    const stillHasAny = Object.values(next).some((arr) => Array.isArray(arr) && arr.length > 0);
    onChange({
      ...rls,
      rules: next,
      enabled: !!rls?.enabled && stillHasAny,
    });
  };

  // The other table (if any) currently configured for RLS
  const otherTable = rls?.enabled && rls?.table && rls.table !== tableName ? rls.table : null;

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div style={headerStyle}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Row-level security</div>
            <div style={{ fontSize: 14, color: 'var(--text-primary)', fontWeight: 600, marginTop: 2 }}>{tableName}</div>
          </div>
          <button className="btn-hover" onClick={onClose} style={closeBtn}><TbX size={16} /></button>
        </div>

        {/* Current state + enable toggle */}
        <div style={{ padding: 12, borderBottom: '1px solid var(--border-default)' }}>
          {otherTable && (
            <div style={warnBox}>
              <TbAlertTriangle size={14} />
              <span>RLS is currently enabled on <strong>{otherTable}</strong>. Enabling it here will move it to this table.</span>
            </div>
          )}
          <label
            style={{
              display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
              color: (!isThisTableActive && !canEnable) ? 'var(--text-disabled)' : 'var(--text-secondary)',
              cursor: (!isThisTableActive && !canEnable) ? 'not-allowed' : 'pointer',
            }}
            title={(!isThisTableActive && !canEnable) ? 'Pick a column and add at least one filter pattern below first' : ''}
          >
            <input
              type="checkbox"
              checked={isThisTableActive}
              disabled={!isThisTableActive && !canEnable}
              onChange={(e) => (e.target.checked ? enableForThisTable() : disable())}
            />
            Enable RLS for this table
          </label>
          {!isThisTableActive && (
            <div style={{
              marginTop: 8, fontSize: 11,
              color: enableAttempted ? 'var(--state-warning)' : 'var(--text-muted)',
              lineHeight: 1.5,
            }}>
              {enableAttempted
                ? 'Pick a column and add at least one filter pattern below before enabling.'
                : 'Pick a column below, then add at least one filter pattern. The toggle unlocks once both are set.'}
            </div>
          )}
        </div>

        {/* Primary key + rows — visible whenever the dialog is open so the
            user can prep the config (PK + patterns) before flipping the
            enable toggle. Persisting changes while disabled is intentional. */}
        <>
          <div style={{ padding: 12, borderBottom: '1px solid var(--border-default)' }}>
            <div style={fieldRow}>
              <span style={fieldLabel}>RLS value</span>
              <select
                value={primaryKey}
                onChange={(e) => setPK(e.target.value)}
                style={inputStyle}
              >
                <option value="">— Select column —</option>
                {(tableColumns || []).map((c) => (
                  <option key={c.column_name} value={c.column_name}>{c.column_name}</option>
                ))}
              </select>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-disabled)', marginTop: 4 }}>
              Column that identifies each row when matching access rules.
            </div>
          </div>

          <div style={{ padding: '10px 12px', flex: 1, overflowY: 'auto', minHeight: 0 }}>
            {!primaryKey && (
              <div style={emptyHintStyle}>Pick an RLS value column to load the rows.</div>
            )}
            {primaryKey && loading && (
              <div style={emptyHintStyle}>Loading rows…</div>
            )}
            {primaryKey && error && (
              <div style={{ ...emptyHintStyle, color: 'var(--state-danger)' }}>Error: {error}</div>
            )}
            {primaryKey && !loading && !error && rows && (
              <div>
                <div style={legendStyle}>
                  Add one or several patterns per row. A user is granted access to a row when their
                  email matches any of the patterns. Use <code>*</code> as a wildcard
                  (e.g. <code>*@openreport.io</code>, <code>*admin*</code>, <code>alice@*</code>).
                </div>
                <div style={{ marginBottom: 6, position: 'relative' }}>
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={`Search by ${primaryKey}…`}
                    style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', fontSize: 11 }}
                  />
                  <span style={{
                    position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                    fontSize: 10, color: 'var(--text-disabled)',
                  }}>
                    {rows.length}{truncated ? '+' : ''} rows
                  </span>
                </div>
                {rows.length === 0 && search.trim() && (
                  <div style={emptyHintStyle}>No row matches "{search}".</div>
                )}
                {rows.length === 0 && !search.trim() && (
                  <div style={emptyHintStyle}>No rows in this table.</div>
                )}
                {truncated && (
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6, padding: '4px 6px', background: 'var(--bg-subtle)', borderRadius: 3 }}>
                    Showing the first 1000 matches. Refine the search to narrow down further.
                  </div>
                )}
                {rows.map((row) => {
                  const key = String(row[primaryKey]);
                  const patterns = rules[key] || [];
                  const draft = newPattern[key] || '';
                  return (
                    <div key={key} style={rowItemStyle}>
                      <div style={rowKeyStyle}>{key}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                          {patterns.length === 0 && (
                            <span style={{ fontSize: 11, color: 'var(--text-disabled)' }}>No rule — nobody can see this row.</span>
                          )}
                          {patterns.map((p, i) => (
                            <span key={`${p}-${i}`} style={chipStyle}>
                              {p}
                              <button
                                type="button"
                                className="btn-hover btn-hover-danger"
                                onClick={(e) => { e.stopPropagation(); removePattern(key, i); }}
                                style={chipRemoveStyle}
                                title="Remove pattern"
                              ><TbTrash size={10} style={{ pointerEvents: 'none' }} /></button>
                            </span>
                          ))}
                        </div>
                        <div style={{ display: 'flex', gap: 4, position: 'relative' }}>
                          <input
                            type="text"
                            value={draft}
                            onChange={(e) => {
                              setNewPattern((s) => ({ ...s, [key]: e.target.value }));
                              setActiveRowKey(key);
                            }}
                            onFocus={() => setActiveRowKey(key)}
                            onBlur={() => setTimeout(() => setActiveRowKey((cur) => cur === key ? null : cur), 150)}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPattern(key); } }}
                            placeholder="email or pattern"
                            style={{ ...inputStyle, flex: 1, fontSize: 11 }}
                          />
                          {draft.trim() && (
                            <button
                              type="button"
                              className="btn-hover btn-hover-accent"
                              onMouseDown={(e) => e.preventDefault()} /* keep input focused so onBlur doesn't race */
                              onClick={(e) => { e.stopPropagation(); addPattern(key); }}
                              style={addBtnStyle}
                              title="Add pattern"
                            >
                              <TbPlus size={12} style={{ pointerEvents: 'none' }} />
                            </button>
                          )}
                          {activeRowKey === key && suggestions.length > 0 && (
                            <div style={suggestionDropdownStyle}>
                              {suggestions.map((u) => (
                                <div
                                  key={u.id}
                                  onMouseDown={(e) => {
                                    // Use onMouseDown so this fires before the input's onBlur
                                    // (which would otherwise hide the dropdown before our click registers).
                                    e.preventDefault();
                                    setNewPattern((s) => ({ ...s, [key]: u.email }));
                                    setSuggestions([]);
                                  }}
                                  style={suggestionItemStyle}
                                >
                                  <span style={{ fontFamily: 'monospace' }}>{u.email}</span>
                                  {u.display_name && (
                                    <span style={{ fontSize: 10, color: 'var(--text-disabled)', marginLeft: 6 }}>
                                      {u.display_name}
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      </div>
    </div>
  );
}

const overlayStyle = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
  backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 200,
  display: 'flex', justifyContent: 'center', alignItems: 'center',
};

const panelStyle = {
  width: 520, maxWidth: '90vw', maxHeight: '90vh',
  backgroundColor: 'var(--bg-panel)',
  border: '1px solid var(--border-default)', borderRadius: 8,
  boxShadow: '0 12px 40px rgba(0,0,0,0.2)',
  display: 'flex', flexDirection: 'column', overflow: 'hidden',
};

const headerStyle = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
  padding: '12px 14px', borderBottom: '1px solid var(--border-default)',
  background: 'var(--bg-subtle)',
};

const closeBtn = {
  background: 'transparent', border: 'none', cursor: 'pointer',
  color: 'var(--text-muted)', padding: 4, display: 'inline-flex',
};

const warnBox = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '6px 10px', borderRadius: 4,
  background: 'var(--state-warning-soft, rgba(250,204,21,0.15))',
  color: 'var(--state-warning, #b45309)',
  fontSize: 11, marginBottom: 8,
};

const fieldRow = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 };
const fieldLabel = { fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' };

const inputStyle = {
  padding: '5px 8px', border: '1px solid var(--border-default)', borderRadius: 4,
  fontSize: 12, outline: 'none',
  background: 'var(--bg-panel)', color: 'var(--text-primary)',
};

const legendStyle = {
  fontSize: 11, color: 'var(--text-muted)', marginBottom: 8,
  padding: '6px 8px', background: 'var(--bg-subtle)', borderRadius: 4,
  lineHeight: 1.5,
};

const rowItemStyle = {
  display: 'flex', gap: 10, padding: '8px 0',
  borderTop: '1px solid var(--border-subtle, var(--border-default))',
  alignItems: 'flex-start',
};

const rowKeyStyle = {
  fontSize: 12, fontWeight: 600, color: 'var(--text-primary)',
  minWidth: 110, maxWidth: 140, paddingTop: 4,
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  fontFamily: 'monospace',
};

const chipStyle = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  fontSize: 11, padding: '3px 6px',
  background: 'var(--bg-active)', color: 'var(--accent-primary)',
  border: '1px solid var(--accent-primary)', borderRadius: 12,
  fontFamily: 'monospace',
};

const chipRemoveStyle = {
  background: 'transparent', border: 'none', cursor: 'pointer',
  color: 'var(--state-danger)', padding: 0, display: 'inline-flex',
};

const addBtnStyle = {
  width: 28, height: 26, padding: 0,
  border: '1px solid var(--accent-primary)', background: 'var(--accent-primary)',
  color: '#fff', borderRadius: 4, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
};

const emptyHintStyle = {
  fontSize: 12, color: 'var(--text-muted)', textAlign: 'center',
  padding: '20px 12px',
};

const suggestionDropdownStyle = {
  position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 2,
  background: 'var(--bg-panel)', border: '1px solid var(--border-default)',
  borderRadius: 4, boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
  zIndex: 10, maxHeight: 160, overflowY: 'auto',
};

const suggestionItemStyle = {
  padding: '6px 8px', fontSize: 11, cursor: 'pointer',
  borderBottom: '1px solid var(--border-subtle, var(--border-default))',
  display: 'flex', alignItems: 'center', justifyContent: 'flex-start',
  color: 'var(--text-primary)',
};
