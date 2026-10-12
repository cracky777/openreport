import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  TbFileCertificate, TbCalendarEvent, TbListNumbers, TbCircleCheck, TbAlertTriangle, TbStack2,
  TbLayoutDashboard, TbTable, TbChartCandle, TbUsers, TbScale, TbBook, TbArrowsLeftRight, TbArrowRight,
} from 'react-icons/tb';
import { PrimaryButton, SecondaryButton } from '../PageHeader/PageHeader';
import { applyFecPack, addFecYearsTo, booksName } from '../../utils/accountingPack';
import AccountMappingDialog from './AccountMappingDialog';

// The Finance package's own colours (server/utils/accounting/fecPack.js): the
// hero shows the report it builds, so it wears them in either app theme.
const PURPLE = '#9158d7';
const ORANGE = '#e2762e';
const LAVENDER = '#c9aaf5';

const hero = {
  margin: '-20px -20px 18px', padding: '22px 22px 20px', borderRadius: '10px 10px 0 0',
  background: 'linear-gradient(135deg, #200643 0%, #361468 55%, #532594 100%)',
  display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap',
};
const heroText = { flex: '1 1 240px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 };
const badge = {
  alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 999,
  fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase',
  color: '#fff', background: 'rgba(226, 118, 46, 0.9)',
};
const heroTitle = { margin: 0, fontSize: 24, fontWeight: 700, color: '#fff', letterSpacing: '-0.01em' };
const heroLead = { margin: 0, fontSize: 13, lineHeight: 1.5, color: '#e9ddfb' };
const illustration = { flex: '0 0 auto', width: 200, maxWidth: '100%', height: 'auto', display: 'block' };

const chips = { display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 };
const chip = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 8, fontSize: 12,
  background: 'var(--bg-subtle)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)',
};
const okChip = { ...chip, color: 'var(--state-success)', background: 'var(--state-success-soft)', borderColor: 'transparent' };
const badChip = { ...chip, color: 'var(--state-danger)', background: 'var(--state-danger-soft)', borderColor: 'var(--state-danger-border)' };
const warnChip = { ...chip, color: 'var(--state-warning)', background: 'var(--state-warning-soft)', borderColor: 'var(--state-warning-border)' };

const sectionLabel = { fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 };
const pagesGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 };
const pageTile = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, fontSize: 12.5,
  background: 'var(--bg-panel-alt)', border: '1px solid var(--border-default)', color: 'var(--text-primary)',
};
const pageIcon = { flexShrink: 0, color: PURPLE };
const mergeBox = {
  display: 'flex', gap: 12, alignItems: 'flex-start', padding: 12, borderRadius: 8,
  background: 'var(--accent-primary-soft)', border: '1px solid var(--accent-primary-border)', color: 'var(--text-primary)', fontSize: 13, lineHeight: 1.5,
};
const errorStyle = {
  marginTop: 12, padding: '8px 10px', borderRadius: 6, fontSize: 13,
  background: 'var(--state-danger-soft)', color: 'var(--state-danger)', border: '1px solid var(--state-danger-border)',
};
const actionsStyle = { display: 'flex', gap: 8, marginTop: 18, flexWrap: 'wrap', alignItems: 'center' };
const buttonIcon = { marginLeft: 6, verticalAlign: '-3px' };

const PAGES = [
  ['Overview', TbLayoutDashboard], ['Income statement', TbTable], ['Management balances', TbChartCandle],
  ['Customers & suppliers', TbUsers], ['Trial balance', TbScale], ['General ledger', TbBook],
];

const count = (v) => new Intl.NumberFormat('en-US').format(v || 0);
const plural = (n, word) => `${count(n)} ${word}${n > 1 ? 's' : ''}`;

// A miniature of the report the package builds: four cards, the monthly
// bars, the waterfall — drawn, not a screenshot, so it never goes stale.
function PackPreview() {
  const bars = [34, 28, 36, 31, 40, 30];
  const exp = [30, 33, 32, 37, 31, 34];
  const steps = [[0, 44, PURPLE], [22, 44, ORANGE], [0, 22, LAVENDER], [9, 22, ORANGE], [0, 9, LAVENDER]];
  return (
    <svg viewBox="0 0 200 128" style={illustration} role="img" aria-label="Preview of the Finance package report">
      <rect x="0" y="0" width="200" height="128" rx="10" fill="#111827" />
      {[0, 1, 2, 3].map((i) => (
        <g key={i}>
          <rect x={8 + i * 47} y="8" width="43" height="22" rx="4" fill="#1e293b" />
          <rect x={13 + i * 47} y="13" width="18" height="3" rx="1.5" fill="#64748b" />
          <rect x={13 + i * 47} y="20" width="28" height="5" rx="2" fill={i === 3 ? ORANGE : '#f1f5f9'} />
        </g>
      ))}
      <rect x="8" y="36" width="104" height="84" rx="4" fill="#1e293b" />
      {bars.map((b, i) => (
        <g key={i}>
          <rect x={15 + i * 16} y={112 - b * 1.6} width="6" height={b * 1.6} rx="1.5" fill={PURPLE} />
          <rect x={22 + i * 16} y={112 - exp[i] * 1.6} width="6" height={exp[i] * 1.6} rx="1.5" fill={ORANGE} />
        </g>
      ))}
      <rect x="118" y="36" width="74" height="84" rx="4" fill="#1e293b" />
      {steps.map(([from, to, c], i) => (
        <rect key={i} x={124 + i * 13} y={112 - to * 1.6} width="9" height={(to - from) * 1.6} rx="1.5" fill={c} />
      ))}
    </svg>
  );
}

