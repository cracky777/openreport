import { useState } from 'react';
import api from '../../utils/api';
import { toast } from '../Toast/toast';
import { PRESETS, presetKeyFor } from '../../utils/aiProviderPresets';

const formStyle = { display: 'flex', flexDirection: 'column', gap: 8 };
const headStyle = { fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' };
const labelStyle = { fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 };
const inputStyle = {
  width: '100%', boxSizing: 'border-box', padding: '7px 9px', fontSize: 12, color: 'var(--text-primary)',
  background: 'var(--bg-panel)', border: '1px solid var(--border-default)', borderRadius: 6, outline: 'none',
};
const actionsStyle = { display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center', marginTop: 2 };
const primaryBtn = {
  padding: '6px 12px', fontSize: 12, fontWeight: 600, border: 'none', borderRadius: 6,
  background: 'var(--accent-primary)', color: '#fff', cursor: 'pointer',
};
const quietBtn = {
  padding: '6px 10px', fontSize: 12, border: '1px solid var(--border-default)', borderRadius: 6,
  background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
};
const resultStyle = (ok) => ({ fontSize: 11, lineHeight: 1.4, color: ok ? 'var(--state-success)' : 'var(--state-danger)' });

// The user's OWN provider, for an instance that has none. Theirs alone: the key
// is stored encrypted on their account, serves their requests only and is never
// sent back to this form — an empty key field means "keep the one I saved".
export default function PersonalProvider({ personal, onSaved, onCancel }) {
  // A first visit opens on a preset, its URL already in the form.
  const [preset, setPreset] = useState(personal.baseUrl ? presetKeyFor(personal) : PRESETS[0].key);
  const [form, setForm] = useState(() => (personal.baseUrl
    ? { provider: personal.provider, baseUrl: personal.baseUrl, model: personal.model }
    : { provider: PRESETS[0].provider, baseUrl: PRESETS[0].baseUrl, model: '' }));
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const set = (patch) => { setForm((f) => ({ ...f, ...patch })); setResult(null); };
  const choosePreset = (key) => {
    const p = PRESETS.find((x) => x.key === key);
    setPreset(key);
    set({ provider: p.provider, baseUrl: p.baseUrl });
  };

  const saveAndTest = async () => {
    setBusy(true);
    setResult(null);
    try {
      await api.put('/ai/personal', { ...form, ...(apiKey.trim() ? { apiKey } : {}) });
      const { data } = await api.post('/ai/personal/test');
      if (!data.ok) {
        setResult({ ok: false, text: data.error || 'The provider could not be reached' });
      } else if (!data.toolCalling) {
        setResult({ ok: false, text: 'Connected, but this model did not call a tool: the assistant cannot propose anything with it. Try another model.' });
      } else {
        setApiKey('');
        onSaved();
      }
    } catch (err) {
      toast(err.response?.data?.error || 'Could not save your AI provider');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.delete('/ai/personal');
      onSaved();
    } catch (err) {
      toast(err.response?.data?.error || 'Could not remove your AI provider');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={formStyle}>
      <div style={headStyle}>Your AI provider</div>
      <div>
        <div style={labelStyle}>Provider</div>
        <select value={preset} onChange={(e) => choosePreset(e.target.value)} style={inputStyle}>
          {PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
      </div>
      <div>
        <div style={labelStyle}>Base URL</div>
        <input value={form.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} placeholder="https://…" style={inputStyle} spellCheck={false} />
      </div>
      <div>
        <div style={labelStyle}>Model</div>
        <input value={form.model} onChange={(e) => set({ model: e.target.value })}
          placeholder={`e.g. ${PRESETS.find((p) => p.key === preset).modelExample}`} style={inputStyle} spellCheck={false} />
      </div>
      <div>
        <div style={labelStyle}>API key</div>
        <input type="password" value={apiKey} onChange={(e) => { setApiKey(e.target.value); setResult(null); }}
          placeholder={personal.hasApiKey ? 'Saved — leave empty to keep it' : 'Your key'} style={inputStyle} autoComplete="new-password" />
      </div>
      {result && <div style={resultStyle(result.ok)}>{result.text}</div>}
      {personal.keyError && !result && <div style={resultStyle(false)}>{personal.keyError}</div>}
      <div style={actionsStyle}>
        {personal.baseUrl ? <button style={quietBtn} onClick={remove} disabled={busy}>Remove</button> : null}
        {onCancel ? <button style={quietBtn} onClick={onCancel} disabled={busy}>Cancel</button> : null}
        <button style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }} onClick={saveAndTest} disabled={busy || !form.baseUrl.trim() || !form.model.trim()}>
          {busy ? 'Testing…' : 'Save & test'}
        </button>
      </div>
    </div>
  );
}
