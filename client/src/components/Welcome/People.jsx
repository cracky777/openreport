import RobotHead from '../RobotHead';

// The two people of the first-visit choice (RoleChoice): DataKhi's own
// consultants (datakhi.fr, "Nos consultants"), given what each one works with
// here. The pictures are theirs with the old props and DataKhi's logo taken
// off (client/public/people); what they hold and Open Report's logo are drawn
// on top, in the same coordinates, so they stay sharp at any size.

const SKIN = '#F7B9A3';
const SKIN_SHADE = '#E99B85';

// Open Report's mark where DataKhi's logo was (the cloth under it rebuilt in
// the picture): the ring is see-through, it sits on the stripes as printed.
function Badge({ cx, cy, size }) {
  return <image href="/favicon.png" x={cx - size / 2} y={cy - size / 2} width={size} height={size} />;
}

// The data analyst (DataKhi's BI consultant): his laptop open in his hands,
// a dashboard on the screen.
export function DataAnalyst({ height = 340 }) {
  return (
    <svg viewBox="0 0 230 549" height={height} width={height * (230 / 549)} role="img" aria-label="A data analyst with his laptop">
      <defs>
        <linearGradient id="da-bar-a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#8C4F8F" /><stop offset="1" stopColor="#5B3E91" /></linearGradient>
        <linearGradient id="da-bar-b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#EE6F86" /><stop offset="1" stopColor="#C2407A" /></linearGradient>
        <linearGradient id="da-bar-c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#F9C79B" /><stop offset="1" stopColor="#F2967A" /></linearGradient>
        <linearGradient id="da-shell" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#4B3566" /><stop offset="1" stopColor="#35244A" /></linearGradient>
      </defs>
      <image href="/people/data-analyst.png" width="230" height="549" />
      <Badge cx={156} cy={146} size={15} />
      <g transform="rotate(-6 116 282)">
        {/* Screen */}
        <rect x="44" y="194" width="144" height="92" rx="7" fill="url(#da-shell)" />
        <rect x="50" y="200" width="132" height="80" rx="3" fill="#FFFFFF" />
        <rect x="56" y="206" width="34" height="5" rx="2.5" fill="#D9C7EF" />
        <rect x="56" y="216" width="36" height="20" rx="3" fill="#F6F0FD" />
        <rect x="60" y="221" width="18" height="4" rx="2" fill="#C2407A" />
        <rect x="60" y="229" width="26" height="3" rx="1.5" fill="#E2D3F4" />
        <rect x="96" y="216" width="36" height="20" rx="3" fill="#F6F0FD" />
        <rect x="100" y="221" width="14" height="4" rx="2" fill="#5B3E91" />
        <rect x="100" y="229" width="22" height="3" rx="1.5" fill="#E2D3F4" />
        <circle cx="158" cy="226" r="11" fill="#F1E6FA" />
        <path d="M158 226 V215 A11 11 0 0 1 168.5 229.4 Z" fill="#EE6F86" />
        <path d="M158 226 L168.5 229.4 A11 11 0 0 1 152 235.3 Z" fill="#F7B382" />
        <path d="M56 274 H176" stroke="#EFE6F8" strokeWidth="1.5" />
        <rect x="58" y="254" width="10" height="20" rx="2" fill="url(#da-bar-a)" />
        <rect x="72" y="246" width="10" height="28" rx="2" fill="url(#da-bar-b)" />
        <rect x="86" y="250" width="10" height="24" rx="2" fill="url(#da-bar-b)" />
        <rect x="100" y="242" width="10" height="32" rx="2" fill="url(#da-bar-c)" />
        <path d="M118 266 L132 256 L146 260 L160 246 L174 242" stroke="#8C4F8F" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        {/* Keyboard base, seen from the front */}
        <path d="M30 286 H202 L196 298 H36 Z" fill="#CDBFE0" />
        <path d="M36 298 H196 L194 301 H38 Z" fill="#A493C0" />
        <rect x="100" y="288" width="32" height="3" rx="1.5" fill="#B8A8D2" />
      </g>
      {/* His fingers round the two ends of the base */}
      <g fill={SKIN} stroke={SKIN_SHADE} strokeWidth="0.8">
        <rect x="31" y="286" width="9" height="13" rx="4.5" />
        <rect x="38" y="289" width="9" height="12" rx="4.5" />
        <rect x="186" y="270" width="9" height="13" rx="4.5" />
        <rect x="193" y="268" width="9" height="13" rx="4.5" />
      </g>
    </svg>
  );
}

