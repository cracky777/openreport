import { useState } from 'react';
import { TbLoader2, TbPencil, TbPlayerPlay, TbToggleLeft, TbToggleRight, TbTrash } from 'react-icons/tb';
import { TIMEZONE_OPTIONS, timeToCron, cronToTime, formatCronHuman } from '../../utils/scheduleHelpers';
import { scheduleFieldLabel, actionModalBackdrop, actionModalCard, actionModalTitle, actionModalInput, actionModalActions, actionModalBtnSecondary, actionModalBtnPrimary, cardActionBtn } from '../dashboardModalStyles';

const _hs120 = { color: 'var(--text-muted)' };
const _hs121 = { fontWeight: 600 };
const _hs122 = { padding: 20, textAlign: 'center', color: 'var(--text-disabled)' };
const _hs123 = { padding: 12, color: 'var(--state-danger)', fontSize: 13 };
const _hs124 = { padding: 24, textAlign: 'center', color: 'var(--text-disabled)', fontSize: 13, border: '1px dashed var(--border-default)', borderRadius: 6 };
const _hs125 = { maxHeight: 320, overflow: 'auto', border: '1px solid var(--border-default)', borderRadius: 6 };
const _hs126 = { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderBottom: '1px solid var(--border-default)' };
const _hs127 = { flex: 1, minWidth: 0 };
const _hs128 = { fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 };
const _hs129 = { fontSize: 10, color: 'var(--text-disabled)', textTransform: 'uppercase', fontWeight: 700, background: 'var(--bg-subtle)', padding: '1px 6px', borderRadius: 3 };
const _hs130 = { fontSize: 11, color: 'var(--text-muted)', marginTop: 2 };
const _hs131 = { background: 'var(--bg-subtle)', padding: '1px 5px', borderRadius: 3 };
const _hs132 = { fontSize: 11, color: 'var(--state-danger)', marginTop: 3 };
const _hs133 = { animation: 'spin 0.9s linear infinite' };
const _hs134 = { fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 };
const _hs135 = { fontSize: 11, color: 'var(--text-muted)', marginTop: -10, marginBottom: 8 };
const _hs136 = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 };
const _hs137 = { background: 'transparent', border: '1px solid var(--border-default)', borderRadius: 4, padding: '6px 10px', fontSize: 11, color: 'var(--text-secondary)', cursor: 'pointer', whiteSpace: 'nowrap' };
const _hs138 = { fontSize: 11, color: 'var(--text-muted)', marginTop: -10, marginBottom: 12 };
const _hs139 = { fontSize: 11, color: 'var(--text-muted)', marginTop: -2, marginBottom: 12 };
const _hs140 = { fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 };
const _hs141 = { color: 'var(--state-danger)', fontSize: 12, marginBottom: 10 };
const _hs142 = { marginBottom: 6 };
const _hs143 = {
          fontSize: 12, color: 'var(--text-muted)', padding: '10px 12px',
          border: '1px dashed var(--border-default)', borderRadius: 6, marginBottom: 6,
        };
const _hs144 = {
          border: '1px solid var(--border-default)', borderRadius: 6,
          padding: 10, marginBottom: 6, background: 'var(--bg-subtle)',
        };
const _hs145 = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 };
const _hs146 = { background: 'transparent', border: '1px solid var(--border-default)', borderRadius: 4, padding: '4px 8px', fontSize: 11, color: 'var(--state-danger)', cursor: 'pointer' };
const _hs147 = { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 };
const _hs148 = { fontSize: 12, color: 'var(--text-muted)' };
const _hs149 = { background: 'transparent', border: '1px solid transparent', color: 'var(--text-disabled)', fontSize: 16, cursor: 'pointer', padding: '0 6px', borderRadius: 4 };
const _hs150 = { background: 'transparent', border: '1px dashed var(--border-default)', borderRadius: 4, padding: '4px 10px', fontSize: 11, color: 'var(--text-secondary)', cursor: 'pointer', marginTop: 4 };

