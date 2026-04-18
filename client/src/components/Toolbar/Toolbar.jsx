import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { WIDGET_TYPES, BAR_SUB_TYPES, LINE_SUB_TYPES, TABLE_SUB_TYPES, OBJECT_SUB_TYPES } from '../Widgets';
import { TbEye, TbArrowLeft, TbAdjustments, TbShape } from 'react-icons/tb';

export default function Toolbar({ reportTitle, onTitleChange, onAddWidget, onSave, saving, modelName, modelId, onUndo, onRedo, canUndo, canRedo, onOpenSettings, reportId }) {
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
        style={backBtnStyle}
      >
        <TbArrowLeft size={16} /> Back
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

      <button
        onClick={() => window.open(`/view/${reportId}`, '_blank')}
        title="Preview report"
        style={{
          padding: '4px 10px', border: '1px solid #e2e8f0',
          borderRadius: 4, background: '#fff', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#475569',
        }}
      >
        <TbEye size={16} /> Preview
      </button>

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
        {Object.entries(WIDGET_TYPES).filter(([type, meta]) => !meta.hidden && type !== 'text').map(([type, { label, icon: Icon, hasSubTypes }]) => (
          <div key={type} style={{ position: 'relative' }}
            onMouseEnter={() => hasSubTypes && setOpenMenu(type)}
            onMouseLeave={() => hasSubTypes && setOpenMenu(null)}
          >
            <button
              onClick={() => {
                if (!hasSubTypes) {
                  onAddWidget(type);
                }
              }}
              title={`Add ${label}`}
              style={{
                padding: '6px 10px', fontSize: 13,
                border: openMenu === type ? '1px solid #3b82f6' : '1px solid #e2e8f0',
                borderRadius: 6, background: openMenu === type ? '#eff6ff' : '#fff',
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
                transition: 'all 0.12s',
              }}
              onMouseEnter={(e) => { if (openMenu !== type) { e.currentTarget.style.background = '#f8fafc'; e.currentTarget.style.borderColor = '#cbd5e1'; } }}
              onMouseLeave={(e) => { if (openMenu !== type) { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = '#e2e8f0'; } }}
            >
              <Icon size={16} />
              <span>{label}</span>
              {hasSubTypes && <span style={{ fontSize: 10, color: '#94a3b8' }}>▼</span>}
            </button>

            {/* Sub-type dropdown */}
            {openMenu === type && type === 'bar' && (
              <div style={dropdownStyle}><div style={dropdownInner}>
                {BAR_SUB_TYPES.map((st) => {
                  const StIcon = st.icon;
                  return (
                    <button key={st.value} onClick={() => handleAddWithSubType('bar', st.value)} style={dropdownItem}
                      onMouseEnter={(e) => e.currentTarget.style.background = '#f1f5f9'}
                      onMouseLeave={(e) => e.currentTarget.style.background = '#fff'}>
                      <StIcon size={14} style={{ marginRight: 6, flexShrink: 0 }} />{st.label}
                    </button>
                  );
                })}
              </div></div>
            )}
            {openMenu === type && type === 'line' && (
              <div style={dropdownStyle}><div style={dropdownInner}>
                {LINE_SUB_TYPES.map((st) => {
                  const StIcon = st.icon;
                  return (
                    <button key={st.value} onClick={() => handleAddWithSubType('line', st.value)} style={dropdownItem}
                      onMouseEnter={(e) => e.currentTarget.style.background = '#f1f5f9'}
                      onMouseLeave={(e) => e.currentTarget.style.background = '#fff'}>
                      <StIcon size={14} style={{ marginRight: 6, flexShrink: 0 }} />{st.label}
                    </button>
                  );
                })}
              </div></div>
            )}
            {openMenu === type && type === 'table' && (
              <div style={dropdownStyle}><div style={dropdownInner}>
                {TABLE_SUB_TYPES.map((st) => {
                  const StIcon = st.icon;
                  return (
                    <button key={st.value} onClick={() => { onAddWidget(st.value); setOpenMenu(null); }} style={dropdownItem}
                      onMouseEnter={(e) => e.currentTarget.style.background = '#f1f5f9'}
                      onMouseLeave={(e) => e.currentTarget.style.background = '#fff'}>
                      <StIcon size={14} style={{ marginRight: 6, flexShrink: 0 }} />{st.label}
                    </button>
                  );
                })}
              </div></div>
            )}
          </div>
        ))}

        {/* Objects group */}
        <div style={{ position: 'relative' }}
          onMouseEnter={() => setOpenMenu('objects')}
          onMouseLeave={() => setOpenMenu(null)}
        >
          <button
            title="Add object"
            style={{
              padding: '6px 10px', fontSize: 13,
              border: openMenu === 'objects' ? '1px solid #3b82f6' : '1px solid #e2e8f0',
              borderRadius: 6, background: openMenu === 'objects' ? '#eff6ff' : '#fff',
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
              transition: 'all 0.12s',
            }}
            onMouseEnter={(e) => { if (openMenu !== 'objects') { e.currentTarget.style.background = '#f8fafc'; e.currentTarget.style.borderColor = '#cbd5e1'; } }}
            onMouseLeave={(e) => { if (openMenu !== 'objects') { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = '#e2e8f0'; } }}
          >
            <TbShape size={16} />
            <span>Objects</span>
            <span style={{ fontSize: 10, color: '#94a3b8' }}>▼</span>
          </button>
          {openMenu === 'objects' && (
            <div style={dropdownStyle}><div style={dropdownInner}>
              {OBJECT_SUB_TYPES.map((st) => {
                const StIcon = st.icon;
                return (
                  <button key={st.value} onClick={() => { onAddWidget(st.type, null, st.config, st.size); setOpenMenu(null); }} style={dropdownItem}
                    onMouseEnter={(e) => e.currentTarget.style.background = '#f1f5f9'}
                    onMouseLeave={(e) => e.currentTarget.style.background = '#fff'}>
                    <StIcon size={14} style={{ marginRight: 6, flexShrink: 0 }} />{st.label}
                  </button>
                );
              })}
            </div></div>
          )}
        </div>
      </div>

      <button
        onClick={onOpenSettings}
        title="Report settings"
        style={{
          padding: '6px 10px', fontSize: 18, border: '1px solid #e2e8f0',
          borderRadius: 6, background: '#fff', cursor: 'pointer', lineHeight: 1,
          display: 'flex', alignItems: 'center',
        }}
      >
        <TbAdjustments size={18} />
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

const backBtnStyle = {
  display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px',
  background: 'none', border: '1px solid #e2e8f0', borderRadius: 6,
  color: '#64748b', cursor: 'pointer', fontSize: 13, fontWeight: 500,
};

const undoBtn = {
  padding: '4px 8px', fontSize: 16, border: '1px solid #e2e8f0',
  borderRadius: 4, background: '#fff', cursor: 'pointer', color: '#475569',
};

const dropdownStyle = {
  position: 'absolute', top: '100%', left: 0, paddingTop: 4, zIndex: 50, minWidth: 180,
};
const dropdownInner = {
  backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: 6,
  boxShadow: '0 4px 12px rgba(0,0,0,0.1)', overflow: 'hidden',
};

const dropdownItem = {
  display: 'block', width: '100%', padding: '8px 14px', fontSize: 13,
  border: 'none', background: '#fff', cursor: 'pointer', textAlign: 'left',
  color: '#334155',
};
