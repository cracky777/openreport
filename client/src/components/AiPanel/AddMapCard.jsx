import { useState } from 'react';
import { TbMap2, TbCheck } from 'react-icons/tb';
import api from '../../utils/api';
import { toast } from '../Toast/toast';
import { forgetInstalledAreas } from '../../utils/geo';
import { cardStyle, rowStyle, iconStyle, titleStyle, subStyle, actionsStyle, quietBtn, applyBtn, doneStyle } from './actionCardStyles';

// A map was asked of places no base map draws (the states of the United
// States): the assistant offers to make that country's map. The user's click
// makes it for the whole instance (POST /ai/maps — the shapes come from a fixed
// public source on the server, never from the assistant), then the request
// goes back to the assistant, which now draws it.
export default function AddMapCard({ proposal, onOutcome, onAnswer }) {
  const [state, setState] = useState('open'); // open | busy | applied | dismissed
  const [label, setLabel] = useState('');
  const finish = (next) => { setState(next); onOutcome?.(next); };

  const create = async () => {
    if (state !== 'open') return;
    setState('busy');
    try {
      const { map } = (await api.post('/ai/maps', { country: proposal.country })).data;
      forgetInstalledAreas();
      setLabel(map.label);
      finish('applied');
      onAnswer?.(`I added the map ${map.label}. Go on: ${proposal.request || 'draw it'}`);
    } catch (err) {
      setState('open');
      toast(err.response?.data?.error || 'The map could not be created');
    }
  };

  if (state === 'dismissed') return <div style={subStyle}>Dismissed</div>;
  return (
    <div style={cardStyle}>
      <div style={rowStyle}>
        <TbMap2 size={18} style={iconStyle} />
        <div style={{ minWidth: 0 }}>
          <div style={titleStyle}>Create the map</div>
          <div style={subStyle}>{proposal.summary || 'Open Report has no map of these places yet: create it, then the assistant draws it.'}</div>
        </div>
      </div>
      {state === 'applied' ? (
        <span style={doneStyle}><TbCheck size={14} /> {label} added — the assistant goes on.</span>
      ) : (
        <div style={actionsStyle}>
          <button style={quietBtn} onClick={() => finish('dismissed')} disabled={state === 'busy'}>Dismiss</button>
          <button style={applyBtn(state === 'open')} onClick={create} disabled={state !== 'open'}>
            <TbMap2 size={14} /> {state === 'busy' ? 'Creating the map…' : 'Create the map'}
          </button>
        </div>
      )}
    </div>
  );
}
