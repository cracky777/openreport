import { useState } from 'react';
import { TbPhoto, TbCloudUpload } from 'react-icons/tb';
import { cardStyle, rowStyle, iconStyle, titleStyle, subStyle, actionsStyle, quietBtn } from './actionCardStyles';

// The assistant was asked for a picture (a logo) the conversation does not
// have: this card takes it. Dropped here, the image is uploaded and named to
// the assistant, which goes on with the request. No button to pick a file:
// a drop, like the files of the Chat home (asked by Jonathan).

const dropStyle = (over) => ({
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '18px 12px', borderRadius: 10,
  border: `2px dashed ${over ? 'var(--accent-primary)' : 'var(--border-strong)'}`, color: over ? 'var(--accent-primary)' : 'var(--text-muted)',
  fontSize: 12.5, background: over ? 'var(--accent-primary-soft)' : 'transparent', transition: 'border-color 0.15s',
});

export default function AddImageCard({ proposal, onOutcome, onAddImage, onAnswer }) {
  const [state, setState] = useState('open'); // open | adding | applied | dismissed
  const [over, setOver] = useState(false);
  const draggingFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
  const drop = async (e) => {
    if (!draggingFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setOver(false);
    setState('adding');
    const added = await onAddImage(e.dataTransfer.files);
    if (!added.length) { setState('open'); return; }
    setState('applied');
    onOutcome?.('applied');
    // The assistant goes on with what was asked, the image now in hand.
    onAnswer?.(`I added the image ${added.join(', ')}. Go on: ${proposal.request || 'place it on the page'}`);
  };
  if (state === 'dismissed') return <div style={subStyle}>Dismissed</div>;
  return (
    <div style={cardStyle}>
      <div style={rowStyle}>
        <TbPhoto size={18} style={iconStyle} />
        <div style={{ minWidth: 0 }}>
          <div style={titleStyle}>Add an image</div>
          <div style={subStyle}>{proposal.summary || 'Drop the picture the page needs; the assistant places it.'}</div>
        </div>
      </div>
      {state === 'applied' ? (
        <div style={subStyle}>Image added — the assistant goes on.</div>
      ) : (
        <div style={dropStyle(over)} aria-label="Drop the image here"
          onDragOver={(e) => { if (!draggingFiles(e)) return; e.preventDefault(); e.stopPropagation(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={drop}>
          <TbCloudUpload size={16} /> {state === 'adding' ? 'Uploading…' : 'Drop the image here'}
        </div>
      )}
      {state === 'open' && (
        <div style={actionsStyle}>
          <button style={quietBtn} onClick={() => { setState('dismissed'); onOutcome?.('dismissed'); }}>Dismiss</button>
        </div>
      )}
    </div>
  );
}
