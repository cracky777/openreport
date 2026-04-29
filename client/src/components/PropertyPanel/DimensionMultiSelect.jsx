import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TbChevronDown, TbX } from 'react-icons/tb';
import api from '../../utils/api';

/**
 * Searchable multi-select dropdown for the per-widget Filters section
 * (`is in` / `is not in` operators).
 *
 *   - Trigger: a select-styled button showing "n selected" + chevron.
 *   - Open: a panel rendered via React Portal so it floats above the
 *     property panel's `overflow: auto` clipping. Position recomputed on
 *     scroll / resize / window changes.
 *   - Values are fetched lazily on first open via the model query API.
 *   - Selected values render as small removable chips below the trigger.
 */
export default function DimensionMultiSelect({ modelId, fieldName, selectedValues, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 0 });
  const loadedRef = useRef(false);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const searchRef = useRef(null);

  // Reload when the dimension changes
  useEffect(() => { loadedRef.current = false; setOptions([]); setError(null); }, [fieldName, modelId]);

  // Compute panel coordinates from the trigger's rect; recompute on
  // scroll/resize so the panel follows the trigger (e.g. when the user
  // scrolls inside the property panel while the dropdown is open).
  const updateCoords = () => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    setCoords({ top: r.bottom + 4, left: r.left, width: r.width });
  };
  useLayoutEffect(() => {
    if (!open) return;
    updateCoords();
    window.addEventListener('scroll', updateCoords, true);
    window.addEventListener('resize', updateCoords);
    return () => {
      window.removeEventListener('scroll', updateCoords, true);
      window.removeEventListener('resize', updateCoords);
    };
  }, [open]);

  // Click-outside closes the dropdown
  useEffect(() => {
    if (!open) return;
    const handle = (e) => {
      if (triggerRef.current?.contains(e.target)) return;
      if (panelRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  // Auto-focus search when opening
  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 30);
  }, [open]);

  const ensureLoaded = async () => {
    if (loadedRef.current || !modelId || !fieldName) return;
    loadedRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const res = await api.post(`/models/${modelId}/query`, {
        dimensionNames: [fieldName],
        measureNames: [],
        distinct: true,
        limit: 5000,
      });
      const rows = res.data?.rows || [];
      const key = rows.length > 0 ? Object.keys(rows[0])[0] : null;
      const vals = key ? rows.map((r) => r[key]).filter((v) => v != null && v !== '') : [];
      setOptions(vals.map((v) => String(v)));
    } catch (e) {
      setError(e?.response?.data?.error || 'Could not load values');
      loadedRef.current = false;
    } finally {
      setLoading(false);
    }
  };

  const sel = new Set((selectedValues || []).map(String));
  const filtered = options.filter((o) => !query || o.toLowerCase().includes(query.toLowerCase()));
  const toggle = (val) => {
    const next = new Set(sel);
    if (next.has(val)) next.delete(val); else next.add(val);
    onChange(Array.from(next));
  };
  const removeChip = (val) => {
    onChange((selectedValues || []).filter((v) => String(v) !== val));
  };

  const selCount = (selectedValues || []).length;
  const triggerLabel = selCount === 0 ? 'Select values…' : `${selCount} selected`;

  return (
    <div style={{ width: '100%' }}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => { ensureLoaded(); setOpen((v) => !v); }}
        style={{ ...triggerStyle, borderColor: open ? 'var(--accent-primary)' : 'var(--border-default)' }}
      >
        <span style={{ flex: 1, textAlign: 'left', color: selCount === 0 ? 'var(--text-disabled)' : 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {triggerLabel}
        </span>
        <TbChevronDown size={14} style={{ color: 'var(--text-disabled)', transition: 'transform 120ms', transform: open ? 'rotate(180deg)' : 'none', flexShrink: 0 }} />
      </button>

      {selCount > 0 && (
        <div style={chipsBoxStyle}>
          {(selectedValues || []).map((v) => (
            <span key={String(v)} style={chipStyle}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>{String(v)}</span>
              <button onClick={() => removeChip(String(v))} style={chipDelBtn} title="Remove">
                <TbX size={10} />
              </button>
            </span>
          ))}
        </div>
      )}

      {open && createPortal(
        <div ref={panelRef} style={{
          ...dropdownStyle,
          top: coords.top, left: coords.left, width: coords.width,
        }}>
          <input
            ref={searchRef}
            type="text"
            value={query}
            placeholder={loading ? 'Loading…' : 'Search…'}
            onChange={(e) => setQuery(e.target.value)}
            style={searchInputStyle}
          />
          <div style={listStyle}>
            {error && <div style={{ padding: 8, fontSize: 11, color: 'var(--state-danger)' }}>{error}</div>}
            {!error && loading && (
              <div style={{ padding: 8, fontSize: 11, color: 'var(--text-disabled)' }}>Loading values…</div>
            )}
            {!error && !loading && filtered.length === 0 && (
              <div style={{ padding: 8, fontSize: 11, color: 'var(--text-disabled)', fontStyle: 'italic' }}>No values</div>
            )}
            {!loading && filtered.map((o) => {
              const checked = sel.has(o);
              return (
                <div key={o} onClick={() => toggle(o)} style={{ ...itemStyle, background: checked ? 'var(--bg-active)' : 'transparent' }}>
                  <input type="checkbox" checked={checked} readOnly style={{ marginRight: 6 }} />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o}</span>
                </div>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

const triggerStyle = {
  width: '100%', boxSizing: 'border-box',
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '6px 8px', fontSize: 12,
  border: '1px solid var(--border-default)', borderRadius: 6,
  background: 'var(--bg-panel)', color: 'var(--text-primary)',
  cursor: 'pointer', textAlign: 'left',
  transition: 'border-color 120ms',
};

const chipsBoxStyle = {
  display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4,
};

const chipStyle = {
  display: 'inline-flex', alignItems: 'center', gap: 2,
  padding: '2px 4px 2px 6px', borderRadius: 4, fontSize: 11,
  background: 'var(--accent-primary-soft)', color: 'var(--accent-primary-text)',
  border: '1px solid var(--accent-primary-border)',
  maxWidth: '100%',
};

const chipDelBtn = {
  background: 'transparent', border: 'none', cursor: 'pointer',
  color: 'var(--accent-primary)', lineHeight: 0, padding: 2,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
};

const dropdownStyle = {
  position: 'fixed', zIndex: 9999,
  background: 'var(--bg-panel)', border: '1px solid var(--border-default)',
  borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
  overflow: 'hidden',
};

const searchInputStyle = {
  width: '100%', boxSizing: 'border-box',
  padding: '6px 8px', border: 'none', borderBottom: '1px solid var(--border-default)',
  outline: 'none', fontSize: 12, background: 'var(--bg-subtle)',
};

const listStyle = {
  maxHeight: 240, overflowY: 'auto',
};

const itemStyle = {
  display: 'flex', alignItems: 'center', padding: '5px 8px',
  fontSize: 12, color: 'var(--text-primary)', cursor: 'pointer',
};
