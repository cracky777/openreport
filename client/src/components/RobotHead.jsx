import { useId } from 'react';

// The assistant's face: the robot's head of the first-visit choice
// (Welcome/People), drawn in its own colours wherever the assistant is named —
// panels, bars, buttons. As an <svg> it nests in a bigger drawing too (x, y).
export default function RobotHead({ size = 18, x, y, style, title }) {
  // useId gives ":r0:"; a colon breaks url(#…) in a fill.
  const id = `robot-${useId().replace(/:/g, '')}`;
  return (
    <svg viewBox="-5 21 64 64" width={size} height={size} x={x} y={y} style={{ flexShrink: 0, ...style }}
      role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#C8AAFF" /><stop offset="1" stopColor="#9469F5" /></linearGradient>
      </defs>
      <path d="M27 32 V44" stroke="#9469F5" strokeWidth="3.5" strokeLinecap="round" />
      <circle cx="27" cy="29" r="5" fill="#C8AAFF" />
      <rect x="1" y="44" width="52" height="40" rx="14" fill={`url(#${id})`} />
      <rect x="8" y="51" width="38" height="25" rx="9" fill="#FFFFFF" />
      <ellipse cx="19" cy="63" rx="4" ry="5" fill="#3F2A5A" />
      <ellipse cx="35" cy="63" rx="4" ry="5" fill="#3F2A5A" />
      <path d="M22 70 q5 4 10 0" stroke="#3F2A5A" strokeWidth="2" fill="none" strokeLinecap="round" />
      <rect x="-3" y="56" width="6" height="14" rx="3" fill="#9469F5" />
      <rect x="51" y="56" width="6" height="14" rx="3" fill="#9469F5" />
    </svg>
  );
}
