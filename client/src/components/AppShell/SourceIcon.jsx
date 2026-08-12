import { TbFileText, TbDatabase } from 'react-icons/tb';

// What the data physically is: a file somebody uploaded, or a live connection.
//
// The same glyph marks the source and every model built on it, so the answer
// carries down the journey instead of stopping at the first column. Colours
// are the ones the new-report wizard already gives those two choices.
export default function SourceIcon({ file }) {
  const Icon = file ? TbFileText : TbDatabase;
  const label = file ? 'Uploaded file' : 'Database connection';
  return (
    <span style={file ? fileStyle : dbStyle} title={label} aria-label={label}>
      <Icon size={18} />
    </span>
  );
}

const base = { display: 'inline-flex', alignItems: 'center', flexShrink: 0 };
const fileStyle = { ...base, color: '#16a34a' };
const dbStyle = { ...base, color: '#f59e0b' };
