import { useState } from 'react';
import { TbPalette, TbCheck } from 'react-icons/tb';
import api from '../../utils/api';
import { toast } from '../Toast/toast';
import { useAuth } from '../../hooks/useAuth';
import { cardStyle, rowStyle, iconStyle, titleStyle, subStyle, actionsStyle, quietBtn, applyBtn, doneStyle } from '../AiPanel/actionCardStyles';

const swatchesStyle = { display: 'flex', gap: 4 };
const swatch = (color) => ({ width: 22, height: 22, borderRadius: 6, background: color, border: '1px solid var(--border-default)' });

/**
 * The colors of Let's Talk for this user (server utils/ai/talkTheme.js): the
 * theme the assistant offers when asked for other colors, or back to Open
 * Report's. Applied by this click on the account; the conversation then
 * redraws its answers in it (TalkConversation).
 */
export default function TalkColorsCard({ proposal, outcome, onOutcome }) {
  const { updateUser } = useAuth();
  const [state, setState] = useState(outcome === 'applied' || outcome === 'dismissed' ? outcome : 'open'); // open | busy | applied | dismissed
  const finish = (next) => { setState(next); onOutcome?.(next); };
  const apply = async () => {
    setState('busy');
    try {
      const res = await api.put('/auth/me/talk-theme', { theme: proposal.theme || null });
      updateUser({ talk_theme: res.data.talk_theme });
      finish('applied');
    } catch (err) {
      setState('open');
      toast(err.response?.data?.error || 'The colors could not be changed');
    }
  };

  if (state === 'dismissed') return <div style={subStyle}>Dismissed</div>;
  return (
    <div style={cardStyle}>
      <div style={rowStyle}>
        <TbPalette size={18} style={iconStyle} />
        <div style={{ minWidth: 0 }}>
          <div style={titleStyle}>{proposal.theme ? 'Colors of your charts' : 'Back to the Open Report colors'}</div>
          <div style={subStyle}>{proposal.summary || 'For every answer of Let\'s Talk, now and later. A visual added to a report takes the report\'s colors.'}</div>
        </div>
      </div>
      {proposal.swatches?.length ? (
        <div style={swatchesStyle} aria-label="Colors">
          {proposal.swatches.map((c) => <span key={c} style={swatch(c)} title={c} />)}
        </div>
      ) : null}
      <div style={actionsStyle}>
        {state === 'applied' ? (
          <span style={doneStyle}><TbCheck size={14} /> Applied</span>
        ) : (
          <>
            <button style={quietBtn} onClick={() => finish('dismissed')} disabled={state === 'busy'}>Dismiss</button>
            <button style={applyBtn(state !== 'busy')} onClick={apply} disabled={state === 'busy'}>
              <TbPalette size={14} /> Apply
            </button>
          </>
        )}
      </div>
    </div>
  );
}
