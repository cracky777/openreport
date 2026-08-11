import { useState, useEffect, useRef } from 'react';

// Delete in two clicks instead of a native confirm(): the browser dialog
// freezes everything behind it and can't be styled or dismissed by the app.
//
// `blockedReason` disables the button outright. The server already refuses to
// delete a datasource or model that still has children, but letting the click
// through only to surface an error afterwards makes the user discover the
// constraint the hard way — the counts are already on screen, so say it first.
export default function ConfirmDeleteButton({ onConfirm, blockedReason, style, label = 'Delete' }) {
  const [armed, setArmed] = useState(false);
  const timer = useRef(null);

  // Disarm on its own: an armed delete button left behind is a trap.
  useEffect(() => {
    if (!armed) return undefined;
    timer.current = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer.current);
  }, [armed]);

  if (blockedReason) {
    return (
      <button disabled title={blockedReason} style={{ ...base, ...blockedStyle, ...style }}>
        {label}
      </button>
    );
  }

  return (
    <button
      className={armed ? undefined : 'btn-hover btn-hover-danger'}
      onClick={(e) => {
        e.stopPropagation();
        if (armed) { setArmed(false); onConfirm(); } else setArmed(true);
      }}
      onBlur={() => setArmed(false)}
      title={armed ? 'Click again to confirm' : label}
      style={{ ...base, ...(armed ? armedStyle : idleStyle), ...style }}
    >
      {armed ? 'Confirm?' : label}
    </button>
  );
}

const base = {
  fontSize: 12, padding: '4px 10px', borderRadius: 6,
  cursor: 'pointer', whiteSpace: 'nowrap',
};
const idleStyle = {
  background: 'var(--bg-panel)', color: 'var(--state-danger)',
  border: '1px solid var(--state-danger)',
};
const armedStyle = {
  background: 'var(--state-danger)', color: '#fff',
  border: '1px solid var(--state-danger)', fontWeight: 600,
};
const blockedStyle = {
  background: 'var(--bg-panel)', color: 'var(--text-disabled)',
  border: '1px solid var(--border-default)', cursor: 'not-allowed',
};
