import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { TbArrowLeft, TbBell, TbRefresh, TbLoader2, TbPlayerPause, TbPlayerPlay } from 'react-icons/tb';
import api from '../utils/api';
import { toast } from '../components/Toast/toast';
import Modal from '../components/Modal/Modal';
import { EditIcon, ICON_SIZE } from '../components/actionIcons';
import { cardActionBtn } from '../components/dashboardModalStyles';
import ConfirmDeleteButton from '../components/ConfirmDeleteButton/ConfirmDeleteButton';
import FilterRulesEditor, { buildDefaultFilterRule } from '../components/FilterRulesEditor/FilterRulesEditor';

// Threshold alerts: watch one measure of a model on a cadence and notify
// on state transitions (webhook + in-app history). The page is a flat
// list — an alert is a standalone object, not a child of a report.

const OPS = [
  { value: 'gt', label: '>' }, { value: 'gte', label: '>=' },
  { value: 'lt', label: '<' }, { value: 'lte', label: '<=' },
  { value: 'eq', label: '=' }, { value: 'neq', label: '!=' },
];
const CADENCES = [
  { value: '*/5 * * * *', label: 'Every 5 minutes' },
  { value: '*/15 * * * *', label: 'Every 15 minutes' },
  { value: '0 * * * *', label: 'Every hour' },
  { value: '0 */6 * * *', label: 'Every 6 hours' },
  { value: '0 8 * * *', label: 'Every day at 08:00' },
];
const STATE_BADGES = {
  ok: { label: 'OK', color: 'var(--state-success)', bg: 'var(--state-success-soft)' },
  triggered: { label: 'Triggered', color: 'var(--state-danger)', bg: 'var(--state-danger-soft)' },
  error: { label: 'Error', color: '#b45309', bg: '#fef3c7' },
};

const EMPTY_FORM = {
  name: '', modelId: '', measureName: '', op: 'gt', threshold: '',
  cronExpression: '*/15 * * * *', webhookUrl: '', notifyOnRecover: true,
  widgetFilters: [],
};