function ScheduleModal({ modal, runningIds, onClose, onStartCreate, onStartEdit, onCancelEdit, onSubmit, onToggle, onDelete, onRunNow }) {
  const { report, schedules, loading, error, editing, limits, dimensions } = modal;
  const isEditing = editing === 'new' || (editing && typeof editing === 'object');
  const atQuota = !!(limits && limits.maxSchedules != null && (limits.currentSchedules ?? schedules.length) >= limits.maxSchedules);
  return (
    <div style={actionModalBackdrop} onClick={onClose}>
      <div style={{ ...actionModalCard, minWidth: 520, maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ ...actionModalTitle, marginBottom: 14 }}>Email schedule — {report.title}</div>
        {limits && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
            padding: '8px 12px', marginBottom: 12, fontSize: 12,
            background: atQuota ? 'var(--state-warning-soft)' : 'var(--bg-subtle)',
            border: `1px solid ${atQuota ? 'var(--state-warning)' : 'var(--border-default)'}`,
            borderRadius: 6,
            color: atQuota ? 'var(--state-warning)' : 'var(--text-secondary)',
          }}>
            <span>
              <strong>{limits.planName || limits.plan} plan</strong>
              {limits.maxSchedules != null
                ? ` — ${limits.currentSchedules ?? schedules.length}/${limits.maxSchedules} schedule${limits.maxSchedules === 1 ? '' : 's'} used`
                : ' — unlimited schedules'}
              {limits.maxFiresPerDay != null && (
                <span style={_hs120}>{` · max ${limits.maxFiresPerDay} send${limits.maxFiresPerDay === 1 ? '' : 's'}/day per schedule`}</span>
              )}
            </span>
            {atQuota && <span style={_hs121}>Quota reached</span>}
          </div>
        )}

        {!isEditing && (
          <>
            {loading ? (
              <div style={_hs122}>Loading...</div>
            ) : error ? (
              <div style={_hs123}>{error}</div>
            ) : schedules.length === 0 ? (
              <div style={_hs124}>
                No schedules yet for this report.
              </div>
            ) : (
              <div style={_hs125}>
                {schedules.map((s) => (
                  <div key={s.id} style={_hs126}>
                    <div style={_hs127}>
                      <div style={_hs128}>
                        {s.name}
                        {!s.enabled && (
                          <span style={_hs129}>paused</span>
                        )}
                      </div>
                      <div style={_hs130}>
                        {(() => {
                          const human = formatCronHuman(s.cron_expression);
                          return human !== s.cron_expression
                            ? <span>{human}</span>
                            : <code style={_hs131}>{s.cron_expression}</code>;
                        })()}
                        {' · '}
                        {s.recipients.length} recipient{s.recipients.length === 1 ? '' : 's'}
                        {s.last_run_at && (
                          <span style={{ color: s.last_run_status === 'error' ? 'var(--state-danger)' : 'var(--text-muted)' }}>
                            {' · last run '}{new Date(s.last_run_at).toLocaleString()}{s.last_run_status === 'error' ? ' (error)' : ''}
                          </span>
                        )}
                      </div>
                      {s.last_run_status === 'error' && s.last_error && (
                        <div style={_hs132}>
                          {s.last_error}
                        </div>
                      )}
                    </div>
                    {(() => {
                      const isRunning = !!(runningIds && runningIds.has(s.id));
                      const sendBtn = cardActionBtn('accent');
                      return (
                        <button
                          title={isRunning ? 'Sending…' : 'Send now'}
                          onClick={() => onRunNow(s)}
                          disabled={isRunning}
                          {...sendBtn}
                          style={{ ...sendBtn.style, cursor: isRunning ? 'wait' : 'pointer', opacity: isRunning ? 0.7 : 1 }}
                        >
                          {isRunning
                            ? <TbLoader2 size={14} style={_hs133} />
                            : <TbPlayerPlay size={14} />}
                        </button>
                      );
                    })()}
                    <button title={s.enabled ? 'Pause' : 'Resume'} onClick={() => onToggle(s)} {...cardActionBtn(s.enabled ? 'accent' : 'muted')}>
                      {s.enabled ? <TbToggleRight size={16} /> : <TbToggleLeft size={16} />}
                    </button>
                    <button title="Edit" onClick={() => onStartEdit(s)} {...cardActionBtn()}>
                      <TbPencil size={14} />
                    </button>
                    <button title="Delete" onClick={() => onDelete(s)} {...cardActionBtn('danger')}>
                      <TbTrash size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div style={{ ...actionModalActions, justifyContent: 'space-between' }}>
              <button
                className="btn-hover btn-hover-primary"
                style={atQuota ? { ...actionModalBtnPrimary, opacity: 0.5, cursor: 'not-allowed' } : actionModalBtnPrimary}
                onClick={onStartCreate}
                disabled={atQuota}
                title={atQuota ? 'Schedule quota reached for your plan' : ''}
              >
                + New schedule
              </button>
              <button className="btn-hover" style={actionModalBtnSecondary} onClick={onClose}>Close</button>
            </div>
          </>
        )}

        {isEditing && (
          <ScheduleEditor
            initial={editing === 'new' ? null : editing}
            limits={limits}
            dimensions={dimensions || []}
            onCancel={onCancelEdit}
            onSubmit={onSubmit}
          />
        )}
      </div>
    </div>
  );
}

function ScheduleEditor({ initial, dimensions, onCancel, onSubmit }) {
  const isEdit = !!initial;
  const [form, setForm] = useState(() => ({
    id: initial?.id || null,
    name: initial?.name || '',
    cronExpression: initial?.cron_expression || '0 9 * * 1',
    timezone: initial?.timezone || (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'),
    subject: initial?.subject || '',
    body: initial?.body || '',
    recipientsRaw: (initial?.recipients || []).map((r) => r.email).join(', '),
    enabled: initial?.enabled !== false,
    refreshTimeoutSeconds: initial?.refresh_timeout_seconds ?? 60,
    perRecipientRender: !!initial?.per_recipient_render,
    recipientRules: Array.isArray(initial?.recipient_rules) ? initial.recipient_rules : [],
  }));
  // Seed the time picker from the existing cron when it parses as a daily
  // HH:MM. Falls back to 09:00 for new schedules or for non-daily crons.
  const [time, setTime] = useState(cronToTime(initial?.cron_expression) || '09:00');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState(null);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const handleSubmit = async () => {
    if (!form.name.trim() || !form.subject.trim()) {
      setErr('Name and subject are required');
      return;
    }
    if (!time) {
      setErr('Pick a time');
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      await onSubmit({ ...form, cronExpression: timeToCron(time) });
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div style={_hs134}>
        {isEdit ? 'Edit schedule' : 'New schedule'}
      </div>

      <label style={scheduleFieldLabel}>Name</label>
      <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Weekly sales digest" style={actionModalInput} />

      <label style={scheduleFieldLabel}>Run every day at</label>
      <input
        type="time"
        value={time}
        onChange={(e) => setTime(e.target.value)}
        style={{ ...actionModalInput, fontFamily: 'monospace', fontSize: 13 }}
      />
      <div style={_hs135}>
        For multiple sends in a day, create one schedule per time slot.
      </div>

      <label style={scheduleFieldLabel}>Timezone</label>
      <div style={_hs136}>
        <input
          list="schedule-timezones"
          value={form.timezone}
          onChange={(e) => set('timezone', e.target.value)}
          placeholder="Europe/Paris"
          style={{ ...actionModalInput, marginBottom: 0, fontFamily: 'monospace', fontSize: 12, flex: 1 }}
        />
        <button
          type="button"
          className="btn-hover"
          onClick={() => set('timezone', Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')}
          style={_hs137}
          title="Use my browser's timezone"
        >
          Use browser TZ
        </button>
        <datalist id="schedule-timezones">
          {TIMEZONE_OPTIONS.map((tz) => <option key={tz} value={tz} />)}
        </datalist>
      </div>

      <label style={scheduleFieldLabel}>Recipients (comma- or newline-separated)</label>
      <textarea
        value={form.recipientsRaw}
        onChange={(e) => set('recipientsRaw', e.target.value)}
        placeholder="alice@example.com, bob@example.com"
        rows={3}
        style={{ ...actionModalInput, resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
      />

      <label style={scheduleFieldLabel}>Subject</label>
      <input value={form.subject} onChange={(e) => set('subject', e.target.value)} placeholder="Weekly sales report" style={actionModalInput} />

      <label style={scheduleFieldLabel}>Message (optional)</label>
      <textarea
        value={form.body}
        onChange={(e) => set('body', e.target.value)}
        placeholder="Here's the sales report for the week."
        rows={3}
        style={{ ...actionModalInput, resize: 'vertical' }}
      />

      <label style={scheduleFieldLabel}>Refresh timeout (seconds)</label>
      <input
        type="number"
        min={30}
        max={600}
        value={form.refreshTimeoutSeconds}
        onChange={(e) => set('refreshTimeoutSeconds', e.target.value)}
        style={actionModalInput}
      />
      <div style={_hs138}>
        Maximum time the renderer waits for the report to refresh before generating the PDF. Bump this if you have slow queries (default 60s, range 30–600s). The renderer also forces an explicit refresh on top of the initial load.
      </div>

      <label style={scheduleFieldLabel}>Per-recipient filter rules</label>
      <RecipientRulesEditor
        rules={form.recipientRules || []}
        dimensions={dimensions || []}
        onChange={(next) => set('recipientRules', next)}
      />
      <div style={_hs139}>
        Optional. Each rule maps an email pattern (e.g. <code>*@paris.fr</code>) to filter overrides applied to the rendered PDF. Rules are evaluated in order; the first match wins. Recipients matching no rule receive the unfiltered report.
      </div>

      <label style={{ ...scheduleFieldLabel, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <input
          type="checkbox"
          checked={form.perRecipientRender}
          onChange={(e) => set('perRecipientRender', e.target.checked)}
        />
        <span>Apply per-user data permissions (RLS)</span>
      </label>
      <div style={_hs140}>
        When enabled, each recipient who is a member of this organization receives a PDF rendered under their own permissions. Recipients without an account fall back to the schedule creator's view.
      </div>

      <label style={{ ...scheduleFieldLabel, display: 'flex', alignItems: 'center', gap: 6 }}>
        <input type="checkbox" checked={form.enabled} onChange={(e) => set('enabled', e.target.checked)} />
        <span>Enabled</span>
      </label>

      {err && <div style={_hs141}>{err}</div>}

      <div style={actionModalActions}>
        <button className="btn-hover" style={actionModalBtnSecondary} onClick={onCancel} disabled={submitting}>Cancel</button>
        <button className="btn-hover btn-hover-primary" style={actionModalBtnPrimary} onClick={handleSubmit} disabled={submitting}>
          {submitting ? 'Saving…' : (isEdit ? 'Save' : 'Create')}
        </button>
      </div>
    </div>
  );
}

function RecipientRulesEditor({ rules, dimensions, onChange }) {
  // One shared datalist for all column inputs across all rules — no need
  // to namespace per row since they all draw from the same dimension list.
  const datalistId = 'recipient-rule-dimensions';
  const updateRule = (idx, patch) => {
    const next = rules.slice();
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };
  const removeRule = (idx) => onChange(rules.filter((_, i) => i !== idx));
  const addRule = () => onChange([...rules, { pattern: '', filters: {} }]);

  const setFilterColAt = (ruleIdx, oldCol, newCol) => {
    const next = rules.slice();
    const cur = { ...(next[ruleIdx].filters || {}) };
    const vals = cur[oldCol];
    delete cur[oldCol];
    if (newCol) cur[newCol] = vals || '';
    next[ruleIdx] = { ...next[ruleIdx], filters: cur };
    onChange(next);
  };
  const setFilterValAt = (ruleIdx, col, val) => {
    const next = rules.slice();
    const cur = { ...(next[ruleIdx].filters || {}) };
    cur[col] = val;
    next[ruleIdx] = { ...next[ruleIdx], filters: cur };
    onChange(next);
  };
  const removeFilterAt = (ruleIdx, col) => {
    const next = rules.slice();
    const cur = { ...(next[ruleIdx].filters || {}) };
    delete cur[col];
    next[ruleIdx] = { ...next[ruleIdx], filters: cur };
    onChange(next);
  };
  const addFilterTo = (ruleIdx) => {
    const next = rules.slice();
    const cur = { ...(next[ruleIdx].filters || {}) };
    let i = 1;
    while (cur[`column${i}`] !== undefined) i += 1;
    cur[`column${i}`] = '';
    next[ruleIdx] = { ...next[ruleIdx], filters: cur };
    onChange(next);
  };

  return (
    <div style={_hs142}>
      {Array.isArray(dimensions) && dimensions.length > 0 && (
        <datalist id={datalistId}>
          {dimensions.map((d) => <option key={d} value={d} />)}
        </datalist>
      )}
      {rules.length === 0 && (
        <div style={_hs143}>
          No rules. All recipients receive the unfiltered report.
        </div>
      )}
      {rules.map((rule, ri) => (
        <div key={ri} style={_hs144}>
          <div style={_hs145}>
            <input
              value={rule.pattern || ''}
              onChange={(e) => updateRule(ri, { pattern: e.target.value })}
              placeholder="*@paris.fr  or  alice@example.com"
              style={{ ...actionModalInput, marginBottom: 0, flex: 1, fontFamily: 'monospace', fontSize: 12 }}
            />
            <button
              type="button"
              className="btn-hover btn-hover-danger"
              onClick={() => removeRule(ri)}
              style={_hs146}
              title="Remove rule"
            >
              Remove
            </button>
          </div>
          {Object.entries(rule.filters || {}).map(([col, vals], fi) => (
            <div key={fi} style={_hs147}>
              <input
                value={col}
                onChange={(e) => setFilterColAt(ri, col, e.target.value)}
                placeholder={dimensions && dimensions.length > 0 ? 'pick a dimension' : 'column'}
                list={dimensions && dimensions.length > 0 ? datalistId : undefined}
                style={{ ...actionModalInput, marginBottom: 0, flex: '0 0 40%', fontFamily: 'monospace', fontSize: 12 }}
              />
              <span style={_hs148}>=</span>
              <input
                value={Array.isArray(vals) ? vals.join(', ') : vals || ''}
                onChange={(e) => setFilterValAt(ri, col, e.target.value)}
                placeholder="value1, value2"
                style={{ ...actionModalInput, marginBottom: 0, flex: 1, fontFamily: 'monospace', fontSize: 12 }}
              />
              <button
                type="button"
                className="btn-hover btn-hover-danger"
                onClick={() => removeFilterAt(ri, col)}
                style={_hs149}
                title="Remove filter"
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn-hover btn-hover-accent"
            onClick={() => addFilterTo(ri)}
            style={_hs150}
          >
            + Add filter
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn-hover btn-hover-accent"
        onClick={addRule}
        style={{ ...actionModalBtnSecondary, padding: '6px 12px', fontSize: 12 }}
      >
        + Add rule
      </button>
    </div>
  );
}

export default ScheduleModal;
