import { useId } from 'react';

// The icons of the Chat's first cards, drawn like the assistant's robot head
// (../RobotHead): a soft gradient shape, a white panel, the charts' colours,
// and a round badge for what the card does (create, go on).

function useGradientId(name) {
  // useId gives ":r0:"; a colon breaks url(#…) in a fill.
  return `${name}-${useId().replace(/:/g, '')}`;
}

function Page({ id, from, to }) {
  return (
    <>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={from} /><stop offset="1" stopColor={to} /></linearGradient>
      </defs>
      <rect x="6" y="5" width="40" height="52" rx="10" fill={`url(#${id})`} />
      <rect x="12" y="12" width="28" height="38" rx="6" fill="#FFFFFF" />
    </>
  );
}

export function CreateReportIcon({ size = 30 }) {
  const page = useGradientId('create-page');
  const badge = useGradientId('create-badge');
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" style={{ flexShrink: 0 }}>
      <Page id={page} from="#F49AB8" to="#C2407A" />
      <rect x="16" y="17" width="16" height="4" rx="2" fill="#F1D5DE" />
      <rect x="16" y="34" width="5" height="12" rx="1.5" fill="#8C4F8F" />
      <rect x="23" y="28" width="5" height="18" rx="1.5" fill="#EE6F86" />
      <rect x="30" y="24" width="5" height="22" rx="1.5" fill="#F7B382" />
      <defs>
        <linearGradient id={badge} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#F9C79B" /><stop offset="1" stopColor="#F2967A" /></linearGradient>
      </defs>
      <circle cx="48" cy="47" r="12" fill={`url(#${badge})`} stroke="#FFFFFF" strokeWidth="2.5" />
      <path d="M48 41 V53 M42 47 H54" stroke="#FFFFFF" strokeWidth="3.5" strokeLinecap="round" />
    </svg>
  );
}

export function ContinueReportIcon({ size = 30 }) {
  const page = useGradientId('continue-page');
  const badge = useGradientId('continue-badge');
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" style={{ flexShrink: 0 }}>
      <Page id={page} from="#F9C79B" to="#EE6F86" />
      <rect x="16" y="17" width="16" height="4" rx="2" fill="#F1D5DE" />
      <rect x="16" y="24" width="10" height="4" rx="2" fill="#F6E3EA" />
      <path d="M16 44 L22 37 L28 40 L35 31" stroke="#8C4F8F" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="35" cy="31" r="2.5" fill="#EE6F86" />
      <defs>
        <linearGradient id={badge} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#C8AAFF" /><stop offset="1" stopColor="#9469F5" /></linearGradient>
      </defs>
      <circle cx="48" cy="47" r="12" fill={`url(#${badge})`} stroke="#FFFFFF" strokeWidth="2.5" />
      <path d="M45 41.5 L53.5 47 L45 52.5 Z" fill="#FFFFFF" strokeLinejoin="round" />
    </svg>
  );
}
