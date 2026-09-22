// The assistant's words. Models write **bold** and `code` whatever they are
// told — step-by-step answers name buttons that way — and printed as is, the
// asterisks got in the way. Only those two marks are read, into React
// elements: the text is never handed to the DOM as HTML.
const TOKEN = /(\*\*[^*\n]+\*\*|`[^`\n]+`)/g;
const codeStyle = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: '0.92em', padding: '0 3px', borderRadius: 4, background: 'var(--bg-subtle)' };

export default function AssistantText({ text, style }) {
  const parts = String(text || '').split(TOKEN).filter((p) => p !== '');
  return (
    <div style={style}>
      {parts.map((p, i) => {
        if (p.startsWith('**') && p.endsWith('**') && p.length > 4) return <strong key={i}>{p.slice(2, -2)}</strong>;
        if (p.startsWith('`') && p.endsWith('`') && p.length > 2) return <code key={i} style={codeStyle}>{p.slice(1, -1)}</code>;
        return p;
      })}
    </div>
  );
}
