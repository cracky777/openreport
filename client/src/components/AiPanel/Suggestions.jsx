// The questions an empty assistant offers, in two kinds: something it can DO
// with the data, and something to LEARN about the tool. The second kind is
// what tells a newcomer the assistant also knows how OpenReport works.
// A pick is sent as is: the assistant reads it like a typed question.

/**
 * @param {{label: string, items: string[]}[]} groups
 * @param {function} onPick  (question) => void
 */
export default function Suggestions({ groups, onPick, disabled, dense }) {
  return (
    <div style={wrapStyle}>
      {groups.filter((g) => g.items.length).map((g) => (
        <div key={g.label} style={groupStyle}>
          <div style={labelStyle}>{g.label}</div>
          {g.items.map((q) => (
            <button key={q} type="button" style={dense ? denseBtn : chipBtn} disabled={disabled} onClick={() => onPick(q)}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent-primary)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-default)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
            >{q}</button>
          ))}
        </div>
      ))}
    </div>
  );
}

const wrapStyle = { display: 'flex', flexDirection: 'column', gap: 14, width: '100%', textAlign: 'left' };
const groupStyle = { display: 'flex', flexDirection: 'column', gap: 6 };
const labelStyle = { fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase' };
const chipBtn = {
  display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: 12.5, lineHeight: 1.4, fontFamily: 'inherit',
  color: 'var(--text-secondary)', background: 'var(--bg-panel)', border: '1px solid var(--border-default)',
  borderRadius: 10, cursor: 'pointer', transition: 'border-color 0.12s, color 0.12s',
};
const denseBtn = { ...chipBtn, padding: '6px 8px', fontSize: 12, borderRadius: 6 };
