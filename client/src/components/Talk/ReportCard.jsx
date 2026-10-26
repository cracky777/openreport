import { useState } from 'react';
import { TbFileText, TbCheck, TbExternalLink } from 'react-icons/tb';
import api from '../../utils/api';
import { toast } from '../Toast/toast';
import { seedStudioThread } from '../../utils/studioThread';
import { describeUnderstood } from '../../utils/aiProposal';
import { cardStyle, rowStyle, iconStyle, titleStyle, subStyle, actionsStyle, applyBtn, doneStyle } from '../AiPanel/actionCardStyles';

// A whole report the assistant proposed (kind 'report'): its pages, one
// button. The report is made in the AI studio, the way a report built there
// is: an empty report opens on this card, applied at once, then the designer
// gives every page its look (Jonathan: made straight from the conversation,
// it kept the defaults and the conversation's colors).
const pagesStyle = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text-secondary)' };
const pageRowStyle = { display: 'flex', justifyContent: 'space-between', gap: 8, padding: '4px 8px', borderRadius: 6, background: 'var(--bg-panel)' };
const countStyle = { color: 'var(--text-muted)', whiteSpace: 'nowrap' };
const linkBtn = { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--accent-primary)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 };

export default function ReportCard({ proposal, model, modelId, workspaceId, onCreated, onOpen, created, question = '', answer = '' }) {
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState(created || null);
  const visuals = proposal.pages.reduce((n, p) => n + p.widgets.length, 0);
  const understood = describeUnderstood(proposal.understood, model);

  const create = async () => {
    if (busy || made) return;
    setBusy(true);
    try {
      const res = await api.post('/reports', { title: proposal.title, modelId, workspaceId: workspaceId || undefined, autoTitle: true });
      const { id, title } = res.data.report;
      const at = Date.now();
      seedStudioThread(id, [
        { role: 'user', text: question || proposal.title, at },
        { role: 'assistant', answerId: `talk-${at}`, question, text: answer, proposals: [proposal], autoApply: true, at: at + 1 },
      ]);
      setMade({ reportId: id, title });
      onCreated?.({ reportId: id, title });
      onOpen?.(id);
    } catch (err) {
      toast(err.response?.data?.error || 'The report could not be created');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={cardStyle}>
      <div style={rowStyle}>
        <TbFileText size={16} style={iconStyle} />
        <div style={{ minWidth: 0 }}>
          <div style={titleStyle}>{proposal.title}</div>
          <div style={subStyle}>{proposal.pages.length} page{proposal.pages.length > 1 ? 's' : ''}, {visuals} visual{visuals > 1 ? 's' : ''}</div>
          {understood ? <div style={subStyle}>{understood}</div> : null}
        </div>
      </div>
      <div style={pagesStyle}>
        {proposal.pages.map((p, i) => (
          <div key={i} style={pageRowStyle}>
            <span>{i + 1}. {p.name}</span>
            <span style={countStyle}>{p.widgets.map((w) => w.config?.title || w.type).join(' · ')}</span>
          </div>
        ))}
      </div>
      {made ? (
        <div style={actionsStyle}>
          <span style={doneStyle}><TbCheck size={14} /> Created: {made.title}</span>
          <button type="button" style={linkBtn} onClick={() => onOpen?.(made.reportId)}><TbExternalLink size={13} /> Open the report</button>
        </div>
      ) : (
        <div style={actionsStyle}>
          <button type="button" style={applyBtn(!busy)} onClick={create} disabled={busy}><TbCheck size={14} /> {busy ? 'Creating…' : 'Create report'}</button>
        </div>
      )}
    </div>
  );
}
