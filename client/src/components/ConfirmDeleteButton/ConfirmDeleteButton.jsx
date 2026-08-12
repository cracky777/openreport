import { useState, useEffect, useRef } from 'react';
import { DeleteIcon, ICON_SIZE } from '../actionIcons';
import { cardActionBtn } from '../dashboardModalStyles';

// Delete in two clicks instead of a native confirm(): the browser dialog
// freezes everything behind it, can't be styled, and can't be dismissed by the
// app. It was already the rule here — it just wasn't applied anywhere else,
// so twelve other destructive actions still went through window.confirm.
//
// Two shapes for one behaviour. `text` is the labelled button the journey
// cards use; `icon` is the square that sits in a row of action buttons, where
// a word would break the rhythm. Armed, the icon fills red and says so in its
// tooltip — the state has to be visible without a label to carry it.
//
// `blockedReason` disables the button outright. The server already refuses to
// delete something that still has children, but letting the click through only
// to surface an error afterwards makes the user discover the constraint the
// hard way — the counts are already on screen, so say it first.
export default function ConfirmDeleteButton({
  onConfirm,
  blockedReason,
  style,
  label = 'Delete',
  variant = 'text',
  size = ICON_SIZE.card,
}) {
  const [armed, setArmed] = useState(false);
  const timer = useRef(null);

  // Disarm on its own: an armed delete button left behind is a trap.
  useEffect(() => {
    if (!armed) return undefined;
    timer.current = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer.current);
  }, [armed]);

  const fire = (e) => {
    e.stopPropagation();
    if (armed) { setArmed(false); onConfirm(); } else setArmed(true);
  };

  if (variant === 'icon') {
    if (blockedReason) {
      return (
        <button disabled title={blockedReason} style={{ ...iconBlocked, ...style }}>
          <DeleteIcon size={size} />
        </button>
      );
    }
    const danger = cardActionBtn('danger');
    return (
      <button
        {...(armed ? {} : danger)}
        onClick={fire}
        onBlur={() => setArmed(false)}
        title={armed ? 'Click again to confirm' : label}
        aria-label={label}
        style={{ ...danger.style, ...(armed ? iconArmed : null), ...style }}
      >
        <DeleteIcon size={size} />
      </button>
    );
  }

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
      onClick={fire}
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

// Armed overrides the hover handlers too — cardActionBtn would repaint it back
// to idle on mouse-out, and the one signal that the button is loaded would
// vanish under the cursor that armed it.
const iconArmed = {
  background: 'var(--state-danger)',
  borderColor: 'var(--state-danger)',
  color: '#fff',
};
const iconBase = {
  padding: '9px 10px', borderRadius: 8,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  background: 'var(--bg-subtle)', border: '1px solid var(--border-default)',
};
const iconBlocked = { ...iconBase, color: 'var(--text-disabled)', cursor: 'not-allowed' };
