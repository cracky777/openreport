import { useState, useEffect } from 'react';
import { TbChartDots, TbDownload } from 'react-icons/tb';
import api from '../../utils/api';
import { toast } from '../../components/Toast/toast';

// The anonymous daily ping (server: utils/telemetry.js) and the update check it
// brings back. The admin sees the exact payload before deciding: the promise is
// "this and nothing else", so the page shows "this".

const RELEASES_URL = 'https://github.com/cracky777/openreport/releases/latest';

const card = { backgroundColor: 'var(--bg-panel)', padding: 20, borderRadius: 8, border: '1px solid var(--border-default)', marginBottom: 20 };
const title = { fontSize: 14, fontWeight: 600, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 };
const row = { display: 'flex', alignItems: 'center', gap: 12 };
const rowText = { flex: 1 };
const rowLabel = { fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' };
const rowHint = { fontSize: 11, color: 'var(--text-muted)', margin: 0 };
const toggle = { padding: '7px 16px', fontSize: 13, fontWeight: 600, borderRadius: 6, cursor: 'pointer', minWidth: 100, background: 'var(--bg-subtle)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' };
const toggleOn = { background: 'var(--state-success-soft)', border: '1px solid var(--state-success)', color: 'var(--state-success)' };
const payloadBox = { margin: '12px 0 0', padding: 10, fontSize: 11, lineHeight: 1.5, background: 'var(--bg-subtle)', border: '1px solid var(--border-default)', borderRadius: 6, color: 'var(--text-secondary)', overflowX: 'auto' };
const update = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, padding: '10px 12px', borderRadius: 6, fontSize: 13, background: 'var(--accent-primary-soft)', border: '1px solid var(--accent-primary-border)', color: 'var(--accent-primary-text)' };
const link = { color: 'inherit', fontWeight: 600 };

export default function TelemetrySection() {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/admin/telemetry').then((res) => setState(res.data)).catch(() => { /* the page shows its own error */ });
  }, []);

  // Our hosted editions never ping: nothing for their admins to decide.
  if (!state || state.forcedOff === 'hosted') return null;
  const locked = !!state.forcedOff;

  const save = async () => {
    setBusy(true);
    try {
      const res = await api.put('/admin/telemetry', { enabled: !state.enabled });
      setState(res.data);
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to update the usage statistics setting');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={card}>
      <h3 style={title}>
        <TbChartDots size={16} color="var(--accent-primary)" /> Usage statistics and updates
      </h3>
      {state.updateAvailable && (
        <div style={update} role="status">
          <TbDownload size={16} />
          <span>
            Open Report {state.latest} is available (this instance runs {state.current}).{' '}
            <a href={RELEASES_URL} target="_blank" rel="noopener noreferrer" style={link}>What&apos;s new</a>
          </span>
        </div>
      )}
      <div style={row}>
        <div style={rowText}>
          <div style={rowLabel}>Send anonymous usage statistics</div>
          <p style={rowHint}>
            {locked
              ? 'Turned off by this instance’s configuration (OPENREPORT_TELEMETRY=0).'
              : 'Once a day, this instance tells openreport.io that it exists and gets back the latest version, so this page can tell you when an update is out. It helps us know how many installations there are and which databases to support first. Exactly this is sent, nothing else: no names, addresses, tables or data.'}
          </p>
        </div>
        <button
          onClick={save}
          disabled={busy || locked}
          aria-pressed={state.enabled}
          style={{ ...toggle, ...(state.enabled ? toggleOn : null), ...(locked ? { opacity: 0.5, cursor: 'default' } : null) }}
        >
          {state.enabled ? 'Enabled' : 'Disabled'}
        </button>
      </div>
      {!locked && <pre style={payloadBox}>{JSON.stringify(state.sent, null, 2)}</pre>}
    </div>
  );
}
