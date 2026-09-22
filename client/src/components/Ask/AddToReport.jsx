import { useEffect, useState } from 'react';
import { TbPlus } from 'react-icons/tb';
import api from '../../utils/api';
import Modal from '../Modal/Modal';
import { toast } from '../Toast/toast';
import { useGraph } from '../../hooks/graphContext';

const titleStyle = { margin: '0 0 12px', fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' };
const tabsStyle = { display: 'flex', gap: 4, marginBottom: 12 };
const tabBtn = (active) => ({
  flex: 1, padding: '6px 8px', fontSize: 12, fontWeight: 600, borderRadius: 6, cursor: 'pointer',
  border: `1px solid ${active ? 'var(--accent-primary)' : 'var(--border-default)'}`,
  background: active ? 'var(--bg-active)' : 'transparent',
  color: active ? 'var(--accent-primary)' : 'var(--text-muted)',
});
const labelStyle = { display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', margin: '10px 0 4px' };
const fieldStyle = {
  width: '100%', boxSizing: 'border-box', padding: '7px 8px', fontSize: 13, borderRadius: 6, outline: 'none',
  border: '1px solid var(--border-default)', background: 'var(--bg-app)', color: 'var(--text-primary)',
};
const noteStyle = { fontSize: 11, lineHeight: 1.45, color: 'var(--text-muted)', marginTop: 10 };
const actionsStyle = { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 };
const cancelBtn = {
  padding: '7px 12px', fontSize: 12, borderRadius: 6, cursor: 'pointer',
  border: '1px solid var(--border-default)', background: 'transparent', color: 'var(--text-muted)',
};
const okBtn = (active) => ({
  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '7px 12px', fontSize: 12, fontWeight: 600,
  border: 'none', borderRadius: 6, background: 'var(--accent-primary)', color: '#fff',
  cursor: active ? 'pointer' : 'default', opacity: active ? 1 : 0.5,
});

/**
 * Where the visuals of an answer go: a report the user may write, or a new one.
 * Both end on the same server route (POST /reports/:id/widgets), which checks
 * the fields again and decides the placement — nothing is laid out here.
 *
 * A custom visual lives in ONE workspace's library: an answer holding one —
 * installed there, or written and about to be — can only go to a report of
 * that workspace (`workspaceId`). A written one (`generated`) joins the library
 * first, which the server allows its admins only.
 *
 * @param {function} onAdded  ({ reportId, title }) => void
 */
export default function AddToReport({ widgets, generated, workspaceId: conversationWs, modelId, defaultTitle, onAdded, onClose }) {
  const { workspaces, selectedWs, personalWorkspace, refresh } = useGraph();
  const lockedWs = generated || widgets.some((w) => w.type === 'customVisual') ? conversationWs : null;
  const [reports, setReports] = useState(null);
  const [target, setTarget] = useState('existing');
  const [reportId, setReportId] = useState('');
  const [pageId, setPageId] = useState('');
  const [title, setTitle] = useState(defaultTitle || '');
  const [workspaceId, setWorkspaceId] = useState(lockedWs || selectedWs || personalWorkspace?.id || '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/reports/writable', { params: { modelId } })
      .then((res) => {
        const list = (res.data.reports || []).filter((r) => !lockedWs || r.workspace_id === lockedWs);
        setReports(list);
        if (list.length) setReportId(list[0].id);
        else setTarget('new');
      })
      .catch(() => { setReports([]); setTarget('new'); });
  }, [modelId, lockedWs]);

  const picked = (reports || []).find((r) => r.id === reportId);
  const ready = target === 'existing' ? !!reportId : !!title.trim();

  const addTo = (id, body) => api.post(`/reports/${id}/widgets`, body);

  // Installed once, even if the report step fails and the user tries again.
  const [installed, setInstalled] = useState(null);
  const widgetsToAdd = async () => {
    if (!generated) return widgets;
    let visual = installed;
    if (!visual) {
      const res = await api.post(`/workspaces/${lockedWs}/visuals/generated`, { manifest: generated.manifest, visualJs: generated.visualJs });
      visual = res.data.visual;
      setInstalled(visual);
    }
    return [{ type: 'customVisual', config: { title: visual.name, visualId: visual.id }, dataBinding: generated.dataBinding }];
  };

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      const toAdd = await widgetsToAdd();
      if (target === 'existing') {
        await addTo(reportId, { widgets: toAdd, ...(pageId ? { pageId } : {}) });
        onAdded({ reportId, title: picked?.title || 'the report' });
      } else {
        const created = await api.post('/reports', { title: title.trim(), modelId, workspaceId: workspaceId || undefined, autoTitle: true });
        const id = created.data.report.id;
        try {
          await addTo(id, { widgets: toAdd });
        } catch (err) {
          // An empty report nobody asked for is not left behind.
          await api.delete(`/reports/${id}`).catch(() => { /* best effort: it shows in the list, empty */ });
          throw err;
        }
        onAdded({ reportId: id, title: created.data.report.title });
      }
      refresh?.();
    } catch (err) {
      toast(err.response?.data?.error || 'The visual could not be added');
    } finally {
      setBusy(false);
    }
  };

  const count = widgets.length;
  return (
    <Modal onClose={busy ? undefined : onClose}>
      <h3 style={titleStyle}>Add {count > 1 ? `${count} visuals` : 'visual'} to a report</h3>
      <div style={tabsStyle} role="tablist">
        <button role="tab" aria-selected={target === 'existing'} style={tabBtn(target === 'existing')} onClick={() => setTarget('existing')} disabled={!reports?.length}>Existing report</button>
        <button role="tab" aria-selected={target === 'new'} style={tabBtn(target === 'new')} onClick={() => setTarget('new')}>New report</button>
      </div>

      {target === 'existing' ? (
        <>
          <label style={labelStyle} htmlFor="ask-add-report">Report</label>
          <select id="ask-add-report" style={fieldStyle} value={reportId} onChange={(e) => { setReportId(e.target.value); setPageId(''); }}>
            {(reports || []).map((r) => <option key={r.id} value={r.id}>{r.workspace_name ? `${r.title} — ${r.workspace_name}` : r.title}</option>)}
          </select>
          {picked?.pages?.length > 1 && (
            <>
              <label style={labelStyle} htmlFor="ask-add-page">Page</label>
              <select id="ask-add-page" style={fieldStyle} value={pageId} onChange={(e) => setPageId(e.target.value)}>
                {picked.pages.map((p, i) => <option key={p.id} value={i === 0 ? '' : p.id}>{p.name}</option>)}
              </select>
            </>
          )}
          <div style={noteStyle}>
            {count > 1 ? 'The visuals go on a page of their own.' : 'The visual goes under what is on the page, or on a new page if there is no room.'}
            {lockedWs ? ' Only reports of the workspace whose library holds this visual are listed.' : ''}
            {' '}If this report is open in an editor, save and close it first: its next save would overwrite the addition.
          </div>
        </>
      ) : (
        <>
          <label style={labelStyle} htmlFor="ask-add-title">Title</label>
          <input id="ask-add-title" style={fieldStyle} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} autoFocus />
          {workspaces?.length > 1 && !lockedWs && (
            <>
              <label style={labelStyle} htmlFor="ask-add-ws">Workspace</label>
              <select id="ask-add-ws" style={fieldStyle} value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)}>
                {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </>
          )}
        </>
      )}

      <div style={actionsStyle}>
        <button style={cancelBtn} onClick={onClose} disabled={busy}>Cancel</button>
        <button style={okBtn(ready && !busy)} onClick={submit} disabled={!ready || busy}><TbPlus size={13} /> {busy ? 'Adding…' : 'Add'}</button>
      </div>
    </Modal>
  );
}
