import { useState, useEffect } from 'react';
import { TbThumbUp, TbThumbDown } from 'react-icons/tb';
import api from '../../utils/api';
import Paged from '../../components/Pager/Paged';

const headLabel = { fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' };
const totalsRow = { display: 'flex', alignItems: 'center', gap: 14, margin: '6px 0 10px', fontSize: 13, color: 'var(--text-secondary)' };
const figure = { display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 600 };
const list = { display: 'flex', flexDirection: 'column', border: '1px solid var(--border-default)', borderRadius: 6 };
const emptyRow = { padding: '14px 10px', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' };
const item = { display: 'flex', alignItems: 'flex-start', gap: 10, padding: '7px 10px', borderBottom: '1px solid var(--border-subtle)' };
const question = { fontSize: 13, color: 'var(--text-primary)', wordBreak: 'break-word' };
const meta = { fontSize: 11, color: 'var(--text-muted)', marginTop: 2, wordBreak: 'break-word' };
const PAGE_SIZE = 8;
const UP = 'var(--state-success)';
const DOWN = 'var(--state-danger, #dc2626)';

// What users made of the assistant's answers: the question and the visual it
// chose. The answer's text is not kept — it can quote data.
export default function AiFeedbackSection() {
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get('/admin/ai/feedback', { params: { days: 30 } })
      .then((res) => setData(res.data))
      .catch(() => { /* admin gate handled by the page */ });
  }, []);

  if (!data) return null;
  return (
    <div>
      <div style={headLabel}>Answers rated by users — last {data.days} days</div>
      <div style={totalsRow}>
        <span style={{ ...figure, color: UP }}><TbThumbUp size={14} /> {data.totals.up}</span>
        <span style={{ ...figure, color: DOWN }}><TbThumbDown size={14} /> {data.totals.down}</span>
        {data.byModel.slice(0, 3).map((m) => <span key={m.modelId}>{m.modelName || 'Deleted model'}: {m.up} / {m.down}</span>)}
      </div>
      <Paged items={data.recent} pageSize={PAGE_SIZE} resetKey="">{(rows) => (
        <div style={list}>
          {rows.length === 0 && <div style={emptyRow}>No rating yet</div>}
          {rows.map((r, i) => (
            <div key={i} style={item}>
              {r.rating === 'up' ? <TbThumbUp size={15} color={UP} /> : <TbThumbDown size={15} color={DOWN} />}
              <div style={{ minWidth: 0 }}>
                <div style={question}>{r.question || '—'}</div>
                <div style={meta}>
                  {r.visuals.map((v) => `${v.type}${v.title ? ` “${v.title}”` : ''}`).join(' · ') || 'no visual'}
                  {' — '}{r.modelName || 'deleted model'} · {r.providerModel || 'unknown model'} · {r.userEmail || 'deleted user'}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}</Paged>
    </div>
  );
}
