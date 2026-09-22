import { useState, useEffect } from 'react';
import api from '../../utils/api';
import { toast } from '../../components/Toast/toast';
import Paged from '../../components/Pager/Paged';

const headLabel = { fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' };
const hint = { fontSize: 11, color: 'var(--text-muted)', margin: '2px 0 10px' };
const PAGE_SIZE = 10;
const toolsRow = { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8, flexWrap: 'wrap' };
const searchInput = { flex: 1, minWidth: 180, padding: '7px 10px', fontSize: 13, border: '1px solid var(--border-default)', borderRadius: 6, outline: 'none', boxSizing: 'border-box', background: 'var(--bg-panel)', color: 'var(--text-primary)' };
const onlyLabel = { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer', userSelect: 'none' };
const list = { display: 'flex', flexDirection: 'column', border: '1px solid var(--border-default)', borderRadius: 6 };
const emptyRow = { padding: '14px 10px', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' };
const item = { display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderBottom: '1px solid var(--border-subtle)' };
const who = { flex: 1, minWidth: 0, fontSize: 13, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const role = { fontSize: 11, color: 'var(--text-muted)', marginLeft: 6 };
const toggle = { padding: '4px 12px', fontSize: 12, fontWeight: 600, borderRadius: 6, cursor: 'pointer', minWidth: 110 };
const allowed = { ...toggle, background: 'var(--state-success-soft)', border: '1px solid var(--state-success)', color: 'var(--state-success)' };
const refused = { ...toggle, background: 'var(--bg-subtle)', border: '1px solid var(--border-default)', color: 'var(--text-muted)' };

// Everyone who can edit a report has the assistant; this is where an admin
// takes it away from an account. A refusal holds whatever provider the account
// would bring itself: it means no assistant, not "not on our bill".
export default function AiAccessList({ endpoints }) {
  const [users, setUsers] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [search, setSearch] = useState('');
  const [refusedOnly, setRefusedOnly] = useState(false);

  useEffect(() => {
    api.get(endpoints.users)
      .then((res) => setUsers(res.data.users || []))
      .catch(() => { /* admin gate handled by the page's users fetch */ });
  }, [endpoints]);

  const flip = async (user) => {
    setBusyId(user.id);
    try {
      const { data } = await api.put(endpoints.access(user.id), { denied: !user.aiDenied });
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, aiDenied: data.aiDenied } : u)));
    } catch (err) {
      toast(err.response?.data?.error || 'Could not change this account\'s access');
    } finally {
      setBusyId(null);
    }
  };

  // Name, e-mail or role: on a long list an admin looks someone up, or wants
  // the short list of accounts the assistant was taken away from.
  const needle = search.trim().toLowerCase();
  const refusedCount = users.filter((u) => u.aiDenied).length;
  const shown = users.filter((u) => (!refusedOnly || u.aiDenied)
    && (!needle || [u.display_name, u.email, u.role].some((v) => String(v || '').toLowerCase().includes(needle))));

  return (
    <div>
      <div style={headLabel}>Who has the assistant</div>
      <p style={hint}>
        Everyone who can edit a report has it. Take it away from an account here: that account then has
        no assistant at all, not even with an AI provider of its own.
      </p>
      <div style={toolsRow}>
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search a user by name, e-mail or role…"
          aria-label="Search a user" style={searchInput} spellCheck={false} />
        <label style={onlyLabel}>
          <input type="checkbox" checked={refusedOnly} onChange={(e) => setRefusedOnly(e.target.checked)} />
          Without access only ({refusedCount})
        </label>
      </div>
      {/* Back to page 1 whenever the question changes: page 4 of another search is nowhere. */}
      <Paged items={shown} pageSize={PAGE_SIZE} resetKey={`${needle}|${refusedOnly}`}>{(pageUsers) => (
      <div style={list}>
        {pageUsers.length === 0 && <div style={emptyRow}>{users.length ? 'No account matches' : 'No account yet'}</div>}
        {pageUsers.map((u) => (
          <div key={u.id} style={item}>
            <span style={who} title={u.email}>{u.display_name || u.email}<span style={role}>{u.role}</span></span>
            <button style={u.aiDenied ? refused : allowed} onClick={() => flip(u)} disabled={busyId === u.id}
              aria-pressed={!u.aiDenied} aria-label={`AI assistant for ${u.display_name || u.email}`}>
              {u.aiDenied ? 'No assistant' : 'Has access'}
            </button>
          </div>
        ))}
      </div>
      )}</Paged>
    </div>
  );
}
