export default function TextWidget({ data, config }) {
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        alignItems: config?.verticalAlign || 'flex-start',
        justifyContent: config?.textAlign || 'flex-start',
        padding: 16,
        fontSize: config?.fontSize || 16,
        color: config?.color || '#334155',
        fontWeight: config?.bold ? 700 : 400,
        fontStyle: config?.italic ? 'italic' : 'normal',
        overflow: 'auto',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {data?.text || 'Double-click to edit text'}
    </div>
  );
}
