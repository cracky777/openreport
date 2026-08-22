import { useState, useEffect, useRef } from 'react';
import { TbBookmark, TbTrash, TbCheck } from 'react-icons/tb';
import api from '../../utils/api';
import { toast } from '../Toast/toast';

// Viewer bookmarks — personal named captures of the current view (page +
// slicer/filter selections). Self-contained: fetches its own list and
// hides itself entirely when the caller isn't authenticated (public
// anonymous viewers get a 401 on the first fetch — the feature needs an
// identity to attach bookmarks to).
export default function BookmarkMenu({ reportId, getState, onApply, buttonStyle }) {
  const [available, setAvailable] = useState(false);
  const [bookmarks, setBookmarks] = useState([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!reportId) return;
    api.get(`/reports/${reportId}/bookmarks`)
      .then((res) => { setBookmarks(res.data.bookmarks || []); setAvailable(true); })
      .catch(() => setAvailable(false)); // anonymous / embed — no bookmarks
  }, [reportId]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  if (!available) return null;

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      const res = await api.post(`/reports/${reportId}/bookmarks`, { name: trimmed, state: getState() });
      setBookmarks((prev) => [...prev, res.data.bookmark]);
      setName('');
      toast(`Bookmark "${trimmed}" saved`, 'success');
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to save the bookmark');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (bm) => {
    try {
      await api.delete(`/reports/${reportId}/bookmarks/${bm.id}`);
      setBookmarks((prev) => prev.filter((b) => b.id !== bm.id));
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to delete the bookmark');
    }
  };

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={buttonStyle}
        title="Bookmarks — save and recall this view's filters"
      >
        <TbBookmark size={14} />
      </button>
      {open && (
        <div style={menuStyle}>
          {bookmarks.length === 0 ? (
            <div style={emptyStyle}>
              No bookmarks yet — set your filters, then save the view under a name.
            </div>
          ) : (
            bookmarks.map((bm) => (
              <div key={bm.id} style={rowStyle}>
                <button
                  style={applyBtn}
                  onClick={() => { onApply(bm.state || {}); setOpen(false); }}
                  title="Apply this view"
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  {bm.name}
                </button>
                <button style={delBtn} onClick={() => remove(bm)} title="Delete this bookmark">
                  <TbTrash size={13} />
                </button>
              </div>
            ))
          )}
          <div style={saveRowStyle}>
            <input
              value={name}
              placeholder="Save current view as…"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
              style={inputStyle}
            />
            <button
              onClick={save}
              disabled={!name.trim() || saving}
              style={{ ...saveBtn, opacity: !name.trim() || saving ? 0.5 : 1 }}
              title="Save the current page + filters"
            >
              <TbCheck size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const menuStyle = {
  position: 'absolute', top: '110%', right: 0, zIndex: 60, width: 240,
  background: 'var(--bg-panel)', border: '1px solid var(--border-default)',
  borderRadius: 8, boxShadow: '0 6px 24px rgba(0,0,0,0.14)', padding: 6,
};
const emptyStyle = { fontSize: 12, color: 'var(--text-muted)', padding: '8px 8px 10px', lineHeight: 1.5 };
const rowStyle = { display: 'flex', alignItems: 'center', gap: 4 };
const applyBtn = {
  flex: 1, textAlign: 'left', fontSize: 13, padding: '7px 8px', border: 'none',
  background: 'transparent', color: 'var(--text-primary)', borderRadius: 5, cursor: 'pointer',
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};
const delBtn = {
  border: 'none', background: 'transparent', color: 'var(--text-disabled)',
  cursor: 'pointer', padding: 4, display: 'inline-flex', flexShrink: 0,
};
const saveRowStyle = {
  display: 'flex', gap: 4, marginTop: 6, paddingTop: 6,
  borderTop: '1px solid var(--border-default)',
};
const inputStyle = {
  flex: 1, minWidth: 0, padding: '6px 8px', fontSize: 12, borderRadius: 5,
  border: '1px solid var(--border-default)', outline: 'none',
  background: 'var(--bg-panel)', color: 'var(--text-primary)',
};
const saveBtn = {
  border: 'none', borderRadius: 5, background: 'var(--accent-primary)', color: '#fff',
  cursor: 'pointer', padding: '0 10px', display: 'inline-flex', alignItems: 'center',
};
