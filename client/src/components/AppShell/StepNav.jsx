import { Fragment } from 'react';
import { TbChevronRight } from 'react-icons/tb';
import { STEPS } from './steps';

const groupStyle = {
  display: 'grid', alignItems: 'center', gap: 2,
  padding: '3px 4px', background: 'var(--bg-subtle)',
  border: '1px solid var(--border-default)', borderRadius: 10,
};

// Les trois étapes ont la même largeur. Une grille dont les colonnes de boutons
// valent 1fr les égalise sur la plus large — « Data Sources » — sans qu'aucune
// largeur ne soit écrite en dur, donc sans rien à retoucher si un libellé
// change. Les chevrons gardent leur largeur propre : ce sont des séparateurs,
// pas des cibles.
const trackTemplate = (n) => Array.from({ length: n }, (_, i) => (i ? 'auto 1fr' : '1fr')).join(' ');

const stepBtn = (active) => ({
  // `center` et non `flex-start` : dans une colonne plus large que son libellé,
  // un texte calé à gauche redonnerait à l'œil l'inégalité qu'on vient d'ôter.
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  gap: 6, padding: '6px 10px', whiteSpace: 'nowrap',
  // Sans quoi une piste `1fr` ne descend pas sous le contenu de SON bouton : à
  // l'étroit, chacune retombe sur son propre libellé et l'égalité se défait —
  // c'est-à-dire exactement quand elle se voit le plus.
  minWidth: 0, overflow: 'hidden',
  background: active ? 'var(--bg-panel)' : 'transparent',
  border: '1px solid ' + (active ? 'var(--accent-primary-border)' : 'transparent'),
  borderRadius: 7,
  color: active ? 'var(--accent-primary-text)' : 'var(--text-secondary)',
  cursor: 'pointer', fontSize: 13, fontWeight: active ? 600 : 500,
  boxShadow: active ? 'var(--shadow-md)' : 'none',
  transition: 'background 0.15s, box-shadow 0.15s, color 0.15s, border-color 0.15s',
});

const sepStyle = { color: 'var(--text-disabled)', flexShrink: 0 };
// Le libellé cède avant le bouton : mieux vaut un mot abrégé que trois cibles
// de largeurs différentes, ou qu'une barre qui sort de l'écran.
const labelStyle = { overflow: 'hidden', textOverflow: 'ellipsis' };

// En compact la barre occupe toute sa ligne et doit y loger trois libellés
// entiers : à pleine taille il lui manque 35 px sur un écran de 390. Un point
// de moins et deux pixels de marge suffisent, et évitent d'abréger.
const compactBtn = { fontSize: 12, padding: '6px 6px' };

// Given the full width of its own row, the switcher stops being a compact pill
// and becomes the primary navigation — so it takes the room and stays legible.
// `minWidth: 0` : sans lui l'élément flex refuse de descendre sous son contenu
// et la barre déborde par la droite — elle le faisait déjà.
const compactGroupStyle = { ...groupStyle, flex: 1, minWidth: 0, whiteSpace: 'nowrap' };

// The stage switcher. `allowed` gates Sources/Models the same way the old
// Dashboard nav did (canEditOrg) — a viewer only ever sees Reports, and with a
// single stage left the switcher is noise, so it hides itself entirely.
export default function StepNav({ current, onGo, allowed, compact = false }) {
  const visible = STEPS.filter((s) => allowed(s.key));
  if (visible.length < 2) return null;

  return (
    <nav
      style={{
        ...(compact ? compactGroupStyle : groupStyle),
        gridTemplateColumns: trackTemplate(visible.length),
      }}
      aria-label="Data journey"
    >
      {visible.map((s, i) => {
        const active = s.key === current;
        const Icon = s.icon;
        return (
          // Chevron et bouton sont frères dans la grille, et non emboîtés : un
          // bouton enveloppé avec son chevron occuperait une colonne plus large
          // que le premier, qui n'en a pas.
          <Fragment key={s.key}>
            {i > 0 && <TbChevronRight size={13} style={sepStyle} />}
            <button
              onClick={() => onGo(s.key)}
              style={compact ? { ...stepBtn(active), ...compactBtn } : stepBtn(active)}
              aria-current={active ? 'page' : undefined}
              onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--bg-hover)'; }}
              onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
            >
              <Icon size={15} />
              <span style={labelStyle}>{s.label}</span>
            </button>
          </Fragment>
        );
      })}
    </nav>
  );
}
