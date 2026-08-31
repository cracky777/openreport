import { TbFileText, TbDatabase } from 'react-icons/tb';
import ConnectorIcon from './ConnectorIcon';

// What the data physically is: a file somebody uploaded, or a live connection.
//
// The same glyph marks the source and every model built on it, so the answer
// carries down the journey instead of stopping at the first column. Colours
// are the ones the new-report wizard already gives those two choices.
//
// `dbType` adds the engine's logo as a badge on the corner: the base glyph says
// what the data IS, the badge says what it SPEAKS. Overlaid rather than set
// beside it, so a row keeps one visual anchor instead of two competing marks —
// and an uploaded file still gets one, because « stored in DuckDB » is an
// answer the user otherwise has to go looking for.
export default function SourceIcon({ file, dbType }) {
  const Icon = file ? TbFileText : TbDatabase;
  const label = file ? 'Uploaded file' : 'Database connection';
  if (!dbType) {
    return (
      <span style={file ? fileStyle : dbStyle} title={label} aria-label={label}>
        <Icon size={18} />
      </span>
    );
  }
  return (
    <span style={stackStyle}>
      <span style={file ? fileStyle : dbStyle} title={label} aria-label={label}>
        <Icon size={22} />
      </span>
      {/* Le disque reprend le fond de la carte pour que la pastille se détache
          du glyphe qu'elle chevauche, au lieu de s'y confondre. */}
      <span style={badgeStyle}>
        <ConnectorIcon dbType={dbType} size={11} />
      </span>
    </span>
  );
}

const base = { display: 'inline-flex', alignItems: 'center', flexShrink: 0 };
const fileStyle = { ...base, color: '#16a34a' };
const dbStyle = { ...base, color: '#f59e0b' };
const stackStyle = { ...base, position: 'relative' };
const badgeStyle = {
  position: 'absolute', top: -5, right: -7,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 16, height: 16, borderRadius: '50%',
  background: 'var(--bg-panel)', boxShadow: '0 0 0 1.5px var(--bg-panel)',
};
