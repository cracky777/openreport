import { useEffect, useState } from 'react';
import { TbBug, TbX, TbChevronDown, TbChevronRight } from 'react-icons/tb';
import api from '../../utils/api';
import { toast } from '../Toast/toast';
import { submitBugReport } from '../../cloud';

/**
 * Report a bug.
 *
 * Two things decide this dialog's shape.
 *
 * First, a report is only worth what its context is worth. "The chart is
 * broken" costs an afternoon; the engine, the dialect and the error message
 * name the cause in minutes. So the technical context is gathered for the user
 * rather than asked of them.
 *
 * Second, that same context carries customer data — an error message names
 * tables, columns, and sometimes the filter values that produced it. It is
 * therefore SHOWN, in full, before anything is sent, and it can be dropped. No
 * one should discover after the fact what left their instance.
 *
 * Where it goes is the edition's business, not this component's: the cloud sets
 * `submitBugReport` and receives the report on its own endpoint; self-hosted
 * has no server to receive it, so it opens a pre-filled mail to the address an
 * administrator configured.
 */
export default function BugReportDialog({ context = {}, onClose }) {
  const [summary, setSummary] = useState('');
  const [details, setDetails] = useState('');
  const [includeContext, setIncludeContext] = useState(true);
  const [contextOpen, setContextOpen] = useState(false);
  // `undefined` = pas encore connue (le bouton reste inactif), `null` = aucune
  // adresse configurée. Les confondre ferait ouvrir un mailto sans destinataire.
  const [supportEmail, setSupportEmail] = useState(undefined);
  const [sending, setSending] = useState(false);

  // Le cloud reçoit les rapports lui-même : inutile d'aller chercher une adresse
  // dont il ne fera rien.
  useEffect(() => {
    if (submitBugReport) { setSupportEmail(null); return undefined; }
    let alive = true;
    api.get('/support')
      .then((res) => { if (alive) setSupportEmail(res.data?.email || null); })
      .catch(() => { if (alive) setSupportEmail(null); });
    return () => { alive = false; };
  }, []);

  const lines = Object.entries(context).filter(([, v]) => v != null && v !== '');
  const contextText = lines.map(([k, v]) => k + ': ' + v).join('\n');
  const missingAddress = !submitBugReport && supportEmail === null;

  const send = async () => {
    if (!summary.trim()) return;
    const attached = includeContext && contextText
      ? '\n--- Technical context ---\n' + contextText
      : '';
    const body = [details.trim(), attached].filter(Boolean).join('\n');
    setSending(true);
    try {
      if (submitBugReport) {
        await submitBugReport({
          summary: summary.trim(),
          details: body,
          context: includeContext ? context : {},
        });
        toast('Report sent. Thank you.', 'success');
      } else {
        // Certains clients mail tronquent un lien trop long sans le dire. Le
        // contexte est court par construction, mais on borne quand même.
        const href = 'mailto:' + supportEmail
          + '?subject=' + encodeURIComponent('[OpenReport] ' + summary.trim())
          + '&body=' + encodeURIComponent(body.slice(0, 1800));
        window.location.href = href;
      }
      onClose();
    } catch (err) {
      toast(err?.response?.data?.error || err?.message || 'Could not send the report');
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={backdrop} onClick={onClose}>
      <div style={panel} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Report a bug">
        <div style={header}>
          <span style={titleStyle}><TbBug size={17} /> Report a bug</span>
          <button onClick={onClose} style={closeBtn} aria-label="Close"><TbX size={16} /></button>
        </div>

        <label style={fieldLabel} htmlFor="bug-summary">What went wrong?</label>
        <input id="bug-summary" style={input} value={summary} autoFocus
          onChange={(e) => setSummary(e.target.value)}
          placeholder="The bars change order after I clear a filter" />

        <label style={fieldLabel} htmlFor="bug-details">What were you doing? (optional)</label>
        <textarea id="bug-details" style={textarea}
          value={details} onChange={(e) => setDetails(e.target.value)}
          placeholder="Steps, and what you expected instead." />

        {contextText && (
          <div style={contextBox}>
            <label style={contextToggleRow}>
              <input type="checkbox" checked={includeContext}
                onChange={(e) => setIncludeContext(e.target.checked)} />
              <span>Include technical context</span>
            </label>
            <button type="button" style={revealBtn} onClick={() => setContextOpen((v) => !v)}>
              {contextOpen ? <TbChevronDown size={13} /> : <TbChevronRight size={13} />}
              {contextOpen ? 'Hide what is sent' : 'See exactly what is sent'}
            </button>
            {contextOpen && <pre style={contextPre}>{contextText}</pre>}
          </div>
        )}

        {missingAddress && (
          <div style={warnBox}>
            No support address is configured on this instance. An administrator can set one
            in Admin, under Settings, before reports can be sent.
          </div>
        )}

        <div style={actions}>
          <button onClick={onClose} style={secondaryBtn}>Cancel</button>
          <button onClick={send} style={primaryBtn}
            disabled={sending || !summary.trim() || missingAddress || supportEmail === undefined}>
            {sending ? 'Sending...' : 'Send report'}
          </button>
        </div>
      </div>
    </div>
  );
}

const backdrop = {
  position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(15, 23, 42, 0.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
};
const panel = {
  width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto',
  background: 'var(--bg-panel)', color: 'var(--text-primary)',
  border: '1px solid var(--border-default)', borderRadius: 10, padding: 20,
  display: 'flex', flexDirection: 'column', gap: 0, boxShadow: 'var(--shadow-lg)',
};
const header = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 };
const titleStyle = { display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 15 };
const closeBtn = {
  background: 'transparent', border: 'none', cursor: 'pointer', padding: 4,
  color: 'var(--text-muted)', display: 'inline-flex',
};
const fieldLabel = {
  display: 'block', fontSize: 13, color: 'var(--text-secondary)',
  marginTop: 10, marginBottom: 4, fontWeight: 500,
};
const input = {
  width: '100%', padding: '8px 10px', borderRadius: 6, fontSize: 13, font: 'inherit',
  border: '1px solid var(--border-default)', background: 'var(--bg-panel)',
  color: 'var(--text-primary)', boxSizing: 'border-box',
};
const textarea = { ...input, minHeight: 84, resize: 'vertical' };
const contextBox = {
  marginTop: 12, padding: '10px 12px', borderRadius: 6,
  background: 'var(--bg-app)', border: '1px solid var(--border-subtle)',
  display: 'flex', flexDirection: 'column', gap: 6,
};
const contextToggleRow = {
  display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-secondary)',
};
const revealBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 4, background: 'transparent',
  border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', fontSize: 12,
  color: 'var(--accent-primary)', textAlign: 'left',
};
const contextPre = {
  margin: 0, padding: 8, borderRadius: 4, background: 'var(--bg-panel)',
  border: '1px solid var(--border-subtle)', fontSize: 11, lineHeight: 1.5,
  color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
  maxHeight: 160, overflowY: 'auto',
};
const warnBox = {
  marginTop: 12, padding: '9px 11px', borderRadius: 6, fontSize: 12, lineHeight: 1.45,
  background: 'var(--state-warning-soft)', color: 'var(--state-warning)',
  border: '1px solid var(--state-warning-border)',
};
const actions = { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 };
const secondaryBtn = {
  padding: '8px 14px', borderRadius: 6, fontSize: 13, cursor: 'pointer', font: 'inherit',
  border: '1px solid var(--border-default)', background: 'var(--bg-panel)', color: 'var(--text-primary)',
};
const primaryBtn = {
  padding: '8px 14px', borderRadius: 6, fontSize: 13, cursor: 'pointer', font: 'inherit',
  border: 'none', background: 'var(--accent-primary)', color: '#fff', fontWeight: 500,
};
