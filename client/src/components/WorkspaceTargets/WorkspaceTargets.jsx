import { useState } from 'react';
import Modal from '../Modal/Modal';
import {
  actionModalTitle, actionModalInput, actionModalActions, actionModalBtnPrimary, actionModalBtnSecondary,
} from '../dashboardModalStyles';

// The two dialogs a source or a model card opens to change where it lives or
// who else sees it. `options` = [{ id, name }] already narrowed by the caller
// to the workspaces the action allows (the server decides for real).

export function MoveToWorkspaceModal({ title, currentId, options, onSubmit, onClose }) {
  const first = options.find((o) => o.id !== currentId);
  const [target, setTarget] = useState(first ? first.id : '');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!target || target === currentId) return;
    setBusy(true);
    try { await onSubmit(target); } finally { setBusy(false); }
  };
  return (
    <Modal onClose={onClose}>
      <div style={actionModalTitle}>{title}</div>
      <select value={target} onChange={(e) => setTarget(e.target.value)} style={actionModalInput}>
        {options.map((o) => (
          <option key={o.id} value={o.id} disabled={o.id === currentId}>{o.name}{o.id === currentId ? ' (current)' : ''}</option>
        ))}
      </select>
      <div style={actionModalActions}>
        <button className="btn-hover" style={actionModalBtnSecondary} onClick={onClose}>Cancel</button>
        <button className="btn-hover btn-hover-primary" style={actionModalBtnPrimary} onClick={submit} disabled={busy || !target || target === currentId}>Move</button>
      </div>
    </Modal>
  );
}

const checkRow = { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 2px', fontSize: 13, color: 'var(--text-primary)', cursor: 'pointer' };
const emptyNote = { fontSize: 12, color: 'var(--text-muted)', padding: '8px 2px' };

export function ShareWithWorkspacesModal({ title, options, initial, onSubmit, onClose }) {
  const [picked, setPicked] = useState(() => new Set(initial || []));
  const [busy, setBusy] = useState(false);
  const toggle = (id) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const submit = async () => {
    setBusy(true);
    try { await onSubmit([...picked]); } finally { setBusy(false); }
  };
  return (
    <Modal onClose={onClose}>
      <div style={actionModalTitle}>{title}</div>
      {options.length === 0 ? (
        <div style={emptyNote}>You belong to no other workspace to share it with.</div>
      ) : options.map((o) => (
        <label key={o.id} style={checkRow}>
          <input type="checkbox" checked={picked.has(o.id)} onChange={() => toggle(o.id)} />
          <span>{o.name}</span>
        </label>
      ))}
      <div style={actionModalActions}>
        <button className="btn-hover" style={actionModalBtnSecondary} onClick={onClose}>Cancel</button>
        <button className="btn-hover btn-hover-primary" style={actionModalBtnPrimary} onClick={submit} disabled={busy}>Save</button>
      </div>
    </Modal>
  );
}