export default function Alerts() {
  const navigate = useNavigate();
  // Arriving from a report card's "Alerts…" menu scopes the page to that
  // report's model and pre-picks it in the create form.
  const [searchParams, setSearchParams] = useSearchParams();
  const focusModelId = searchParams.get('modelId') || null;
  const [alerts, setAlerts] = useState([]);
  const [models, setModels] = useState([]);
  const [modelDetail, setModelDetail] = useState(null); // measures of the form's model
  const [editing, setEditing] = useState(null); // null | 'new' | alert id
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [runningIds, setRunningIds] = useState(() => new Set());
  const [eventsFor, setEventsFor] = useState(null); // { alert, events }

  const load = useCallback(async () => {
    try {
      const [a, m] = await Promise.all([api.get('/alerts'), api.get('/models')]);
      setAlerts(a.data.alerts || []);
      setModels(m.data.models || []);
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to load alerts');
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // The measure picker needs the chosen model's measure list.
  useEffect(() => {
    if (!form.modelId) { setModelDetail(null); return; }
    let stale = false;
    api.get(`/models/${form.modelId}`)
      .then((res) => { if (!stale) setModelDetail(res.data.model); })
      .catch(() => { /* picker just stays empty */ });
    return () => { stale = true; };
  }, [form.modelId]);

  const openCreate = () => { setForm({ ...EMPTY_FORM, modelId: focusModelId || '' }); setEditing('new'); };
  const openEdit = (a) => {
    setForm({
      name: a.name, modelId: a.model_id, measureName: a.measure_name,
      op: a.op, threshold: String(a.threshold), cronExpression: a.cron_expression,
      webhookUrl: a.webhook_url || '', notifyOnRecover: a.notify_on_recover,
      widgetFilters: Array.isArray(a.widget_filters) ? a.widget_filters : [],
    });
    setEditing(a.id);
  };

  const save = async () => {
    setSaving(true);
    try {
      const body = {
        name: form.name, modelId: form.modelId, measureName: form.measureName,
        op: form.op, threshold: Number(form.threshold), cronExpression: form.cronExpression,
        webhookUrl: form.webhookUrl || null, notifyOnRecover: form.notifyOnRecover,
        widgetFilters: form.widgetFilters,
      };
      if (editing === 'new') await api.post('/alerts', body);
      else await api.put(`/alerts/${editing}`, body);
      setEditing(null);
      toast(editing === 'new' ? 'Alert created' : 'Alert updated', 'success');
      load();
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to save the alert');
    } finally {
      setSaving(false);
    }
  };

  const runNow = async (a) => {
    if (runningIds.has(a.id)) return;
    setRunningIds((p) => new Set(p).add(a.id));
    try {
      const res = await api.post(`/alerts/${a.id}/run`);
      const r = res.data.result || {};
      if (r.skipped) toast('Alert is disabled — enable it first');
      else toast(`Checked — value ${r.value ?? '∅'}, state ${r.state}${r.notified ? ', webhook sent' : ''}`,
        r.state === 'error' ? undefined : 'success');
      load();
    } catch (err) {
      toast(err.response?.data?.error || 'Run failed');
    } finally {
      setRunningIds((p) => { const n = new Set(p); n.delete(a.id); return n; });
    }
  };

  const toggleEnabled = async (a) => {
    try {
      await api.put(`/alerts/${a.id}`, { enabled: !a.enabled });
      load();
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to update');
    }
  };

  const remove = async (a) => {
    try {
      await api.delete(`/alerts/${a.id}`);
      load();
    } catch (err) {
      toast(err.response?.data?.error || 'Delete failed');
    }
  };

  const showEvents = async (a) => {
    try {
      const res = await api.get(`/alerts/${a.id}/events`);
      setEventsFor({ alert: a, events: res.data.events || [] });
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to load history');
    }
  };

  const modelName = (id) => models.find((m) => m.id === id)?.name || id;
  const visibleAlerts = focusModelId ? alerts.filter((a) => a.model_id === focusModelId) : alerts;
  const opLabel = (op) => OPS.find((o) => o.value === op)?.label || op;
  const cadenceLabel = (expr) => CADENCES.find((c) => c.value === expr)?.label || expr;
  const measures = modelDetail?.measures || [];
  const formValid = form.name.trim() && form.modelId && form.measureName
    && form.threshold !== '' && Number.isFinite(Number(form.threshold));

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <button className="btn-hover" onClick={() => navigate('/')} style={backBtn}>
          <TbArrowLeft size={16} /> Back
        </button>
        <div style={titleStyle}><TbBell size={18} /> Alerts</div>
        <button className="btn-hover btn-hover-primary" onClick={openCreate} style={primaryBtn}>+ New Alert</button>
      </header>

      <main style={mainStyle}>
        {focusModelId && (
          <div style={crumbStyle}>
            Alerts on model &quot;{modelName(focusModelId)}&quot;
            <button onClick={() => setSearchParams({}, { replace: true })} style={linkBtn}>show all</button>
          </div>
        )}
        {visibleAlerts.length === 0 ? (
          <div style={emptyStyle}>
            No alerts yet. An alert checks one measure on a schedule and notifies
            you (webhook, plus the history here) when it crosses your threshold.
          </div>
        ) : (
          <div style={listStyle}>
            {visibleAlerts.map((a) => {
              const badge = STATE_BADGES[a.last_state] || { label: 'Never run', color: 'var(--text-muted)', bg: 'var(--bg-subtle)' };
              return (
                <div key={a.id} style={{ ...cardStyle, opacity: a.enabled ? 1 : 0.55 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={nameStyle}>{a.name}</span>
                      <span style={{ ...badgeStyle, color: badge.color, background: badge.bg }}>{badge.label}</span>
                      {!a.enabled && <span style={{ ...badgeStyle, color: 'var(--text-muted)', background: 'var(--bg-subtle)' }}>Paused</span>}
                    </div>
                    <div style={metaStyle}>
                      {modelName(a.model_id)} — {a.measure_name} {opLabel(a.op)} {a.threshold} · {cadenceLabel(a.cron_expression)}
                      {a.widget_filters?.length ? ` · ${a.widget_filters.length} filter${a.widget_filters.length > 1 ? 's' : ''}` : ''}
                      {a.webhook_url ? ' · webhook' : ''}
                    </div>
                    <div style={subMetaStyle}>
                      {a.last_checked_at
                        ? `Last check ${a.last_checked_at} — value ${a.last_value ?? '∅'}`
                        : 'Not checked yet'}
                      {a.last_state === 'error' && a.last_error ? ` — ${a.last_error}` : ''}
                      {' · '}
                      <button onClick={() => showEvents(a)} style={linkBtn}>history</button>
                    </div>
                  </div>
                  <div style={actionsStyle}>
                    <button
                      onClick={() => runNow(a)}
                      disabled={runningIds.has(a.id)}
                      title="Check now"
                      {...cardActionBtn(runningIds.has(a.id) ? 'accent' : 'muted')}
                    >
                      {runningIds.has(a.id) ? <TbLoader2 size={16} className="spin" /> : <TbRefresh size={16} />}
                    </button>
                    <button onClick={() => openEdit(a)} title="Edit alert" {...cardActionBtn()}>
                      <EditIcon size={ICON_SIZE.card} />
                    </button>
                    <button
                      onClick={() => toggleEnabled(a)}
                      title={a.enabled ? 'Pause this alert' : 'Resume this alert'}
                      {...cardActionBtn(a.enabled ? 'muted' : 'accent')}
                    >
                      {a.enabled ? <TbPlayerPause size={16} /> : <TbPlayerPlay size={16} />}
                    </button>
                    <ConfirmDeleteButton variant="icon" label="Delete alert" onConfirm={() => remove(a)} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {editing && (
        <Modal onClose={() => setEditing(null)} width={520}>
          <h2 style={modalTitle}>{editing === 'new' ? 'New Alert' : 'Edit Alert'}</h2>
          <label style={labelStyle}>Name</label>
          <input style={inputStyle} value={form.name} placeholder="Revenue below target"
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <label style={labelStyle}>Model</label>
          <select style={inputStyle} value={form.modelId}
            onChange={(e) => setForm({ ...form, modelId: e.target.value, measureName: '' })}>
            <option value="">— choose —</option>
            {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <label style={labelStyle}>Measure</label>
          <select style={inputStyle} value={form.measureName} disabled={!form.modelId}
            onChange={(e) => setForm({ ...form, measureName: e.target.value })}>
            <option value="">— choose —</option>
            {measures.map((m) => <option key={m.name} value={m.name}>{m.label || m.name}</option>)}
          </select>
          {/* Scope the measure: without filters the alert watches the grand
              total over ALL data, which is rarely the intent. One rule per
              dimension (country, product line, a date window...). */}
          <label style={labelStyle}>Filters (scope the measure — recommended)</label>
          <select
            style={inputStyle} value="" disabled={!modelDetail}
            onChange={(e) => {
              if (!e.target.value) return;
              setForm({
                ...form,
                widgetFilters: [...form.widgetFilters, buildDefaultFilterRule(modelDetail, e.target.value, false)],
              });
            }}
          >
            <option value="">+ Add a filter on…</option>
            {(modelDetail?.dimensions || []).map((d) => (
              <option key={d.name} value={d.name}>{d.label || d.name}</option>
            ))}
          </select>
          {form.widgetFilters.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <FilterRulesEditor
                model={modelDetail}
                modelId={form.modelId}
                rules={form.widgetFilters}
                onChange={(rules) => setForm({ ...form, widgetFilters: rules })}
                styles={{ inputStyle, cardStyle: ruleCardStyle, labelStyle: ruleLabelStyle }}
              />
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ width: 90 }}>
              <label style={labelStyle}>Condition</label>
              <select style={inputStyle} value={form.op} onChange={(e) => setForm({ ...form, op: e.target.value })}>
                {OPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Threshold</label>
              <input style={inputStyle} type="number" value={form.threshold}
                onChange={(e) => setForm({ ...form, threshold: e.target.value })} />
            </div>
          </div>
          <label style={labelStyle}>Check</label>
          <select style={inputStyle} value={form.cronExpression}
            onChange={(e) => setForm({ ...form, cronExpression: e.target.value })}>
            {CADENCES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <label style={labelStyle}>Webhook URL (optional — Slack/Teams/Discord compatible)</label>
          <input style={inputStyle} value={form.webhookUrl} placeholder="https://hooks.slack.com/services/…"
            onChange={(e) => setForm({ ...form, webhookUrl: e.target.value })} />
          <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
            <input type="checkbox" checked={form.notifyOnRecover}
              onChange={(e) => setForm({ ...form, notifyOnRecover: e.target.checked })} />
            Also notify when the value recovers
          </label>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button className="btn-hover" style={secondaryBtn} onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn-hover btn-hover-primary" style={primaryBtn}
              disabled={saving || !formValid} onClick={save}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </Modal>
      )}

      {eventsFor && (
        <Modal onClose={() => setEventsFor(null)} width={560}>
          <h2 style={modalTitle}>History — {eventsFor.alert.name}</h2>
          {eventsFor.events.length === 0 ? (
            <div style={emptyStyle}>No transitions yet — the history only records state changes.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: '55vh', overflowY: 'auto' }}>
              {eventsFor.events.map((e) => {
                const b = STATE_BADGES[e.state === 'recovered' ? 'ok' : e.state] || STATE_BADGES.error;
                return (
                  <div key={e.id} style={eventRow}>
                    <span style={{ ...badgeStyle, color: b.color, background: b.bg }}>{e.state}</span>
                    <span style={{ flex: 1 }}>
                      value {e.value ?? '∅'} / threshold {e.threshold}
                      {e.message ? ` — ${e.message}` : ''}
                    </span>
                    <span style={{ color: 'var(--text-disabled)', fontSize: 11 }}>{e.created_at}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

const pageStyle = { minHeight: '100vh', backgroundColor: 'var(--bg-app)' };
const headerStyle = {
  display: 'flex', alignItems: 'center', gap: 14, padding: '12px 24px',
  background: 'var(--bg-panel)', borderBottom: '1px solid var(--border-default)',
};
const backBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 10px', fontSize: 13,
  background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border-default)',
  borderRadius: 6, cursor: 'pointer',
};
const titleStyle = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 16, fontWeight: 600, flex: 1 };
const mainStyle = { maxWidth: 860, margin: '0 auto', padding: '24px 16px' };
const emptyStyle = { color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', marginTop: 40, lineHeight: 1.6 };
const listStyle = { display: 'flex', flexDirection: 'column', gap: 8 };
const crumbStyle = {
  display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-muted)',
  marginBottom: 12,
};
const cardStyle = {
  display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px',
  background: 'var(--bg-panel)', border: '1px solid var(--border-default)', borderRadius: 10,
};
const nameStyle = { fontWeight: 600, fontSize: 15, color: 'var(--text-primary)' };
const badgeStyle = { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', padding: '2px 7px', borderRadius: 10 };
const metaStyle = { fontSize: 13, color: 'var(--text-muted)', marginTop: 3 };
const subMetaStyle = { fontSize: 12, color: 'var(--text-disabled)', marginTop: 2 };
const linkBtn = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
  color: 'var(--accent-primary)', fontSize: 12, textDecoration: 'underline',
};
const actionsStyle = { display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 };
const eventRow = {
  display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: 'var(--text-secondary)',
  padding: '7px 10px', background: 'var(--bg-subtle)', borderRadius: 6,
};
const modalTitle = { fontSize: 16, fontWeight: 600, marginBottom: 14 };
const ruleCardStyle = {
  border: '1px solid var(--border-default)', borderRadius: 6, padding: '8px 10px',
  marginBottom: 6, background: 'var(--bg-subtle)',
};
const ruleLabelStyle = { display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 };
const labelStyle = { display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', margin: '10px 0 4px' };
const inputStyle = {
  width: '100%', padding: '8px 10px', border: '1px solid var(--border-default)', borderRadius: 6,
  fontSize: 13, outline: 'none', boxSizing: 'border-box', background: 'var(--bg-panel)', color: 'var(--text-primary)',
};
const primaryBtn = { padding: '8px 14px', fontSize: 13, fontWeight: 600, border: 'none', borderRadius: 6, background: 'var(--accent-primary)', color: '#fff', cursor: 'pointer' };
const secondaryBtn = { padding: '8px 14px', fontSize: 13, background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border-default)', borderRadius: 6, cursor: 'pointer' };
