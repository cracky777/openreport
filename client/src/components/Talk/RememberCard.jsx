import { useState } from 'react';
import { TbBookmark, TbCheck } from 'react-icons/tb';
import api from '../../utils/api';
import { toast } from '../Toast/toast';
import { cardStyle, rowStyle, iconStyle, titleStyle, subStyle, actionsStyle, quietBtn, applyBtn, doneStyle } from '../AiPanel/actionCardStyles';

const listStyle = { margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.5, color: 'var(--text-primary)' };
const wordsStyle = { color: 'var(--text-muted)' };

/**
 * What the user taught Let's Talk about the model's fields (server
 * utils/ai/remember.js): the words they call a field by, what it holds.
 * Applied, it goes to the model's glossary (PUT /models/:id/glossary, open to
 * whoever may use the model) and every assistant reads it with the schema.
 * Synonyms are added to the field's own, a description replaces its own.
 */
export default function RememberCard({ items, modelId, outcome, onOutcome, compact = false }) {
  const [state, setState] = useState(outcome === 'applied' || outcome === 'dismissed' ? outcome : 'open'); // open | busy | applied | dismissed
  const finish = (next) => { setState(next); onOutcome?.(next); };
  const apply = async () => {
    setState('busy');
    const fields = Object.fromEntries(items.map((it) => [it.field, {
      ...(it.synonyms?.length ? { synonyms: it.synonyms } : {}),
      ...(it.description ? { description: it.description } : {}),
    }]));
    try {
      await api.put(`/models/${modelId}/glossary`, { fields });
      finish('applied');
    } catch (err) {
      setState('open');
      toast(err.response?.data?.error || 'The model could not be updated');
    }
  };

  if (state === 'dismissed') return compact ? null : <div style={subStyle}>Dismissed</div>;
  return (
    <div style={compact ? { display: 'flex', flexDirection: 'column', gap: 8 } : cardStyle}>
      <div style={rowStyle}>
        <TbBookmark size={16} style={iconStyle} />
        <div style={{ minWidth: 0 }}>
          <div style={titleStyle}>Remember for this data model</div>
          <ul style={listStyle}>
            {items.map((it) => (
              <li key={it.field}>
                <strong>{it.label}</strong>
                {it.synonyms?.length ? <span style={wordsStyle}> — also called {it.synonyms.map((w) => `“${w}”`).join(', ')}</span> : null}
                {it.description ? <span style={wordsStyle}> — {it.description}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div style={actionsStyle}>
        {state === 'applied' ? (
          <span style={doneStyle}><TbCheck size={14} /> Remembered</span>
        ) : (
          <>
            <button style={quietBtn} onClick={() => finish('dismissed')} disabled={state === 'busy'}>Not now</button>
            <button style={applyBtn(state !== 'busy')} onClick={apply} disabled={state === 'busy'}>
              <TbBookmark size={14} /> Remember
            </button>
          </>
        )}
      </div>
    </div>
  );
}