// The offer that follows the import of books (FEC, SAF-T): the Finance package, a model and a
// ready-made report on these books. When the same company's other fiscal
// years are already in a source, it first offers to add these to it, so the
// years compare in one report. Nothing happens until the user says so.
// `onDecline`: what declining does, worded by `declineLabel` (a caller that
// was about to build a blank report says so). `onMerged(target)`: the books
// went into `target`, the source just imported is gone.
export default function FecPackOffer({ datasourceId, workspaceId, accounting, sameCompany = [], onDecline, onMerged, declineLabel = 'Not now' }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState(sameCompany.length ? 'merge' : 'pack');
  const [target, setTarget] = useState(null); // { id, name, years } once merged
  const [mapping, setMapping] = useState(false);
  const candidate = sameCompany[0];
  const a = accounting || {};
  const years = target?.years || (a.years?.length > 1 ? a.years : null);
  // Only what would make the figures doubtful is worth a chip.
  const issues = [
    a.unbalancedEntries > 0 && `${plural(a.unbalancedEntries, 'entry')} not balanced`,
    a.undatedLines > 0 && `${plural(a.undatedLines, 'line')} without a date`,
    a.unclassifiedAccounts?.length > 0 && `${plural(a.unclassifiedAccounts.length, 'account')} outside the chart of accounts`,
    // DATEV: bookings under a tax key the import does not split stay gross.
    a.unsplitTaxKeys?.length > 0 && `Tax keys ${a.unsplitTaxKeys.join(', ')} not split: amounts gross`,
  ].filter(Boolean);
  // The profit build-up is the French SIG only in French books (fecPack.js).
  const named = a.kind !== 'fec' ? PAGES.map((p) => (p[0] === 'Management balances' ? ['Profit build-up', p[1]] : p)) : PAGES;
  const pages = years ? [named[0], ['Year over year', TbArrowsLeftRight], ...named.slice(1)] : named;

  const run = async (work) => {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setBusy(false);
    }
  };
  const openPack = () => run(async () => {
    const reportId = await applyFecPack(target?.id || datasourceId, workspaceId);
    navigate(`/view/${reportId}`);
  });
  const merge = () => run(async () => {
    const res = await addFecYearsTo(candidate.id, datasourceId);
    const merged = { id: candidate.id, name: candidate.name, years: res.years.map((y) => y.year) };
    setTarget(merged);
    setStep('pack');
    onMerged?.(merged);
  });

  return (
    <div>
      <div style={hero}>
        <div style={heroText}>
          <span style={badge}><TbFileCertificate size={14} /> {booksName(a)} detected</span>
          <h2 style={heroTitle}>Finance package</h2>
          <p style={heroLead}>Your books, ready to read: the income statement, the management balances from revenue to net income, what customers owe and suppliers are owed.</p>
        </div>
        <PackPreview />
      </div>

      <div style={chips}>
        <span style={chip}>
          <TbCalendarEvent size={15} />
          {years ? `Fiscal years ${years.join(', ')}` : a.firstDate ? `${a.firstDate} → ${a.lastDate}` : 'One fiscal year'}
        </span>
        {!years && <span style={chip}><TbListNumbers size={15} /> {count(a.entries)} entries</span>}
        {a.balanced
          ? <span style={okChip}><TbCircleCheck size={15} /> Debits = credits</span>
          : <span style={badChip}><TbAlertTriangle size={15} /> Debits ≠ credits</span>}
        {issues.map((t) => <span key={t} style={warnChip}><TbAlertTriangle size={15} /> {t}</span>)}
        {a.unclassifiedAccounts?.length > 0 && (
          <button type="button" className="btn-hover" style={{ ...chip, cursor: 'pointer' }} onClick={() => setMapping(true)}
            title="Place the accounts the chart of accounts does not name on lines of the statements">
            Map the accounts…
          </button>
        )}
      </div>

      {step === 'merge' ? (
        <>
          <div style={mergeBox}>
            <TbStack2 size={22} style={{ flexShrink: 0, color: 'var(--accent-primary)' }} />
            <div>
              This company&apos;s books for <strong>{candidate.years.join(', ')}</strong> are already in <strong>{candidate.name}</strong>.
              Add these to it to compare the years in one report.
            </div>
          </div>
          {error && <div style={errorStyle}>{error}</div>}
          <div style={actionsStyle}>
            <PrimaryButton onClick={merge} disabled={busy}>
              {busy ? 'Adding…' : `Add to ${candidate.name}`}
            </PrimaryButton>
            <SecondaryButton onClick={() => setStep('pack')} disabled={busy}>Keep as a separate source</SecondaryButton>
          </div>
        </>
      ) : (
        <>
          <div style={sectionLabel}>{pages.length} pages, ready to open</div>
          <div style={pagesGrid}>
            {pages.map(([name, Icon]) => (
              <div key={name} style={pageTile}><Icon size={17} style={pageIcon} /> {name}</div>
            ))}
          </div>
          {error && <div style={errorStyle}>{error}</div>}
          <div style={actionsStyle}>
            <PrimaryButton onClick={openPack} disabled={busy}>
              {busy ? 'Creating…' : 'Open the Finance package'}
              {!busy && <TbArrowRight size={16} style={buttonIcon} />}
            </PrimaryButton>
            <SecondaryButton onClick={onDecline} disabled={busy}>{declineLabel}</SecondaryButton>
          </div>
        </>
      )}
      {mapping && <AccountMappingDialog datasourceId={target?.id || datasourceId} onClose={() => setMapping(false)} />}
    </div>
  );
}
