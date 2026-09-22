import { useEffect, useState } from 'react';
import { TbCalendarTime, TbCheck, TbSparkles } from 'react-icons/tb';
import { useNavigate } from 'react-router-dom';
import api from '../../utils/api';
import { toast } from '../Toast/toast';
import { handOver } from '../../utils/modelAssistantHandoff';

const cardStyle = {
  display: 'flex', flexDirection: 'column', gap: 10, padding: 12, borderRadius: 12,
  background: 'var(--bg-app)', border: '1px solid var(--border-default)',
};
const rowStyle = { display: 'flex', gap: 10, alignItems: 'flex-start' };
const iconStyle = { flexShrink: 0, marginTop: 1, color: 'var(--accent-primary)' };
const titleStyle = { fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.35 };
const subStyle = { fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4, marginTop: 2 };
const selectStyle = {
  width: '100%', boxSizing: 'border-box', padding: '6px 8px', fontSize: 12, borderRadius: 7,
  border: '1px solid var(--border-default)', background: 'var(--bg-panel)', color: 'var(--text-primary)',
};
const actionsStyle = { display: 'flex', justifyContent: 'flex-end', gap: 6 };
const quietBtn = {
  padding: '6px 11px', fontSize: 12, borderRadius: 8, cursor: 'pointer',
  border: '1px solid var(--border-default)', background: 'transparent', color: 'var(--text-muted)',
};
const applyBtn = (active) => ({
  display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 11px', fontSize: 12, fontWeight: 600,
  border: 'none', borderRadius: 8, color: '#fff', background: 'var(--accent-primary)',
  cursor: active ? 'pointer' : 'default', opacity: active ? 1 : 0.5,
});
const doneStyle = { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: 'var(--state-success)' };

const WEEKDAY_LABELS = { sunday: 'Sunday', monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday', thursday: 'Thursday', friday: 'Friday', saturday: 'Saturday' };

function describeSchedule({ frequency, weekday, monthDay, time }) {
  if (frequency === 'hourly') return `Every hour at ${time}`;
  if (frequency === 'weekly') return `Every ${WEEKDAY_LABELS[weekday]} at ${time}`;
  if (frequency === 'monthly') return `On day ${monthDay} of every month at ${time}`;
  return `Every day at ${time}`;
}

function browserTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; /* no Intl zone data */ }
}

/**
 * The data model is changed in the model editor, by its own assistant: the
 * card opens it with the user's request in its input box, not sent. From the
 * report editor it opens in a new tab — leaving would drop unsaved work.
 */
function ModelAssistantCard({ proposal, inEditor, onOutcome }) {
  const navigate = useNavigate();
  const [state, setState] = useState('open'); // open | applied | dismissed
  const finish = (next) => { setState(next); onOutcome?.(next); };
  const open = () => {
    handOver(proposal.modelId, proposal.request);
    const url = `/models/${proposal.modelId}?assistant=1`;
    if (inEditor) window.open(url, '_blank', 'noopener');
    else navigate(url);
    finish('applied');
  };

  if (state === 'dismissed') return <div style={subStyle}>Dismissed</div>;
  return (
    <div style={cardStyle}>
      <div style={rowStyle}>
        <TbSparkles size={18} style={iconStyle} />
        <div style={{ minWidth: 0 }}>
          <div style={titleStyle}>Change the data model</div>
          <div style={subStyle}>{proposal.summary || 'The model assistant, in the model editor, can do this.'}</div>
        </div>
      </div>
      <div style={actionsStyle}>
        <button style={quietBtn} onClick={() => finish('dismissed')}>Dismiss</button>
        <button style={applyBtn(true)} onClick={open}>
          <TbSparkles size={14} /> {state === 'applied' ? 'Open again' : 'Open model assistant'}
        </button>
      </div>
    </div>
  );
}

export default function ActionCard(props) {
  if (props.proposal.action === 'open_model_assistant') {
    return <ModelAssistantCard proposal={props.proposal} inEditor={!!props.reportId} onOutcome={props.onOutcome} />;
  }
  return <ScheduleCard {...props} />;
}

/**
 * Something the assistant proposes to DO for the user — for now, a cache
 * refresh schedule. Nothing happens until the user confirms: the card then
 * calls the ordinary schedule route, with the user's own rights.
 *
 * `reportId`: the report open in the editor. In the Ask panel there is none,
 * and the user picks one of the reports of `modelId` they can write.
 */
function ScheduleCard({ proposal, reportId, modelId, onOutcome }) {
  const fixed = proposal.reportId || reportId || null;
  const [reports, setReports] = useState(null);
  const [picked, setPicked] = useState('');
  const [state, setState] = useState('open'); // open | busy | applied | dismissed
  const timezone = browserTimeZone();

  useEffect(() => {
    if (fixed || !modelId) return;
    api.get('/reports/writable', { params: { modelId } })
      .then((res) => {
        const list = res.data.reports || [];
        setReports(list);
        if (list.length) setPicked(list[0].id);
      })
      .catch(() => setReports([]));
  }, [fixed, modelId]);

  const target = fixed || picked;
  const finish = (next) => { setState(next); onOutcome?.(next); };

  const apply = async () => {
    if (!target || state !== 'open') return;
    setState('busy');
    try {
      await api.post(`/cache-schedules/by-report/${target}`, { cronExpression: proposal.cron, timezone });
      finish('applied');
    } catch (err) {
      setState('open');
      toast(err.response?.data?.error === 'Forbidden' ? 'Only the owner of the report (or an admin) can schedule it' : (err.response?.data?.error || 'The schedule could not be created'));
    }
  };

  if (state === 'dismissed') return <div style={subStyle}>Dismissed</div>;

  return (
    <div style={cardStyle}>
      <div style={rowStyle}>
        <TbCalendarTime size={18} style={iconStyle} />
        <div style={{ minWidth: 0 }}>
          <div style={titleStyle}>Refresh the report's cache</div>
          <div style={subStyle}>{describeSchedule(proposal.schedule)} ({timezone})</div>
          {proposal.summary ? <div style={subStyle}>{proposal.summary}</div> : null}
        </div>
      </div>
      {!fixed && state === 'open' && (
        reports && !reports.length
          ? <div style={subStyle}>No report of this data model that you can edit.</div>
          : (
            <select style={selectStyle} value={picked} onChange={(e) => setPicked(e.target.value)} aria-label="Report to schedule" disabled={!reports}>
              {(reports || []).map((r) => <option key={r.id} value={r.id}>{r.workspace_name ? `${r.title} — ${r.workspace_name}` : r.title}</option>)}
            </select>
          )
      )}
      {state === 'applied' ? (
        <span style={doneStyle}><TbCheck size={14} /> Scheduled</span>
      ) : (
        <div style={actionsStyle}>
          <button style={quietBtn} onClick={() => finish('dismissed')} disabled={state === 'busy'}>Dismiss</button>
          <button style={applyBtn(!!target && state === 'open')} onClick={apply} disabled={!target || state !== 'open'}>
            <TbCalendarTime size={14} /> {state === 'busy' ? 'Scheduling…' : 'Schedule'}
          </button>
        </div>
      )}
    </div>
  );
}
