import { useState, useEffect } from 'react';
import { TbPlugConnected, TbCopy } from 'react-icons/tb';
import api from '../../utils/api';
import { toast } from '../Toast/toast';
import ConfirmDeleteButton from '../ConfirmDeleteButton/ConfirmDeleteButton';
import Paged from '../Pager/Paged';

// A user's own API tokens: mint, see, revoke. Shared between the standalone
// page every allowed user reaches from the account menu and the admin console,
// where it sits under the instance switch that governs it — one component so
// the two can never drift.
//
// Tokens are always personal. An admin looking at this in Admin › API sees
// their own list, not everyone's: a token acts as its owner, so there would be
// nothing meaningful to show or revoke on someone else's behalf.

const SCOPE_HELP = {
  read: 'List models and reports',
  refresh: 'Rebuild a model’s cache',
};

export default function ApiTokensPanel({ embedded = false }) {
  const [tokens, setTokens] = useState([]);
  const [enabled, setEnabled] = useState(true);
  const [canCreate, setCanCreate] = useState(false);
  const [minRole, setMinRole] = useState('admin');
  const [scopes, setScopes] = useState(['read', 'refresh']);
  const [name, setName] = useState('');
  const [expiresInDays, setExpiresInDays] = useState('');
  // The freshly minted token, shown once — the server keeps only a digest.
  const [minted, setMinted] = useState(null);

  const load = () => {
    api.get('/api-tokens')
      .then((res) => {
        setTokens(res.data.tokens || []);
        setEnabled(res.data.enabled);
        setCanCreate(res.data.canCreate);
        setMinRole(res.data.minRole);
      })
      .catch((err) => toast(err.response?.data?.error || 'Failed to load API tokens'));
  };
  useEffect(load, []);

  const toggleScope = (s) => setScopes((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  const create = async () => {
    try {
      const res = await api.post('/api-tokens', {
        name: name.trim(),
        scopes: scopes.join(','),
        expiresInDays: expiresInDays || undefined,
      });
      setMinted(res.data);
      setName('');
      setExpiresInDays('');
      load();
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to create the token');
    }
  };

  const revoke = async (t) => {
    try {
      await api.delete(`/api-tokens/${t.id}`);
      load();
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to revoke the token');
    }
  };

  const copy = async (value) => {
    try {
      await navigator.clipboard.writeText(value);
      toast('Token copied to the clipboard');
    } catch {
      // Clipboard access is denied outside a secure context; the token is on
      // screen and selectable, so there is nothing to recover from.
      toast('Copy failed — select the token and copy it manually');
    }
  };

  const isExpired = (t) => t.expires_at && new Date(`${t.expires_at}Z`) < new Date();

  return (
    <div style={embedded ? undefined : card}>
      {!embedded && (
        <h3 style={heading}>
          <TbPlugConnected size={16} color="var(--accent-primary)" /> API tokens
        </h3>
      )}
      <p style={intro}>
        For calling Open Report from a script. A token acts as you and reaches{' '}
        <code>/api/v1</code> only — refreshing a model&apos;s cache, listing what you can
        already see. It never grants more than your own account has.
      </p>

      {!enabled && (
        <div style={notice}>
          The API is switched off on this instance. Existing tokens are refused until
          an admin turns it back on.
        </div>
      )}
      {enabled && !canCreate && (
        <div style={notice}>
          Creating API tokens is limited to the <strong>{minRole}</strong> role and above
          on this instance.
        </div>
      )}

      {minted && (
        <div style={mintedBox}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
            Copy it now — this is the only time it is shown.
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <code style={mintedToken}>{minted.token}</code>
            <button onClick={() => copy(minted.token)} title="Copy token" style={iconBtn}>
              <TbCopy size={15} />
            </button>
            <button onClick={() => setMinted(null)} style={doneBtn}>Done</button>
          </div>
          <pre style={curl}>
            {`curl -X POST ${window.location.origin}/api/v1/models/<modelId>/refresh \\\n  -H "Authorization: Bearer ${minted.token}"`}
          </pre>
        </div>
      )}

      {canCreate && (
        <>
          <div style={formRow}>
            <input
              placeholder="Token name (e.g. nightly ETL)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{ ...input, flex: 1 }}
            />
            <input
              type="number" min="1" max="3650"
              placeholder="Expires in (days)"
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(e.target.value)}
              style={{ ...input, width: 150 }}
            />
            <button
              className="btn-hover btn-hover-primary"
              onClick={create}
              disabled={!name.trim() || scopes.length === 0}
              style={{ ...createBtn, opacity: !name.trim() || scopes.length === 0 ? 0.5 : 1 }}
            >
              Create
            </button>
          </div>
          <div style={scopeRow}>
            {Object.keys(SCOPE_HELP).map((s) => (
              <label key={s} style={scopeLabel}>
                <input type="checkbox" checked={scopes.includes(s)} onChange={() => toggleScope(s)} />
                <code style={{ fontSize: 12, color: 'var(--text-primary)' }}>{s}</code>
                <span>{SCOPE_HELP[s]}</span>
              </label>
            ))}
          </div>
        </>
      )}

      {tokens.length === 0 ? (
        <div style={empty}>No API tokens yet.</div>
      ) : (
        <div style={list}>
          <Paged items={tokens} pageSize={20}>{(page) => page.map((t) => {
            const dead = !!t.revoked_at || isExpired(t);
            return (
              <div key={t.id} style={{ ...row, opacity: dead ? 0.55 : 1 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={rowName}>
                    {t.name}
                    <code style={{ fontSize: 11, color: 'var(--text-muted)' }}>…{t.token_hint}</code>
                    {t.revoked_at && <span style={deadTag}>revoked</span>}
                    {!t.revoked_at && isExpired(t) && <span style={deadTag}>expired</span>}
                  </div>
                  <div style={rowMeta}>
                    {t.scopes.split(',').join(' · ')}
                    {t.expires_at ? ` · expires ${t.expires_at}` : ''}
                    {t.last_used_at ? ` · last used ${t.last_used_at}` : ' · never used'}
                  </div>
                </div>
                {!dead && <ConfirmDeleteButton variant="icon" label="Revoke token" onConfirm={() => revoke(t)} />}
              </div>
            );
          })}</Paged>
        </div>
      )}
    </div>
  );
}

const card = { backgroundColor: 'var(--bg-panel)', padding: 20, borderRadius: 8, border: '1px solid var(--border-default)', marginBottom: 20 };
const heading = { fontSize: 14, fontWeight: 600, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 };
const intro = { fontSize: 11, color: 'var(--text-muted)', margin: '0 0 16px' };
const notice = { fontSize: 12, color: 'var(--text-secondary)', background: 'var(--bg-subtle)', border: '1px solid var(--border-default)', borderRadius: 6, padding: '8px 12px', marginBottom: 16 };
const mintedBox = { border: '1px solid var(--state-success)', background: 'var(--state-success-soft)', borderRadius: 6, padding: 12, marginBottom: 16 };
const mintedToken = { flex: 1, fontSize: 12, wordBreak: 'break-all', background: 'var(--bg-subtle)', padding: '6px 8px', borderRadius: 4 };
const iconBtn = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '6px 8px', borderRadius: 6, cursor: 'pointer', background: 'var(--bg-panel)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' };
const doneBtn = { padding: '6px 10px', fontSize: 12, borderRadius: 6, cursor: 'pointer', background: 'var(--bg-panel)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' };
const curl = { margin: '10px 0 0', fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' };
const input = { padding: '8px 10px', border: '1px solid var(--border-default)', borderRadius: 6, fontSize: 13, outline: 'none', boxSizing: 'border-box' };
const createBtn = { padding: '8px 16px', fontSize: 13, fontWeight: 500, borderRadius: 6, cursor: 'pointer', border: 'none', background: 'var(--accent-primary)', color: '#fff' };
const formRow = { display: 'flex', gap: 10, marginBottom: 14 };
const scopeRow = { display: 'flex', gap: 16, marginBottom: 18, flexWrap: 'wrap' };
const scopeLabel = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' };
const empty = { fontSize: 11, color: 'var(--text-disabled)' };
const list = { display: 'flex', flexDirection: 'column', gap: 8 };
const row = { display: 'flex', alignItems: 'center', gap: 10, border: '1px solid var(--border-default)', borderRadius: 6, padding: '8px 12px' };
const rowName = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600 };
const rowMeta = { fontSize: 11, color: 'var(--text-disabled)' };
const deadTag = { fontSize: 11, color: 'var(--state-danger)' };
