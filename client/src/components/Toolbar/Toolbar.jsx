import { WIDGET_TYPES } from '../Widgets';

export default function Toolbar({ reportTitle, onTitleChange, onAddWidget, onSave, saving }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 20px',
        backgroundColor: '#fff',
        borderBottom: '1px solid #e2e8f0',
        flexShrink: 0,
      }}
    >
      <input
        type="text"
        value={reportTitle}
        onChange={(e) => onTitleChange(e.target.value)}
        style={{
          fontSize: 18,
          fontWeight: 600,
          border: 'none',
          outline: 'none',
          background: 'transparent',
          color: '#0f172a',
          minWidth: 200,
        }}
        placeholder="Report title"
      />

      <div style={{ flex: 1 }} />

      <div style={{ display: 'flex', gap: 4 }}>
        {Object.entries(WIDGET_TYPES).map(([type, { label, icon }]) => (
          <button
            key={type}
            onClick={() => onAddWidget(type)}
            title={`Add ${label}`}
            style={{
              padding: '6px 10px',
              fontSize: 13,
              border: '1px solid #e2e8f0',
              borderRadius: 6,
              background: '#fff',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span>{icon}</span>
            <span>{label}</span>
          </button>
        ))}
      </div>

      <button
        onClick={onSave}
        disabled={saving}
        style={{
          padding: '8px 20px',
          fontSize: 14,
          fontWeight: 600,
          border: 'none',
          borderRadius: 6,
          background: '#3b82f6',
          color: '#fff',
          cursor: saving ? 'not-allowed' : 'pointer',
          opacity: saving ? 0.7 : 1,
        }}
      >
        {saving ? 'Saving...' : 'Save'}
      </button>
    </div>
  );
}
