import { useEffect, useState } from 'react';
import { TbCalendarTime, TbCheck, TbSparkles } from 'react-icons/tb';
import RobotHead from '../RobotHead';
import { useNavigate } from 'react-router-dom';
import api from '../../utils/api';
import { toast } from '../Toast/toast';
import { handOver } from '../../utils/assistantHandoff';
import StartCard from './StartCards';
import AddFileCard from './AddFileCard';
import AddMapCard from './AddMapCard';
import { cardStyle, rowStyle, iconStyle, titleStyle, subStyle, selectStyle, actionsStyle, quietBtn, applyBtn, doneStyle } from './actionCardStyles';

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
 * The data model is changed by the model assistant: in the studio, right
 * here in the conversation (`onAskModel`, the request sent — the panel
 * usually passes it on by itself, this card is the way by hand); elsewhere
 * in the model editor, the card opening it with the user's request in its
 * input box, not sent. From the report editor it opens in a new tab —
 * leaving would drop unsaved work.
 */
function ModelAssistantCard({ proposal, inEditor, onOutcome, onAskModel }) {
  const navigate = useNavigate();
  const [state, setState] = useState('open'); // open | applied | dismissed
  const finish = (next) => { setState(next); onOutcome?.(next); };
  const open = () => {
    if (onAskModel) { onAskModel(proposal.request); finish('applied'); return; }
    handOver('model', proposal.modelId, proposal.request);
    const url = `/models/${proposal.modelId}?assistant=1`;
    if (inEditor) window.open(url, '_blank', 'noopener');
    else navigate(url);
    finish('applied');
  };

  if (state === 'dismissed') return <div style={subStyle}>Dismissed</div>;
  return (
    <div style={cardStyle}>
      <div style={rowStyle}>
        <RobotHead size={20} style={iconStyle} />
        <div style={{ minWidth: 0 }}>
          <div style={titleStyle}>Change the data model</div>
          <div style={subStyle}>{proposal.summary || (onAskModel ? 'The model assistant can do this here.' : 'The model assistant, in the model editor, can do this.')}</div>
        </div>
      </div>
      <div style={actionsStyle}>
        <button style={quietBtn} onClick={() => finish('dismissed')}>Dismiss</button>
        <button style={applyBtn(true)} onClick={open}>
          <TbSparkles size={14} /> {onAskModel ? (state === 'applied' ? 'Ask again' : 'Ask the model assistant') : (state === 'applied' ? 'Open again' : 'Open model assistant')}
        </button>
      </div>
    </div>
  );
}

// The first steps, before any report: StartCards.jsx.
const START_ACTIONS = new Set(['connect_database', 'import_file', 'build_model', 'create_report']);

/**
 * @param {function} [onAnswer]        sends a message as the user: a card that changed something tells the assistant
 * @param {function} [onModelChanged]  the data model was changed by a card: the screen reads it again
 * @param {function} [onAskModel]      the studio: the model assistant answers in this conversation, not in the model editor
 */
export default function ActionCard(props) {
  if (START_ACTIONS.has(props.proposal.action)) return <StartCard proposal={props.proposal} onOutcome={props.onOutcome} />;
  if (props.proposal.action === 'add_file_to_model') {
    return <AddFileCard proposal={props.proposal} onOutcome={props.onOutcome} onAnswer={props.onAnswer} onModelChanged={props.onModelChanged} onAskModel={props.onAskModel} />;
  }
  if (props.proposal.action === 'add_map') return <AddMapCard proposal={props.proposal} onOutcome={props.onOutcome} onAnswer={props.onAnswer} />;
  if (props.proposal.action === 'open_model_assistant') {
    return <ModelAssistantCard proposal={props.proposal} inEditor={!!props.reportId} onOutcome={props.onOutcome} onAskModel={props.onAskModel} />;
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
