import { useId } from 'react';

// The Build stages' icons (steps.js), the Build side, the account and the
// workspaces, drawn like the assistant's robot head (../RobotHead) and the
// Chat's first cards (AiPanel/WayIcons): soft gradient shapes, white panels,
// the charts' colours.

function useGradientId(name) {
  // useId gives ":r0:"; a colon breaks url(#…) in a fill.
  return `${name}-${useId().replace(/:/g, '')}`;
}

function Gradient({ id, from, to }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={from} /><stop offset="1" stopColor={to} /></linearGradient>
  );
}

const svgStyle = { flexShrink: 0 };

export function SourcesIcon({ size = 18 }) {
  const body = useGradientId('stage-source');
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" style={svgStyle}>
      <defs><Gradient id={body} from="#C8AAFF" to="#9469F5" /></defs>
      <path d="M10 15 V49 A22 8 0 0 0 54 49 V15 Z" fill={`url(#${body})`} />
      <ellipse cx="32" cy="15" rx="22" ry="8" fill="#EDE4FF" />
      <path d="M10 27 A22 8 0 0 0 54 27 M10 38 A22 8 0 0 0 54 38" stroke="#FFFFFF" strokeWidth="3" fill="none" />
      <circle cx="45" cy="33" r="2.5" fill="#FFFFFF" />
      <circle cx="45" cy="44" r="2.5" fill="#F7B382" />
    </svg>
  );
}

// Three layers, as the old stack: the model stands between sources and reports.
export function ModelsIcon({ size = 18 }) {
  const top = useGradientId('stage-model-top');
  const mid = useGradientId('stage-model-mid');
  const low = useGradientId('stage-model-low');
  const layer = (dy) => `M32 ${6 + dy} L57 ${19 + dy} L32 ${32 + dy} L7 ${19 + dy} Z`;
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" style={svgStyle}>
      <defs>
        <Gradient id={top} from="#F9C79B" to="#F2967A" />
        <Gradient id={mid} from="#F49AB8" to="#EE6F86" />
        <Gradient id={low} from="#B07CC2" to="#8C4F8F" />
      </defs>
      <path d={layer(24)} fill={`url(#${low})`} stroke="#FFFFFF" strokeWidth="2.5" strokeLinejoin="round" />
      <path d={layer(12)} fill={`url(#${mid})`} stroke="#FFFFFF" strokeWidth="2.5" strokeLinejoin="round" />
      <path d={layer(0)} fill={`url(#${top})`} stroke="#FFFFFF" strokeWidth="2.5" strokeLinejoin="round" />
      <ellipse cx="32" cy="19" rx="8" ry="4" fill="#FFFFFF" opacity="0.7" />
    </svg>
  );
}

// A bar chart alone, each bar in its own gradient.
export function ReportsIcon({ size = 18 }) {
  const a = useGradientId('stage-report-a');
  const b = useGradientId('stage-report-b');
  const c = useGradientId('stage-report-c');
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" style={svgStyle}>
      <defs>
        <Gradient id={a} from="#B07CC2" to="#8C4F8F" />
        <Gradient id={b} from="#F49AB8" to="#EE6F86" />
        <Gradient id={c} from="#F9C79B" to="#F2967A" />
      </defs>
      <rect x="6" y="34" width="14" height="24" rx="4" fill={`url(#${a})`} />
      <rect x="25" y="18" width="14" height="40" rx="4" fill={`url(#${b})`} />
      <rect x="44" y="6" width="14" height="52" rx="4" fill={`url(#${c})`} />
    </svg>
  );
}

// The Build side (the Chat's bar back to it): building blocks, four tiles of a
// page laid out by hand.
export function BuildIcon({ size = 18 }) {
  const a = useGradientId('build-a');
  const b = useGradientId('build-b');
  const c = useGradientId('build-c');
  const d = useGradientId('build-d');
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" style={svgStyle}>
      <defs>
        <Gradient id={a} from="#C8AAFF" to="#9469F5" />
        <Gradient id={b} from="#F49AB8" to="#EE6F86" />
        <Gradient id={c} from="#F9C79B" to="#F2967A" />
        <Gradient id={d} from="#B07CC2" to="#8C4F8F" />
      </defs>
      <rect x="6" y="6" width="24" height="30" rx="7" fill={`url(#${a})`} />
      <rect x="34" y="6" width="24" height="18" rx="7" fill={`url(#${b})`} />
      <rect x="6" y="40" width="24" height="18" rx="7" fill={`url(#${c})`} />
      <rect x="34" y="28" width="24" height="30" rx="7" fill={`url(#${d})`} />
    </svg>
  );
}

// The account: a bust in the robot's lavender, the head in the peach of the charts.
export function UserIcon({ size = 18 }) {
  const body = useGradientId('user-body');
  const head = useGradientId('user-head');
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" style={svgStyle}>
      <defs>
        <Gradient id={body} from="#C8AAFF" to="#9469F5" />
        <Gradient id={head} from="#F9C79B" to="#F2967A" />
      </defs>
      <path d="M8 58 C8 44 18 36 32 36 C46 36 56 44 56 58 Z" fill={`url(#${body})`} />
      <circle cx="32" cy="20" r="13" fill={`url(#${head})`} stroke="#FFFFFF" strokeWidth="3" />
    </svg>
  );
}

// A workspace: a folder, its back in the pink of the charts, its front in peach;
// `plus` adds the round badge of the Chat's "Create a report" for a new one.
export function WorkspaceIcon({ size = 18, plus = false }) {
  const back = useGradientId('ws-back');
  const front = useGradientId('ws-front');
  const badge = useGradientId('ws-badge');
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" style={svgStyle}>
      <defs>
        <Gradient id={back} from="#F49AB8" to="#C2407A" />
        <Gradient id={front} from="#F9C79B" to="#F2967A" />
        <Gradient id={badge} from="#C8AAFF" to="#9469F5" />
      </defs>
      <path d="M6 16 a8 8 0 0 1 8 -8 h12 l7 7 h17 a8 8 0 0 1 8 8 v26 a8 8 0 0 1 -8 8 h-36 a8 8 0 0 1 -8 -8 Z" fill={`url(#${back})`} />
      <rect x="17" y="18" width="30" height="10" rx="3" fill="#FFFFFF" opacity="0.85" />
      <rect x="6" y="25" width="52" height="32" rx="8" fill={`url(#${front})`} stroke="#FFFFFF" strokeWidth="2.5" />
      {plus && (
        <>
          <circle cx="48" cy="48" r="13" fill={`url(#${badge})`} stroke="#FFFFFF" strokeWidth="2.5" />
          <path d="M48 42 V54 M42 48 H54" stroke="#FFFFFF" strokeWidth="3.5" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}
