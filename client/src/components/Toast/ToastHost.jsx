import { useEffect, useState } from 'react';
import { subscribeToasts } from './toast';

const DURATION = 4000; // ms before a toast auto-dismisses

// Same look as the report/model editor save badge: a solid state colour, white
// text and a leading glyph, so error feedback is visually identical wherever it
// surfaces.
function variant(type) {
  if (type === 'success') return { bg: 'var(--state-success)', icon: '✓ ' };
  if (type === 'info') return { bg: 'var(--accent-primary)', icon: '' };
  return { bg: 'var(--state-danger)', icon: '✗ ' };
}

const wrapStyle = {
  position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 9999,
  display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center',
};
const itemStyle = {
  padding: '8px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600, color: '#fff',
  maxWidth: 440, textAlign: 'center', lineHeight: 1.4, overflowWrap: 'anywhere',
  boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
};

// Single instance mounted at the app root; stacks concurrent toasts.
export default function ToastHost() {
  const [items, setItems] = useState([]);
  useEffect(() => subscribeToasts((item) => {
    setItems((prev) => [...prev, item]);
    setTimeout(() => setItems((prev) => prev.filter((i) => i.id !== item.id)), DURATION);
  }), []);

  if (!items.length) return null;
  return (
    <div style={wrapStyle}>
      {items.map((it) => {
        const v = variant(it.type);
        return <div key={it.id} style={{ ...itemStyle, backgroundColor: v.bg }}>{v.icon}{it.message}</div>;
      })}
    </div>
  );
}
