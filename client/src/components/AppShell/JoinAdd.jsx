import { AddIcon, ICON_SIZE } from '../actionIcons';

// The "+" that starts the next stage from one card.
//
// It sits on the card's right edge — where that card's joins leave — because
// what it creates is exactly what those joins point at: a model for a source,
// a report for a model. Put inside the toolbar with the other actions it would
// read as "something you do to this card", which is the opposite of the truth.
//
// Absolutely positioned, so it costs the row no layout: the cards stay centred
// on the column's axis and the joins keep measuring the same rectangles.
export default function JoinAdd({ title, onClick }) {
  return (
    <button
      className="btn-hover btn-hover-accent"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={title}
      aria-label={title}
      style={addStyle}
    >
      <AddIcon size={ICON_SIZE.modal} />
    </button>
  );
}

// Clear of the join count JoinLayer parks at right + 34.
const addStyle = {
  position: 'absolute', left: '100%', top: '50%',
  transform: 'translateY(-50%)', marginLeft: 6,
  width: 22, height: 22, padding: 0,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  borderRadius: '50%', border: '1px solid var(--border-default)',
  background: 'var(--bg-panel)', color: 'var(--accent-primary)',
  cursor: 'pointer',
};
