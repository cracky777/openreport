import { useState, useEffect } from 'react';
import { TbRoute } from 'react-icons/tb';
import api from '../../utils/api';
import { toast } from '../../components/Toast/toast';

// The data catalog the assistant may read to answer "where does this number
// come from?" (OpenMetadata, server side: utils/openMetadata). Off by
// default: switched on, the catalog's metadata reaches the AI provider. The
// token goes in and never comes back, like a provider's key.

const sub = { fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: 8 };
const divider = { height: 1, background: 'var(--border-default)', margin: '14px 0' };
const row = { display: 'flex', alignItems: 'center', gap: 12 };
const rowText = { flex: 1 };
const rowLabel = { fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' };
const rowHint = { fontSize: 11, color: 'var(--text-muted)', margin: 0 };
const input = { padding: '8px 10px', border: '1px solid var(--border-default)', borderRadius: 6, fontSize: 13, outline: 'none', boxSizing: 'border-box', width: 320 };
const toggle = { padding: '7px 16px', fontSize: 13, fontWeight: 600, borderRadius: 6, cursor: 'pointer', minWidth: 100, background: 'var(--bg-subtle)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' };
const toggleOn = { background: 'var(--state-success-soft)', border: '1px solid var(--state-success)', color: 'var(--state-success)' };
const actions = { display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-end' };
const primaryBtn = { padding: '8px 16px', fontSize: 13, fontWeight: 600, border: 'none', borderRadius: 6, background: 'var(--accent-primary)', color: '#fff', cursor: 'pointer' };
const secondaryBtn = { padding: '8px 16px', fontSize: 13, background: 'var(--bg-panel)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)', borderRadius: 6, cursor: 'pointer' };
const linkBtn = { background: 'none', border: 'none', padding: 0, fontSize: 11, color: 'var(--accent-primary)', cursor: 'pointer' };
const warning = { margin: '6px 0 0', fontSize: 11, color: 'var(--state-warning, #b45309)' };
const result = (ok) => ({ fontSize: 12, color: ok ? 'var(--state-success)' : 'var(--state-danger)', flex: 1 });

/** @param {{ endpoints: { settings: string, save: string, test: string } }} props */
export default function OpenMetadataSettings({ endpoints }) {
  const [form, setForm] = useState({ enabled: false, url: '', service: 'openreport' });
  const [hasToken, setHasToken] = useState(false);
  const [tokenError, setTokenError] = useState(null);
  const [changed, setChanged] = useState(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState(null);

  const load = (om) => {
    if (!om) return;
    setForm({ enabled: om.enabled, url: om.url, service: om.service });
    setHasToken(om.hasToken);
    setTokenError(om.tokenError);
    setChanged(om.changedAt ? { at: om.changedAt, by: om.changedBy } : null);
    setToken('');
  };

  useEffect(() => {
    api.get(endpoints.settings).then((res) => load(res.data.openMetadata)).catch(() => { /* the page shows its own error */ });
  }, [endpoints]);

  const set = (patch) => { setForm((f) => ({ ...f, ...patch })); setTest(null); };

  const save = async (patch = {}) => {
    setBusy(true);
    try {
      const res = await api.put(endpoints.save, { ...form, ...patch, ...(token.trim() ? { token: token.trim() } : {}) });
      load(res.data.openMetadata);
      toast('OpenMetadata settings saved', 'success');
      return true;
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to save the OpenMetadata settings');
      return false;
    } finally {
      setBusy(false);
    }
  };

  // Against the SAVED link, as for the provider.
  const runTest = async () => {
    setTest(null);
    if (!(await save({ enabled: form.enabled }))) return;
    setBusy(true);
    try {
      setTest((await api.post(endpoints.test)).data);
    } catch (err) {
      setTest({ ok: false, error: err.response?.data?.error || 'The test failed' });
    } finally {
      setBusy(false);
    }
  };

  const testMessage = test && (test.ok ? `Connected as ${test.account || 'an unnamed account'}.` : test.error);

  return (
    <div>
      <h4 style={sub}><TbRoute size={15} color="var(--accent-primary)" /> Data catalog — OpenMetadata</h4>
      <div style={row}>
        <div style={rowText}>
          <div style={rowLabel}>Explain where figures come from</div>
          <p style={rowHint}>
            Lets the assistant answer &quot;where does this number come from?&quot; from OpenMetadata: a field&apos;s
            calculation, then the tables, ETL rules, SQL, pipelines and sources upstream. Switched on, the metadata of
            OpenMetadata (table names, SQL, calculation rules) is sent to the configured AI provider. Never a row of data;
            nothing is ever written to OpenMetadata.
          </p>
          {changed && <p style={rowHint}>Switched {form.enabled ? 'on' : 'off'} {changed.by ? `by ${changed.by} ` : ''}on {new Date(changed.at).toLocaleString()}.</p>}
        </div>
        <button onClick={() => save({ enabled: !form.enabled })} aria-pressed={form.enabled} disabled={busy}
          style={{ ...toggle, ...(form.enabled ? toggleOn : null) }}>
          {form.enabled ? 'Enabled' : 'Disabled'}
        </button>
      </div>

      <div style={divider} />
      <div style={row}>
        <div style={rowText}>
          <div style={rowLabel}>OpenMetadata URL</div>
          <p style={rowHint}>Called from the server. Its MCP server is expected at /mcp.</p>
        </div>
        <input value={form.url} onChange={(e) => set({ url: e.target.value })} placeholder="http://localhost:8585" style={input} spellCheck={false} />
      </div>

      <div style={divider} />
      <div style={row}>
        <div style={rowText}>
          <div style={rowLabel}>Bot token</div>
          <p style={rowHint}>
            The token of a read-only bot (OpenMetadata › Settings › Bots). Stored encrypted and never shown again; leave
            empty to keep the current one.{' '}
            {hasToken && <button style={linkBtn} onClick={() => save({ clearToken: true, enabled: false })}>Remove the stored token</button>}
          </p>
          {tokenError && <p style={warning}>{tokenError}</p>}
        </div>
        <input type="password" value={token} onChange={(e) => { setToken(e.target.value); setTest(null); }}
          placeholder={hasToken ? 'Configured — leave empty to keep' : 'No token stored'} style={input} autoComplete="new-password" />
      </div>

      <div style={divider} />
      <div style={row}>
        <div style={rowText}>
          <div style={rowLabel}>Open Report service name</div>
          <p style={rowHint}>The name of the Open Report dashboard service in OpenMetadata, as its connector created it.</p>
        </div>
        <input value={form.service} onChange={(e) => set({ service: e.target.value })} placeholder="openreport" style={input} spellCheck={false} />
      </div>

      <div style={divider} />
      <div style={actions}>
        {testMessage && (
          <span style={result(test.ok && !test.isAdmin)}>
            {testMessage}
            {test.ok && test.isAdmin && ' This account is an OpenMetadata admin: give the assistant a read-only bot instead.'}
          </span>
        )}
        <button style={secondaryBtn} onClick={runTest} disabled={busy}>Save &amp; test</button>
        <button style={primaryBtn} onClick={() => save()} disabled={busy}>Save</button>
      </div>
    </div>
  );
}
