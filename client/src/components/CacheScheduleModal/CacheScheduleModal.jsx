import { useState } from 'react';
import { TbLoader2, TbPlayerPlay, TbToggleLeft, TbToggleRight, TbTrash } from 'react-icons/tb';
import { TIMEZONE_OPTIONS, timeToCron, formatCronHuman } from '../../utils/scheduleHelpers';
import { scheduleFieldLabel, actionModalBackdrop, actionModalCard, actionModalTitle, actionModalInput, actionModalActions, actionModalBtnSecondary, actionModalBtnPrimary, cardActionBtn } from '../dashboardModalStyles';

const _hs106 = { padding: 20, textAlign: 'center', color: 'var(--text-disabled)' };
const _hs107 = { padding: 12, color: 'var(--state-danger)', fontSize: 13 };
const _hs108 = { padding: 24, textAlign: 'center', color: 'var(--text-disabled)', fontSize: 13, border: '1px dashed var(--border-default)', borderRadius: 6 };
const _hs109 = { maxHeight: 320, overflow: 'auto', border: '1px solid var(--border-default)', borderRadius: 6 };
const _hs110 = { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderBottom: '1px solid var(--border-default)' };
const _hs111 = { flex: 1, minWidth: 0 };
const _hs112 = { fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 };
const _hs113 = { background: 'var(--bg-subtle)', padding: '1px 6px', borderRadius: 3, fontFamily: 'monospace' };
const _hs114 = { fontSize: 10, color: 'var(--text-disabled)', textTransform: 'uppercase', fontWeight: 700, background: 'var(--bg-subtle)', padding: '1px 6px', borderRadius: 3 };
const _hs115 = { fontSize: 11, color: 'var(--text-muted)', marginTop: 2 };
const _hs116 = { fontSize: 11, color: 'var(--state-danger)', marginTop: 3 };
const _hs117 = { fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 };
const _hs118 = { fontSize: 11, color: 'var(--text-muted)', marginTop: -10, marginBottom: 8 };
const _hs119 = { color: 'var(--state-danger)', fontSize: 12, marginBottom: 10 };

function CacheScheduleModal({ modal, runningIds, onClose, onCreate, onToggle, onDelete, onRunNow }) {
  const { report, schedules, loading, error } = modal;
  const [editing, setEditing] = useState(false);
  return (
    <div style={actionModalBackdrop} onClick={onClose}>
      <div style={{ ...actionModalCard, minWidth: 520, maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ ...actionModalTitle, marginBottom: 14 }}>Schedule refresh — {report.title}</div>

        {!editing && (
          <>
            {loading ? (
              <div style={_hs106}>Loading...</div>
            ) : error ? (
              <div style={_hs107}>{error}</div>
            ) : schedules.length === 0 ? (
              <div style={_hs108}>
                No schedules yet for this report.
              </div>
            ) : (
              <div style={_hs109}>
                {schedules.map((s) => {
                  const isRunning = runningIds.has(s.id);
                  const human = formatCronHuman(s.cron_expression);
                  const isHuman = human !== s.cron_expression;
                  return (
                    <div key={s.id} style={_hs110}>
                      <div style={_hs111}>
                        <div style={_hs112}>
                          {isHuman
                            ? <span>{human}</span>
                            : <code style={_hs113}>{s.cron_expression}</code>}
                          {!s.enabled && (
                            <span style={_hs114}>paused</span>
                          )}
                        </div>
                        <div style={_hs115}>
                          {s.timezone}
                          {s.last_run_at && (
                            <span style={{ color: s.last_run_status === 'error' ? 'var(--state-danger)' : 'var(--text-muted)' }}>
                              {' · last run '}{new Date(s.last_run_at).toLocaleString()}{s.last_run_status === 'error' ? ' (error)' : ''}
                            </span>
                          )}
                        </div>
                        {s.last_run_status === 'error' && s.last_error && (
                          <div style={_hs116}>
                            {s.last_error}
                          </div>
                        )}
                      </div>
                      {(() => {
                        const sendBtn = cardActionBtn('accent');
                        return (
                          <button
                            title={isRunning ? 'Refreshing…' : 'Run now'}
                            onClick={() => onRunNow(s)}
                            disabled={isRunning}
                            {...sendBtn}
                            style={{ ...sendBtn.style, cursor: isRunning ? 'wait' : 'pointer', opacity: isRunning ? 0.7 : 1 }}
                          >
                            {isRunning
                              ? <TbLoader2 size={14} className="spin" />
                              : <TbPlayerPlay size={14} />}
                          </button>
                        );
                      })()}
                      <button title={s.enabled ? 'Pause' : 'Resume'} onClick={() => onToggle(s)} {...cardActionBtn(s.enabled ? 'accent' : 'muted')}>
                        {s.enabled ? <TbToggleRight size={16} /> : <TbToggleLeft size={16} />}
                      </button>
                      <button title="Delete" onClick={() => onDelete(s)} {...cardActionBtn('danger')}>
                        <TbTrash size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            <div style={{ ...actionModalActions, justifyContent: 'space-between' }}>
              <button
                className="btn-hover btn-hover-primary"
                style={actionModalBtnPrimary}
                onClick={() => setEditing(true)}
              >
                + New schedule
              </button>
              <button className="btn-hover" style={actionModalBtnSecondary} onClick={onClose}>Close</button>
            </div>
          </>
        )}

        {editing && (
          <CacheScheduleEditor
            onCancel={() => setEditing(false)}
            onSubmit={async ({ cronExpression, timezone }) => {
              await onCreate({ cronExpression, timezone });
              setEditing(false);
            }}
          />
        )}
      </div>
    </div>
  );
}

function CacheScheduleEditor({ onCancel, onSubmit }) {
  const [time, setTime] = useState('09:00');
  const [tz, setTz] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState(null);
  const handleSubmit = async () => {
    if (!time) { setErr('Pick a time'); return; }
    setSubmitting(true);
    setErr(null);
    try {
      await onSubmit({ cronExpression: timeToCron(time), timezone: tz || 'UTC' });
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <div>
      <div style={_hs117}>
        New schedule
      </div>

      <label style={scheduleFieldLabel}>Run every day at</label>
      <input
        type="time"
        value={time}
        onChange={(e) => setTime(e.target.value)}
        style={{ ...actionModalInput, fontFamily: 'monospace', fontSize: 13 }}
      />
      <div style={_hs118}>
        For multiple runs in a day, create one schedule per time slot.
      </div>

      <label style={scheduleFieldLabel}>Timezone</label>
      <input list="cache-schedule-timezones" value={tz} onChange={(e) => setTz(e.target.value)}
        style={{ ...actionModalInput, fontFamily: 'monospace', fontSize: 12 }} />
      <datalist id="cache-schedule-timezones">
        {TIMEZONE_OPTIONS.map((tzn) => <option key={tzn} value={tzn} />)}
      </datalist>

      {err && <div style={_hs119}>{err}</div>}

      <div style={{ ...actionModalActions, justifyContent: 'space-between' }}>
        <button className="btn-hover" style={actionModalBtnSecondary} onClick={onCancel} disabled={submitting}>Cancel</button>
        <button className="btn-hover btn-hover-primary" style={actionModalBtnPrimary} onClick={handleSubmit} disabled={submitting}>
          {submitting ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

export default CacheScheduleModal;
