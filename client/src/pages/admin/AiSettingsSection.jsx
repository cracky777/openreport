import { useState, useEffect } from 'react';
import { TbSparkles } from 'react-icons/tb';
import api from '../../utils/api';
import { toast } from '../../components/Toast/toast';
import { PRESETS, presetKeyFor } from '../../utils/aiProviderPresets';
import AiAccessList from './AiAccessList';
import AiFeedbackSection from './AiFeedbackSection';

const card = { backgroundColor: 'var(--bg-panel)', padding: 20, borderRadius: 8, border: '1px solid var(--border-default)', marginBottom: 20 };
const cardTitle = { fontSize: 14, fontWeight: 600, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 };
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
const pendingHint = { margin: '4px 0 0', fontSize: 11, color: 'var(--state-warning, #b45309)' };
const testResult = (ok) => ({ fontSize: 12, color: ok ? 'var(--state-success)' : 'var(--state-danger)', flex: 1 });
const note = { fontSize: 13, color: 'var(--text-muted)', margin: 0 };

// Where the settings live. The admin console sets up the instance; the cloud
// edition passes an organization's endpoints and reuses this very panel.
const INSTANCE_AI_ENDPOINTS = {
  settings: '/admin/settings',
  save: '/admin/settings/ai',
  test: '/admin/settings/ai/test',
  users: '/admin/users',
  access: (userId) => `/admin/users/${userId}/ai-access`,
  feedback: '/admin/ai/feedback',
};

/**
 * @param {{endpoints?: object, owner?: string}} props `owner` names whose
 *   provider it is in the copy: "the instance", "the organization".
 */
