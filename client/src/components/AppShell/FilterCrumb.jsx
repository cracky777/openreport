import { useState, useRef, useEffect } from 'react';
import { TbX, TbFilter, TbChevronDown, TbCheck } from 'react-icons/tb';

// Shows the cascade filter a stage arrived with — "following: election" — and
// the way out of it. Without this the list looks arbitrarily short with no clue
// why, which is the classic trap of a filter that lives only in the URL.
//
// Le nom est aussi le moyen d'en changer. Un filtre qu'on ne peut qu'effacer
// oblige à repasser par la liste entière pour poser la même question sur la
// branche d'à côté ; il se modifie donc là où il se lit.
export default function FilterCrumb({ label, onClear, verb = 'Following', options = [], onPick }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  // Un menu ouvert doit se refermer sur un clic ailleurs, sinon il suit
  // l'utilisateur d'une étape à l'autre.
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (!boxRef.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  if (!label) return null;
  // Sans autre branche où aller, le nom reste du texte : un menu d'un seul
  // choix, celui déjà en cours, ne promet rien qu'il puisse tenir.
  const switchable = !!onPick && options.length > 1;

  return (
    <div ref={boxRef} style={wrap}>
      <TbFilter size={14} />
      {switchable ? (
        <button onClick={() => setOpen((v) => !v)} style={pickBtn} title="Filter on something else">
          <span>{verb} <strong style={strong}>{label}</strong></span>
          <TbChevronDown size={12} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.12s' }} />
        </button>
      ) : (
        <span>{verb} <strong style={strong}>{label}</strong></span>
      )}
      <button onClick={onClear} style={clearBtn} title="Show everything again">
        <TbX size={13} />
      </button>

      {open && (
        <div style={dropdown} role="listbox">
          {options.map((o) => {
            const current = o.name === label;
            return (
              <button
                key={o.id}
                className="btn-hover"
                role="option"
                aria-selected={current}
                onClick={() => { onPick(o.id); setOpen(false); }}
                style={rowStyle(current)}
              >
                <TbCheck size={13} style={{ opacity: current ? 1 : 0, flexShrink: 0 }} />
                <span style={rowName}>{o.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const wrap = {
  position: 'relative',
  display: 'inline-flex', alignItems: 'center', gap: 8,
  padding: '6px 8px 6px 12px', borderRadius: 8,
  background: 'var(--accent-primary-soft)', border: '1px solid var(--accent-primary-border)',
  color: 'var(--accent-primary-text)', fontSize: 13,
};
const strong = { fontWeight: 600 };
const pickBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: 0,
  border: 'none', background: 'transparent', font: 'inherit',
  color: 'inherit', cursor: 'pointer',
};
const clearBtn = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 20, height: 20, padding: 0, borderRadius: 5,
  border: 'none', background: 'transparent',
  color: 'var(--accent-primary-text)', cursor: 'pointer',
};
const dropdown = {
  position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 60,
  minWidth: 220, maxHeight: 320, overflowY: 'auto',
  display: 'flex', flexDirection: 'column', gap: 2, padding: 4,
  background: 'var(--bg-panel)', color: 'var(--text-primary)',
  border: '1px solid var(--border-default)', borderRadius: 8,
  boxShadow: 'var(--shadow-lg)',
};
const rowStyle = (current) => ({
  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
  padding: '6px 8px', borderRadius: 6, border: 'none', background: 'transparent',
  font: 'inherit', fontSize: 13, textAlign: 'left', cursor: 'pointer',
  color: current ? 'var(--accent-primary-text)' : 'var(--text-primary)',
  fontWeight: current ? 600 : 400,
});
const rowName = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
