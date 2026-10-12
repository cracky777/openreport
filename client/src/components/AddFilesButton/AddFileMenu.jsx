import { useEffect, useRef, useState } from 'react';
import { TbFilePlus, TbUpload, TbChevronDown } from 'react-icons/tb';
import { sourceFiles } from '../../utils/sourceFiles';
import { typeOf } from '../../utils/importFiles';

const wrap = { position: 'relative', display: 'inline-flex' };
const menu = {
  position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 50, minWidth: 260, maxWidth: 340,
  background: 'var(--bg-panel)', border: '1px solid var(--border-default)', borderRadius: 10,
  boxShadow: 'var(--shadow-lg)', padding: 6, display: 'flex', flexDirection: 'column', gap: 2,
};
const item = {
  display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 10px', borderRadius: 7, cursor: 'pointer',
  background: 'transparent', border: 'none', textAlign: 'left', fontSize: 13, color: 'var(--text-primary)',
};
const itemIcon = { width: 28, height: 28, borderRadius: 7, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' };
const itemText = { minWidth: 0, display: 'flex', flexDirection: 'column' };
const itemName = { fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const itemMeta = { fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const heading = { fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', padding: '8px 10px 4px' };
const search = {
  margin: '2px 4px 4px', padding: '6px 8px', fontSize: 12, borderRadius: 6,
  border: '1px solid var(--border-default)', background: 'var(--bg-input)', color: 'var(--text-primary)',
};
const list = { maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 };
const empty = { fontSize: 12, color: 'var(--text-muted)', padding: '6px 10px 8px' };

const hover = (e, on) => { e.currentTarget.style.background = on ? 'var(--bg-hover)' : 'transparent'; };

// "Add a file": a new file to import, or a file source already imported.
// `sources`: the file sources that may be added (null while loading);
// `onOpen()` lets the caller fetch them when the menu opens.
export default function AddFileMenu({ sources, onOpen, onImport, onPick, buttonStyle, fullWidth, disabled, label = 'Add a file' }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  const toggle = () => {
    if (!open) { setQuery(''); onOpen?.(); }
    setOpen(!open);
  };
  const shown = (sources || []).filter((s) => s.name.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div ref={ref} style={fullWidth ? { ...wrap, display: 'flex', width: '100%' } : wrap}>
      <button type="button" className="btn-hover" style={buttonStyle} onClick={toggle} disabled={disabled} aria-expanded={open} aria-haspopup="menu">
        <TbFilePlus size={15} /> {label} <TbChevronDown size={13} />
      </button>
      {open && (
        <div style={fullWidth ? { ...menu, left: 0, right: 0, minWidth: 0 } : menu} role="menu">
          <button type="button" role="menuitem" style={item} onMouseEnter={(e) => hover(e, true)} onMouseLeave={(e) => hover(e, false)}
            onClick={() => { setOpen(false); onImport(); }}>
            <span style={{ ...itemIcon, background: 'var(--accent-primary-soft)', color: 'var(--accent-primary)' }}><TbUpload size={16} /></span>
            <span style={itemText}>
              <span style={itemName}>Import a new file…</span>
              <span style={itemMeta}>CSV, Excel, Parquet, JSON, a database file</span>
            </span>
          </button>
          <div style={heading}>Or a file already imported</div>
          {sources && sources.length > 6 && (
            <input style={search} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search sources…" aria-label="Search file sources" autoFocus />
          )}
          <div style={list}>
            {sources === null && <div style={empty}>Loading…</div>}
            {sources && sources.length === 0 && <div style={empty}>No other file source yet.</div>}
            {shown.map((s) => {
              const files = sourceFiles(s);
              const { Icon, color } = typeOf(files[0]?.sourceFile || s.name);
              const tables = files.flatMap((f) => f.tables || []).length;
              return (
                <button key={s.id} type="button" role="menuitem" style={item} onMouseEnter={(e) => hover(e, true)} onMouseLeave={(e) => hover(e, false)}
                  onClick={() => { setOpen(false); onPick(s); }}>
                  <span style={{ ...itemIcon, color, background: `color-mix(in oklab, ${color} 14%, transparent)` }}><Icon size={16} /></span>
                  <span style={itemText}>
                    <span style={itemName} title={s.name}>{s.name}</span>
                    <span style={itemMeta}>{files.map((f) => f.sourceFile).join(', ')}{tables > 1 ? ` · ${tables} tables` : ''}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
