import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WIDGET_TYPES, BAR_SUB_TYPES, LINE_SUB_TYPES, TABLE_SUB_TYPES } from '../Widgets';

export default function Toolbar({ reportTitle, onTitleChange, onAddWidget, onSave, saving, modelName, modelId, onUndo, onRedo, canUndo, canRedo, onOpenSettings }) {
  const navigate = useNavigate();
  const [openMenu, setOpenMenu] = useState(null); // 'bar' | 'line' | null

  const handleAddWithSubType = (type, subType) => {
    onAddWidget(type, subType);
    setOpenMenu(null);
  };

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
      <button
        onClick={() => navigate('/')}
        style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 14, padding: '4px 0' }}
      >
        ← Back
      </button>
      <div style={{ display: 'flex', gap: 2 }}>
        <button onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)" style={{ ...undoBtn, opacity: canUndo ? 1 : 0.3 }}>↩</button>
        <button onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl+Y)" style={{ ...undoBtn, opacity: canRedo ? 1 : 0.3 }}>↪</button>
      </div>
      <input
        type="text"
        value={reportTitle}
        onChange={(e) => onTitleChange(e.target.value)}
        style={{
          fontSize: 18, fontWeight: 600, border: 'none', outline: 'none',
          background: 'transparent', color: '#0f172a', minWidth: 200,
        }}
        placeholder="Report title"
      />

      {modelName && (
        <span style={{ fontSize: 12, color: '#64748b', background: '#f1f5f9', padding: '4px 10px', borderRadius: 4, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {modelName}
          {modelId && (
            <a
              href={`/models/${modelId}`}
              target="_blank"
              rel="noopener noreferrer"
              title="Edit model (new tab)"
              style={{ color: '#3b82f6', fontSize: 13, lineHeight: 1, textDecoration: 'none' }}
            >
              ✎
            </a>
          )}
        </span>
      )}

      <div style={{ flex: 1 }} />

      <div style={{ display: 'flex', gap: 4 }}>
        {Object.entries(WIDGET_TYPES).filter(([, meta]) => !meta.hidden).map(([type, { label, icon, hasSubTypes }]) => (
          <div key={type} style={{ position: 'relative' }}>
            <button
              onClick={() => {
                if (hasSubTypes) {
                  setOpenMenu(openMenu === type ? null : type);
                } else {
                  onAddWidget(type);
                  setOpenMenu(null);
                }
              }}
              title={`Add ${label}`}
              style={{
                padding: '6px 10px', fontSize: 13,
                border: openMenu === type ? '1px solid #3b82f6' : '1px solid #e2e8f0',
                borderRadius: 6, background: openMenu === type ? '#eff6ff' : '#fff',
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              <span>{icon}</span>
              <span>{label}</span>
              {hasSubTypes && <span style={{ fontSize: 10, color: '#94a3b8' }}>▼</span>}
            </button>

            {/* Sub-type dropdown */}
            {openMenu === type && type === 'bar' && (
              <div style={dropdownStyle}>
                {BAR_SUB_TYPES.map((st) => (
                  <button key={st.value} onClick={() => handleAddWithSubType('bar', st.value)} style={dropdownItem}>
                    {st.label}
                  </button>
                ))}
              </div>
            )}
            {openMenu === type && type === 'line' && (
              <div style={dropdownStyle}>
                {LINE_SUB_TYPES.map((st) => (
                  <button key={st.value} onClick={() => handleAddWithSubType('line', st.value)} style={dropdownItem}>
                    {st.label}
                  </button>
                ))}
              </div>
            )}
            {openMenu === type && type === 'table' && (
              <div style={dropdownStyle}>
                {TABLE_SUB_TYPES.map((st) => (
                  <button key={st.value} onClick={() => { onAddWidget(st.value); setOpenMenu(null); }} style={dropdownItem}>
                    {st.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <button
        onClick={onOpenSettings}
        title="Report settings"
        style={{
          padding: '6px 10px', fontSize: 18, border: '1px solid #e2e8f0',
          borderRadius: 6, background: '#fff', cursor: 'pointer', lineHeight: 1,
        }}
      >
        ⚙
      </button>

      <button
        onClick={onSave}
        disabled={saving}
        style={{
          padding: '8px 20px', fontSize: 14, fontWeight: 600, border: 'none',
          borderRadius: 6, background: '#3b82f6', color: '#fff',
          cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1,
        }}
      >
        {saving ? 'Saving...' : 'Save'}
      </button>
    </div>
  );
}

const undoBtn = {
  padding: '4px 8px', fontSize: 16, border: '1px solid #e2e8f0',
  borderRadius: 4, background: '#fff', cursor: 'pointer', color: '#475569',
};

const dropdownStyle = {
  position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 50,
  backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: 6,
  boxShadow: '0 4px 12px rgba(0,0,0,0.1)', minWidth: 180, overflow: 'hidden',
};

const dropdownItem = {
  display: 'block', width: '100%', padding: '8px 14px', fontSize: 13,
  border: 'none', background: '#fff', cursor: 'pointer', textAlign: 'left',
  color: '#334155',
};
