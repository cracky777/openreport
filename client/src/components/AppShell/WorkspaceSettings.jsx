import { useState, useEffect } from 'react';
import { TbX, TbTrash, TbUserPlus } from 'react-icons/tb';
import api from '../../utils/api';
import { toast } from '../Toast/toast';
import { useGraph } from '../../hooks/graphContext';

// Everything you can do *to* the active workspace — rename it, manage who is in
// it, delete it. It hangs off the header picker rather than the Reports stage:
// the workspace is a context for the whole journey, so its settings shouldn't
// only be reachable from one of the three stages.
//
// Self-contained on purpose: it pulls the workspace's own detail (members,
// caller role, cloud flags) so the stages don't have to thread any of that
// through the shell.
export default function WorkspaceSettings({ workspaceId, onClose }) {
  const { workspaces, setSelectedWs, refresh } = useGraph();
  const ws = workspaces.find((w) => w.id === workspaceId);

  const [name, setName] = useState(ws?.name || '');
  const [members, setMembers] = useState([]);
  const [userRole, setUserRole] = useState(null);
  const [canSeeMembers, setCanSeeMembers] = useState(false);
  const [isPersonalOrg, setIsPersonalOrg] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState('viewer');
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get(`/workspaces/${workspaceId}`)
      .then((res) => {
        if (cancelled) return;
        setMembers(res.data.members || []);
        setUserRole(res.data.userRole);
        setIsPersonalOrg(!!res.data.is_personal_org);
        // Cloud responses carry can_see_members; OSS falls back to "is admin".
        setCanSeeMembers(
          res.data.can_see_members !== undefined
            ? !!res.data.can_see_members
            : res.data.userRole === 'admin'
        );
      })
      .catch(() => { if (!cancelled) toast('Could not load workspace details'); });
    return () => { cancelled = true; };
  }, [workspaceId]);

  const isAdmin = userRole === 'admin';

  const rename = async () => {
    const next = name.trim();
    if (!next || next === ws?.name) return;
    try {
      await api.put(`/workspaces/${workspaceId}`, { name: next });
      await refresh();
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to rename workspace');
    }
  };

  const addMember = async () => {
    if (!newEmail.trim()) return;
    try {
      const res = await api.post(`/workspaces/${workspaceId}/members`, { email: newEmail.trim(), role: newRole });
      setMembers((p) => [...p, res.data.member]);
      setNewEmail('');
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to add member');
    }
  };

  const changeRole = async (userId, role) => {
    try {
      await api.put(`/workspaces/${workspaceId}/members/${userId}`, { role });
      setMembers((p) => p.map((m) => (m.id === userId ? { ...m, role } : m)));
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to change role');
    }
  };

  const removeMember = async (userId) => {
    try {
      await api.delete(`/workspaces/${workspaceId}/members/${userId}`);
      setMembers((p) => p.filter((m) => m.id !== userId));
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to remove member');
    }
  };

  const destroy = async () => {
    try {
      await api.delete(`/workspaces/${workspaceId}`);
      setSelectedWs(null);
      await refresh();
      onClose();
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to delete workspace');
    }
  };

  return (
    <div style={backdrop} onClick={onClose}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <div style={head}>
          <h2 style={title}>Workspace settings</h2>
          <button onClick={onClose} title="Close" style={closeBtn}><TbX size={16} /></button>
        </div>

        <label style={fieldLabel}>Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={rename}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          disabled={!isAdmin}
          style={{ ...input, opacity: isAdmin ? 1 : 0.6 }}
        />
        {!isAdmin && <p style={hint}>Only a workspace admin can rename it.</p>}

        {!isPersonalOrg && canSeeMembers && (
          <>
            <div style={sectionHead}>Members</div>
            {members.length === 0 && <p style={hint}>No members yet.</p>}
            {members.map((m) => (
              <div key={m.id} style={memberRow}>
                <span style={memberName}>{m.display_name || m.email}</span>
                {isAdmin ? (
                  <select value={m.role} onChange={(e) => changeRole(m.id, e.target.value)} style={roleSelect}>
                    <option value="admin">Admin</option>
                    <option value="editor">Editor</option>
                    <option value="viewer">Viewer</option>
                  </select>
                ) : (
                  <span style={roleTag}>{m.role}</span>
                )}
                {isAdmin && (
                  <button className="btn-hover btn-hover-danger" onClick={() => removeMember(m.id)} title="Remove" style={rowBtn}>
                    <TbX size={13} />
                  </button>
                )}
              </div>
            ))}

            {isAdmin && (
              <div style={addRow}>
                <input
                  placeholder="Email address"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addMember(); }}
                  style={{ ...input, flex: 1, marginBottom: 0 }}
                />
                <select value={newRole} onChange={(e) => setNewRole(e.target.value)} style={roleSelect}>
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                  <option value="admin">Admin</option>
                </select>
                <button className="btn-hover btn-hover-primary" onClick={addMember} disabled={!newEmail.trim()} style={addBtn}>
                  <TbUserPlus size={14} />
                </button>
              </div>
            )}
          </>
        )}

        {isAdmin && (
          <>
            <div style={divider} />
            {confirmDelete ? (
              <div style={dangerRow}>
                <span style={dangerText}>Delete this workspace? Its reports move back to My Reports.</span>
                <button className="btn-hover" onClick={() => setConfirmDelete(false)} style={ghostBtn}>Cancel</button>
                <button className="btn-hover btn-hover-danger" onClick={destroy} style={dangerBtn}>Delete</button>
              </div>
            ) : (
              <button className="btn-hover btn-hover-danger" onClick={() => setConfirmDelete(true)} style={dangerBtn}>
                <TbTrash size={14} /> Delete workspace
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const backdrop = {
  position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.4)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000,
};
const card = {
  background: 'var(--bg-panel)', borderRadius: 10, padding: 20,
  minWidth: 420, maxWidth: 520, maxHeight: '80vh', overflow: 'auto',
  boxShadow: 'var(--shadow-lg)',
};
const head = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 };
const title = { fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' };
const closeBtn = {
  border: 'none', background: 'transparent', cursor: 'pointer',
  color: 'var(--text-muted)', display: 'inline-flex', padding: 4,
};
const fieldLabel = { display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4, fontWeight: 500 };
const input = {
  width: '100%', padding: '8px 10px', marginBottom: 8,
  border: '1px solid var(--border-default)', borderRadius: 6, fontSize: 14,
  background: 'var(--bg-panel)', color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box',
};
const hint = { fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 };
const sectionHead = {
  fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase',
  letterSpacing: '0.06em', margin: '16px 0 8px',
};
const memberRow = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '6px 0', fontSize: 13, borderBottom: '1px solid var(--bg-subtle)',
};
const memberName = { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)' };
const roleSelect = {
  padding: '4px 6px', fontSize: 12, borderRadius: 6,
  border: '1px solid var(--border-default)', background: 'var(--bg-panel)', color: 'var(--text-secondary)',
};
const roleTag = { fontSize: 12, color: 'var(--text-muted)' };
const rowBtn = { border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--state-danger)', padding: '2px 4px' };
const addRow = { display: 'flex', alignItems: 'center', gap: 6, marginTop: 10 };
const addBtn = {
  border: 'none', borderRadius: 6, padding: '7px 10px', cursor: 'pointer',
  background: 'var(--accent-primary)', color: '#fff', display: 'inline-flex', alignItems: 'center',
};
const divider = { height: 1, background: 'var(--border-default)', margin: '18px 0 12px' };
const dangerRow = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' };
const dangerText = { flex: 1, fontSize: 12, color: 'var(--text-muted)', minWidth: 200 };
const dangerBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '7px 12px', fontSize: 13, borderRadius: 6, cursor: 'pointer',
  background: 'transparent', color: 'var(--state-danger)', border: '1px solid var(--state-danger-border)',
};
const ghostBtn = {
  padding: '7px 12px', fontSize: 13, borderRadius: 6, cursor: 'pointer',
  background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border-default)',
};
