import { useState, useRef, useEffect } from 'react';
import { TbFolder, TbFolderPlus, TbChevronDown, TbX, TbSettings } from 'react-icons/tb';
import api from '../../utils/api';
import { toast } from '../Toast/toast';
import { useGraph } from '../../hooks/graphContext';
import WorkspaceSettings from './WorkspaceSettings';

// The active workspace, chosen from the header rather than a sidebar.
//
// A workspace is a context that cuts across the whole journey, not a step in
// it: it holds reports, and only reaches models and datasources indirectly. A
// permanent left column would claim 240px on all three stages — including the
// two where it means nothing — and break the symmetric gutters the join lines
// rely on.
export default function WorkspacePicker({ canCreate }) {
  const { workspaces, selectedWs, setSelectedWs, refresh } = useGraph();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [settingsFor, setSettingsFor] = useState(null);
  const [newName, setNewName] = useState('');
  const boxRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    const onEsc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onEsc); };
  }, [open]);

  const current = selectedWs ? workspaces.find((w) => w.id === selectedWs) : null;
  const currentName = current ? current.name : 'My Reports';

  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const res = await api.post('/workspaces', { name });
      await refresh();
      setSelectedWs(res.data.workspace.id);
      setNewName('');
      setCreating(false);
      setOpen(false);
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to create workspace');
    }
  };

  const pick = (id) => { setSelectedWs(id); setOpen(false); };

  return (
    <div ref={boxRef} style={relStyle}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={pillStyle}
        title="Active workspace"
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-subtle)'; }}
      >
        <TbFolder size={14} />
        <span style={nameStyle}>{currentName}</span>
        <TbChevronDown size={12} style={{ transition: 'transform 0.12s', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>

      {open && (
        <div style={dropdown}>
          <div style={sectionLabel}>Workspace</div>
          <button onClick={() => pick(null)} className="btn-hover" style={rowStyle(!selectedWs)}>
            <TbFolder size={15} />
            <span style={rowName}>My Reports</span>
          </button>
          {workspaces.map((ws) => (
            <button key={ws.id} onClick={() => pick(ws.id)} className="btn-hover" style={rowStyle(selectedWs === ws.id)}>
              <TbFolder size={15} />
              <span style={rowName}>{ws.name}</span>
              <span style={countStyle}>{ws.report_count}</span>
            </button>
          ))}

          {selectedWs && (
            <>
              <div style={divider} />
              <button
                onClick={() => { setSettingsFor(selectedWs); setOpen(false); }}
                className="btn-hover"
                style={{ ...rowStyle(false), color: 'var(--text-muted)' }}
              >
                <TbSettings size={15} />
                <span style={rowName}>Workspace settings</span>
              </button>
            </>
          )}

          {canCreate && (
            <>
              <div style={divider} />
              {creating ? (
                <div style={createRow}>
                  <input
                    autoFocus
                    placeholder="Workspace name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') create(); }}
                    style={inputStyle}
                  />
                  <button onClick={create} disabled={!newName.trim()} title="Create" style={okBtn(!!newName.trim())}>+</button>
                  <button onClick={() => { setCreating(false); setNewName(''); }} title="Cancel" style={cancelBtn}>
                    <TbX size={13} />
                  </button>
                </div>
              ) : (
                <button onClick={() => setCreating(true)} className="btn-hover" style={{ ...rowStyle(false), color: 'var(--text-muted)' }}>
                  <TbFolderPlus size={15} />
                  <span style={rowName}>New workspace</span>
                </button>
              )}
            </>
          )}
        </div>
      )}

      {settingsFor && (
        <WorkspaceSettings workspaceId={settingsFor} onClose={() => setSettingsFor(null)} />
      )}
    </div>
  );
}

const relStyle = { position: 'relative' };
const pillStyle = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '6px 10px', borderRadius: 8,
  background: 'var(--bg-subtle)', border: '1px solid var(--border-default)',
  fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500,
  cursor: 'pointer', transition: 'background 0.12s', maxWidth: 220,
};
const nameStyle = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const dropdown = {
  position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 200,
  minWidth: 240, background: 'var(--bg-panel)', border: '1px solid var(--border-default)',
  borderRadius: 10, boxShadow: 'var(--shadow-md)', padding: '6px 0',
};
const sectionLabel = { fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '6px 12px 4px' };
const divider = { height: 1, background: 'var(--border-default)', margin: '4px 0' };
const rowName = { flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const countStyle = { fontSize: 10, color: 'var(--text-disabled)' };
const createRow = { display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px' };
const inputStyle = {
  flex: 1, minWidth: 0, padding: '4px 8px', fontSize: 12,
  border: '1px solid var(--border-default)', borderRadius: 6,
  background: 'var(--bg-panel)', color: 'var(--text-primary)', outline: 'none',
};

function rowStyle(active) {
  return {
    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
    padding: '7px 12px', border: 'none', cursor: 'pointer',
    fontSize: 13, textAlign: 'left',
    background: active ? 'var(--bg-active)' : 'transparent',
    color: active ? 'var(--accent-primary)' : 'var(--text-secondary)',
    fontWeight: active ? 600 : 400,
  };
}
function okBtn(enabled) {
  return {
    width: 22, height: 22, padding: 0, border: 'none', borderRadius: 5,
    cursor: enabled ? 'pointer' : 'not-allowed',
    background: enabled ? 'var(--accent-primary)' : 'var(--bg-hover)',
    color: enabled ? '#fff' : 'var(--text-disabled)',
    fontSize: 13, fontWeight: 600, lineHeight: 1,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  };
}
const cancelBtn = {
  width: 22, height: 22, padding: 0, border: 'none', borderRadius: 5,
  background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
};