export default function AiSettingsSection({ endpoints = INSTANCE_AI_ENDPOINTS, owner = 'the instance' }) {
  // On by default, like the server: configuring a provider is what turns the
  // assistant on, there is no second step to forget.
  const [form, setForm] = useState({ enabled: true, provider: 'openai-compat', baseUrl: '', model: '', dataSharing: 'schema' });
  const [active, setActive] = useState(false);
  const [preset, setPreset] = useState('custom');
  const [hasApiKey, setHasApiKey] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState(null);
  // An edition that sets the assistant up per organization: nothing here to set.
  const [perOrganization, setPerOrganization] = useState(false);

  const load = (ai) => {
    setForm({ enabled: ai.enabled, provider: ai.provider, baseUrl: ai.baseUrl, model: ai.model, dataSharing: ai.dataSharing });
    setHasApiKey(ai.hasApiKey);
    setActive(!!ai.active);
    setPreset(ai.baseUrl ? presetKeyFor(ai) : 'custom');
    setApiKey('');
  };

  useEffect(() => {
    api.get(endpoints.settings)
      .then((res) => {
        if (res.data.aiPerOrganization) setPerOrganization(true);
        else if (res.data.ai) load(res.data.ai);
      })
      .catch(() => { /* admin gate handled by the page's users fetch */ });
  }, [endpoints]);

  const set = (patch) => { setForm((f) => ({ ...f, ...patch })); setTest(null); };

  const choosePreset = (key) => {
    const p = PRESETS.find((x) => x.key === key);
    setPreset(key);
    set({ provider: p.provider, baseUrl: p.baseUrl });
  };

  // An empty key field means "keep the stored one": the key is never sent
  // back to this page, so there is nothing to resubmit.
  const save = async (patch = {}) => {
    setBusy(true);
    try {
      const res = await api.put(endpoints.save, { ...form, ...patch, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) });
      load(res.data.ai);
      toast('AI settings saved', 'success');
      return true;
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to save the AI settings');
      return false;
    } finally {
      setBusy(false);
    }
  };

  // The test runs against the SAVED config, so save first: testing a form
  // that differs from what the assistant will use would prove nothing.
  const runTest = async () => {
    setTest(null);
    if (!(await save())) return;
    setBusy(true);
    try {
      const res = await api.post(endpoints.test);
      setTest(res.data);
    } catch (err) {
      setTest({ ok: false, error: err.response?.data?.error || 'The test failed' });
    } finally {
      setBusy(false);
    }
  };

  const testMessage = test && (test.ok
    ? (test.toolCalling
      ? 'Connected. The model supports tool calling.'
      : 'Connected, but this model did not call a tool: the assistant will not be able to propose visuals with it.')
    : test.error);

  if (perOrganization) {
    return (
      <div style={card}>
        <h3 style={cardTitle}><TbSparkles size={16} color="var(--accent-primary)" /> AI assistant</h3>
        <p style={note}>The AI assistant is set up by each organization: its admins choose the provider and who has it.</p>
      </div>
    );
  }

  return (
    <div style={card}>
      <h3 style={cardTitle}><TbSparkles size={16} color="var(--accent-primary)" /> AI assistant</h3>

      <div style={row}>
        <div style={rowText}>
          <div style={rowLabel}>Enable the assistant</div>
          <p style={rowHint}>
            Adds an assistant to the report editor. It proposes visuals and never changes a report
            by itself. It can only read a report&apos;s cached data, never the live data source.
            Without a provider below, each user may plug in their own, for their own use; switched off,
            nobody has the assistant.
          </p>
          {form.enabled && !active && <p style={pendingHint}>On, with no provider for {owner}: each user may plug in their own. Set one below to provide it to everyone.</p>}
        </div>
        <button onClick={() => save({ enabled: !form.enabled })} aria-pressed={form.enabled} disabled={busy}
          style={{ ...toggle, ...(form.enabled ? toggleOn : null) }}>
          {form.enabled ? 'Enabled' : 'Disabled'}
        </button>
      </div>

      <div style={divider} />
      <div style={row}>
        <div style={rowText}>
          <div style={rowLabel}>Provider</div>
          <p style={rowHint}>Anthropic natively, or any server that speaks the OpenAI chat-completions API.</p>
        </div>
        <select value={preset} onChange={(e) => choosePreset(e.target.value)} style={input}>
          {PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
      </div>

      <div style={divider} />
      <div style={row}>
        <div style={rowText}>
          <div style={rowLabel}>Base URL</div>
          <p style={rowHint}>Called from the server, not from the browser.</p>
        </div>
        <input value={form.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} placeholder="https://…" style={input} spellCheck={false} />
      </div>

      <div style={divider} />
      <div style={row}>
        <div style={rowText}>
          <div style={rowLabel}>Model</div>
          <p style={rowHint}>The exact name your provider's API expects, as listed in its models documentation — not the product name. It must support tool calling.</p>
        </div>
        <input value={form.model} onChange={(e) => set({ model: e.target.value })}
          placeholder={`e.g. ${PRESETS.find((p) => p.key === preset).modelExample}`} style={input} spellCheck={false} />
      </div>

      <div style={divider} />
      <div style={row}>
        <div style={rowText}>
          <div style={rowLabel}>API key</div>
          <p style={rowHint}>
            Stored encrypted and never shown again. Leave empty to keep the current key; local servers need none.{' '}
            {hasApiKey && <button style={linkBtn} onClick={() => save({ clearApiKey: true })}>Remove the stored key</button>}
          </p>
        </div>
        <input type="password" value={apiKey} onChange={(e) => { setApiKey(e.target.value); setTest(null); }}
          placeholder={hasApiKey ? 'Configured — leave empty to keep' : 'No key stored'} style={input} autoComplete="new-password" />
      </div>

      <div style={divider} />
      <div style={row}>
        <div style={rowText}>
          <div style={rowLabel}>What the assistant may send to the provider</div>
          <p style={rowHint}>
            Field names and labels are always sent. With cached data, aggregated rows from the report&apos;s
            cache are sent too, so the assistant can reason on actual figures — they leave this server.
          </p>
        </div>
        <select value={form.dataSharing} onChange={(e) => set({ dataSharing: e.target.value })} style={input}>
          <option value="schema">Schema only</option>
          <option value="schema+cache">Schema and cached data</option>
        </select>
      </div>

      <div style={divider} />
      <div style={actions}>
        {testMessage && <span style={testResult(test.ok && test.toolCalling)}>{testMessage}</span>}
        {active || form.baseUrl ? (
          <button style={linkBtn} onClick={() => save({ removeProvider: true })} disabled={busy}
            title={`Removes the provider and key of ${owner}. Each user may then plug in their own.`}>Remove provider</button>
        ) : null}
        <button style={secondaryBtn} onClick={runTest} disabled={busy}>Save &amp; test</button>
        <button style={primaryBtn} onClick={() => save()} disabled={busy}>Save</button>
      </div>

      <div style={divider} />
      <AiAccessList endpoints={endpoints} />
      <div style={divider} />
      <AiFeedbackSection endpoint={endpoints.feedback} />
    </div>
  );
}