// The business analyst (DataKhi's data scientist, her flask gone): she asks
// her question out loud, and the assistant's head, floating over her open
// hand, answers with a chart. The view reaches past the picture, up and to
// the left, for the two speech bubbles.
export function BusinessAnalyst({ height = 340 }) {
  return (
    // `height` is hers, as for the data analyst: the bubbles add to it.
    <svg viewBox="-114 -110 380 629" height={height * (629 / 519)} width={height * (380 / 519)} role="img" aria-label="A business analyst asking her data a question, the assistant answering">
      <defs>
        <linearGradient id="ba-line" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#8C4F8F" /><stop offset="0.6" stopColor="#EE6F86" /><stop offset="1" stopColor="#F7B382" /></linearGradient>
      </defs>
      <image href="/people/business-analyst.png" width="238" height="519" />
      <Badge cx={117} cy={148} size={11} />

      {/* Read top to bottom: her question first, up on the right, then the
          assistant's answer, lower on the left, its tail on the robot's head. */}
      <path d="M130 -104 h120 a12 12 0 0 1 12 12 v34 a12 12 0 0 1 -12 12 h-76 l-16 18 l2 -18 h-30 a12 12 0 0 1 -12 -12 v-34 a12 12 0 0 1 12 -12 Z" fill="#FFFFFF" stroke="#F1D5DE" strokeWidth="1.5" />
      <rect x="134" y="-92" width="88" height="10" rx="5" fill="#E7B9C9" />
      <rect x="134" y="-74" width="58" height="10" rx="5" fill="#F1D5DE" />
      <text x="232" y="-60" fontSize="34" fontWeight="800" fill="#C2407A" fontFamily="inherit">?</text>

      {/* Off to the robot's left, its tail the size of hers (mirrored), aimed at its mouth. */}
      <path d="M-98 -52 h96 a12 12 0 0 1 12 12 v40 a12 12 0 0 1 -12 12 h-2 l2 18 l-16 -18 h-80 a12 12 0 0 1 -12 -12 v-40 a12 12 0 0 1 12 -12 Z" fill="#FFFFFF" stroke="#E2D3F4" strokeWidth="1.5" />
      <path d="M-102 2 H2" stroke="#EFE6F8" strokeWidth="1.5" />
      <rect x="-98" y="-16" width="14" height="18" rx="2.5" fill="#8C4F8F" />
      <rect x="-80" y="-30" width="14" height="32" rx="2.5" fill="#C2407A" />
      <rect x="-62" y="-22" width="14" height="24" rx="2.5" fill="#EE6F86" />
      <rect x="-44" y="-40" width="14" height="42" rx="2.5" fill="#F7B382" />
      <path d="M-24 -10 L-15 -22 L-6 -16 L1 -38" stroke="url(#ba-line)" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="1" cy="-38" r="3.5" fill="#F7B382" />

      {/* Her open hand, palm up, out of the cuff */}
      <path d="M21 137 L21.5 122 Q11 119 10 110 L10 103 Q10 99 13 99 Q16 99 16 102 L16 99 Q16 95 19.5 95 Q23 95 23 99 Q23 95 26.5 95 Q30 95 30 99 Q30 96 33.5 96.5 Q37 97 37 101 L37 108 Q41 103 43 97 Q44 94 46.5 95.5 Q48.5 97 47.5 100 Q45 112 36 121 L35.5 137 Z"
        fill={SKIN} stroke={SKIN_SHADE} strokeWidth="0.8" strokeLinejoin="round" />
      <path d="M16 102 V108 M23 99 V107 M30 99 V107" stroke={SKIN_SHADE} strokeWidth="0.8" strokeLinecap="round" />

      {/* The assistant's head, floating over her palm */}
      <ellipse cx="27" cy="91" rx="14" ry="2.5" fill="#7C4DEB" opacity="0.15" />
      <RobotHead x={-5} y={21} size={64} />
    </svg>
  );
}
