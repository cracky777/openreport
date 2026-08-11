import { TbX, TbFilter } from 'react-icons/tb';

// Shows the cascade filter a stage arrived with — "following: election" — and
// the way out of it. Without this the list looks arbitrarily short with no clue
// why, which is the classic trap of a filter that lives only in the URL.
export default function FilterCrumb({ label, onClear, verb = 'Following' }) {
  if (!label) return null;
  return (
    <div style={wrap}>
      <TbFilter size={14} />
      <span>{verb} <strong style={strong}>{label}</strong></span>
      <button onClick={onClear} style={clearBtn} title="Show everything again">
        <TbX size={13} />
      </button>
    </div>
  );
}

const wrap = {
  display: 'inline-flex', alignItems: 'center', gap: 8,
  padding: '6px 8px 6px 12px', borderRadius: 8,
  background: 'var(--accent-primary-soft)', border: '1px solid var(--accent-primary-border)',
  color: 'var(--accent-primary-text)', fontSize: 13,
};
const strong = { fontWeight: 600 };
const clearBtn = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 20, height: 20, padding: 0, borderRadius: 5,
  border: 'none', background: 'transparent',
  color: 'var(--accent-primary-text)', cursor: 'pointer',
};
