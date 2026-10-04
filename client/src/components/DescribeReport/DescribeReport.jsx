import { useState } from 'react';
import { TbSparkles } from 'react-icons/tb';

// The empty Reports stage's first choice: say what you need, and the Assistant
// panel takes it from there — a report, a file to import, a database to
// connect. Enter sends; there is no button.

/** @param {function} onSubmit  (request) => void */
export default function DescribeReport({ onSubmit }) {
  const [request, setRequest] = useState('');
  const [focused, setFocused] = useState(false);

  const submit = () => {
    const text = request.trim();
    if (!text) return;
    onSubmit(text);
    setRequest('');
  };

  return (
    <div style={wrapStyle} data-tour="home-ask" data-describe-report="">
      <h2 style={titleStyle}><TbSparkles size={20} color="var(--accent-primary)" /> What do you need?</h2>
      <div style={composerStyle(focused)}>
        <textarea
          aria-label="Describe the report you want"
          style={inputStyle}
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Describe the report you want"
          maxLength={4000}
          rows={2}
        />
      </div>
    </div>
  );
}

const wrapStyle = { width: 'min(640px, 100%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, marginBottom: 32 };
const titleStyle = { display: 'flex', alignItems: 'center', gap: 8, margin: 0, fontSize: 22, fontWeight: 650, color: 'var(--text-primary)' };
const composerStyle = (focused) => ({
  width: '100%', boxSizing: 'border-box', padding: '12px 16px',
  borderRadius: 18, background: 'var(--bg-panel)', textAlign: 'left',
  border: `1px solid ${focused ? 'var(--accent-primary)' : 'var(--border-default)'}`,
  boxShadow: focused ? '0 0 0 3px var(--accent-primary-soft)' : '0 2px 10px rgba(15, 23, 42, 0.06)',
  transition: 'border-color 0.15s, box-shadow 0.15s',
});
const inputStyle = {
  width: '100%', boxSizing: 'border-box', resize: 'none', padding: 0, fontSize: 14, lineHeight: 1.5, fontFamily: 'inherit',
  color: 'var(--text-primary)', background: 'transparent', border: 'none', outline: 'none',
};
