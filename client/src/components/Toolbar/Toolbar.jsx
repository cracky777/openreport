import { useState, useRef, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { WIDGET_TYPES, BAR_SUB_TYPES, LINE_SUB_TYPES, COMBO_SUB_TYPES, TABLE_SUB_TYPES, GAUGE_SUB_TYPES, OBJECT_SUB_TYPES } from '../Widgets';
import { TbEye, TbArrowLeft, TbSettings, TbShape, TbRefresh, TbDatabase, TbPencil, TbArrowBackUp, TbArrowForwardUp } from 'react-icons/tb';

// Ordered groups for the widget toolbar
const WIDGET_GROUPS = [
  { name: 'charts', types: ['bar', 'line', 'combo', 'pie', 'treemap', 'scatter'] },
  { name: 'data', types: ['table', 'scorecard', 'gauge'] },
  { name: 'interactive', types: ['filter'] },
];

// Custom tooltip: shows 400ms after hover, below the anchor
function WidgetTooltip({ text, show }) {
  if (!show) return null;
  return (
    <div style={{
      position: 'absolute', top: 'calc(100% + 6px)', left: '50%',
      transform: 'translateX(-50%)', zIndex: 60,
      pointerEvents: 'none',
      background: 'var(--text-primary)', color: 'var(--bg-panel)', fontSize: 11,
      padding: '4px 8px', borderRadius: 4, whiteSpace: 'nowrap',
      animation: 'tooltipIn 120ms ease-out',
      boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
    }}>{text}</div>
  );
}

export default function Toolbar({ reportTitle, onTitleChange, onAddWidget, onSave, saving, modelName, modelId, onUndo, onRedo, canUndo, canRedo, onOpenSettings, reportId, onRefresh, refreshing, isReportDirty, exportMenu }) {
  const navigate = useNavigate();
  const [openMenu, setOpenMenu] = useState(null); // 'bar' | 'line' | null
  const [hoverKey, setHoverKey] = useState(null);
  const hoverTimerRef = useRef(null);
  const [previewPrompt, setPreviewPrompt] = useState(false);

  const openPreview = () => {
    window.open(`/view/${reportId}`, '_blank');
  };
  const handlePreviewClick = () => {
    if (isReportDirty?.()) setPreviewPrompt(true);
    else openPreview();
  };

  const handleAddWithSubType = (type, subType) => {
    onAddWidget(type, subType);
    setOpenMenu(null);
  };

  const scheduleHover = (key) => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => setHoverKey(key), 400);
  };
  const clearHover = () => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    setHoverKey(null);
  };
  useEffect(() => () => { if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current); }, []);

  // Build a flat list of widget buttons grouped, with group metadata preserved
  const groupedWidgets = WIDGET_GROUPS.map((g) => ({
    name: g.name,
    items: g.types
      .map((t) => WIDGET_TYPES[t] ? [t, WIDGET_TYPES[t]] : null)
      .filter(Boolean)
      .filter(([, meta]) => !meta.hidden),
  })).filter((g) => g.items.length > 0);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 20px',
        backgroundColor: 'var(--bg-panel)',
        borderBottom: '1px solid var(--border-default)',
        flexShrink: 0,
      }}
    >
      <button
        onClick={() => navigate('/')}
        style={backBtnStyle}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--bg-hover)';
          e.currentTarget.style.borderColor = 'var(--border-strong)';
          e.currentTarget.style.color = 'var(--text-primary)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'var(--bg-subtle)';
          e.currentTarget.style.borderColor = 'var(--border-default)';
          e.currentTarget.style.color = 'var(--text-secondary)';
        }}
      >
        <TbArrowLeft size={16} />
        <span>Back</span>
      </button>

      {/* Undo / Redo pill group */}
      <div style={utilityGroupStyle}>
        <div style={{ position: 'relative' }}
          onMouseEnter={() => scheduleHover('undo')}
          onMouseLeave={clearHover}>
          <button onClick={onUndo} disabled={!canUndo}
            style={{ ...utilityIconBtn, opacity: canUndo ? 1 : 0.35, cursor: canUndo ? 'pointer' : 'not-allowed' }}
            onMouseEnter={(e) => { if (canUndo) { e.currentTarget.style.background = 'var(--bg-panel)'; e.currentTarget.style.boxShadow = 'var(--shadow-md)'; e.currentTarget.style.transform = 'translateY(-1px)'; } }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'translateY(0)'; }}
          >
            <TbArrowBackUp size={18} color="var(--text-secondary)" />
          </button>
          <WidgetTooltip text="Undo (Ctrl+Z)" show={hoverKey === 'undo'} />
        </div>
        <div style={{ width: 1, height: 20, background: 'var(--border-default)' }} />
        <div style={{ position: 'relative' }}
          onMouseEnter={() => scheduleHover('redo')}
          onMouseLeave={clearHover}>
          <button onClick={onRedo} disabled={!canRedo}
            style={{ ...utilityIconBtn, opacity: canRedo ? 1 : 0.35, cursor: canRedo ? 'pointer' : 'not-allowed' }}
            onMouseEnter={(e) => { if (canRedo) { e.currentTarget.style.background = 'var(--bg-panel)'; e.currentTarget.style.boxShadow = 'var(--shadow-md)'; e.currentTarget.style.transform = 'translateY(-1px)'; } }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'translateY(0)'; }}
          >
            <TbArrowForwardUp size={18} color="var(--text-secondary)" />
          </button>
          <WidgetTooltip text="Redo (Ctrl+Y)" show={hoverKey === 'redo'} />
        </div>
      </div>

      {modelName && (
        <a
          href={modelId ? `/models/${modelId}` : undefined}
          target="_blank"
          rel="noopener noreferrer"
          title={modelId ? `${modelName} — open data model (new tab)` : modelName}
          style={modelPillStyle(!!modelId)}
          onMouseEnter={(e) => {
            if (!modelId) return;
            e.currentTarget.style.background = 'var(--bg-active)';
            e.currentTarget.style.borderColor = 'var(--accent-primary)';
            const pencil = e.currentTarget.querySelector('[data-pencil]');
            if (pencil) pencil.style.opacity = '1';
          }}
          onMouseLeave={(e) => {
            if (!modelId) return;
            e.currentTarget.style.background = 'var(--accent-primary-soft)';
            e.currentTarget.style.borderColor = 'var(--accent-primary-border)';
            const pencil = e.currentTarget.querySelector('[data-pencil]');
            if (pencil) pencil.style.opacity = '0.5';
          }}
        >
          <TbDatabase size={14} color="var(--accent-primary)" style={{ flexShrink: 0 }} />
          <span style={{
            fontWeight: 500, color: 'var(--accent-primary-text)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            minWidth: 0, flex: '0 1 auto',
          }}>{modelName}</span>
          {modelId && (
            <TbPencil data-pencil size={12} color="var(--accent-primary)" style={{ opacity: 0.5, transition: 'opacity 0.12s', flexShrink: 0 }} />
          )}
        </a>
      )}


      <div style={{ flex: 1 }} />

      <input
        type="text"
        value={reportTitle}
        onChange={(e) => onTitleChange(e.target.value)}
        style={{
          fontSize: 16, fontWeight: 600, border: '1px solid transparent', outline: 'none',
          background: 'transparent', color: 'var(--text-primary)', minWidth: 180, maxWidth: 320,
          padding: '4px 8px', borderRadius: 6, textAlign: 'center',
          transition: 'background 0.12s, border-color 0.12s',
        }}
        onFocus={(e) => { e.currentTarget.style.background = 'var(--bg-subtle)'; e.currentTarget.style.borderColor = 'var(--border-default)'; }}
        onBlur={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'transparent'; }}
        placeholder="Report title"
      />

      <div style={{ flex: 1 }} />

      <div style={{
        display: 'flex', alignItems: 'center', gap: 2,
        padding: '3px 6px', background: 'var(--bg-subtle)',
        border: '1px solid var(--border-default)', borderRadius: 10,
      }}>
        {groupedWidgets.map((group, gi) => (
          <div key={group.name} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {gi > 0 && <div style={{ width: 1, height: 22, background: 'var(--border-default)', margin: '0 4px' }} />}
            {group.items.map(([type, { label, icon: Icon, hasSubTypes }]) => {
              const iconColor = type === 'filter' ? 'var(--accent-cyan)' : 'var(--accent-primary)';
              return (
                <div key={type} style={{ position: 'relative' }}
                  onMouseEnter={() => { hasSubTypes && setOpenMenu(type); scheduleHover(type); }}
                  onMouseLeave={() => { hasSubTypes && setOpenMenu(null); clearHover(); }}
                >
                  <button
                    onClick={() => { if (!hasSubTypes) onAddWidget(type); }}
                    style={widgetBtnStyle(openMenu === type, iconColor)}
                    onMouseEnter={(e) => {
                      if (openMenu !== type) {
                        e.currentTarget.style.background = 'var(--bg-panel)';
                        e.currentTarget.style.boxShadow = 'var(--shadow-md)';
                        e.currentTarget.style.transform = 'translateY(-1px)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (openMenu !== type) {
                        e.currentTarget.style.background = 'transparent';
                        e.currentTarget.style.boxShadow = 'none';
                        e.currentTarget.style.transform = 'translateY(0)';
                      }
                    }}
                  >
                    <Icon size={18} color={iconColor} />
                    {hasSubTypes && <span style={{ fontSize: 7, color: 'var(--text-disabled)', marginLeft: 2 }}>▼</span>}
                  </button>
                  <WidgetTooltip text={`Add ${label}`} show={hoverKey === type && openMenu !== type} />

                  {/* Sub-type dropdowns */}
                  {openMenu === type && type === 'bar' && (
                    <div style={dropdownStyle}><div style={dropdownInner}>
                      {BAR_SUB_TYPES.map((st) => {
                        const StIcon = st.icon;
                        return (
                          <button key={st.value} onClick={() => handleAddWithSubType('bar', st.value)} style={dropdownItem}
                            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'var(--bg-panel)'}>
                            <StIcon size={14} color={iconColor} style={{ marginRight: 6, flexShrink: 0 }} />{st.label}
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
                            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'var(--bg-panel)'}>
                            <StIcon size={14} color={iconColor} style={{ marginRight: 6, flexShrink: 0 }} />{st.label}
                          </button>
                        );
                      })}
                    </div></div>
                  )}
                  {openMenu === type && type === 'combo' && (
                    <div style={dropdownStyle}><div style={dropdownInner}>
                      {COMBO_SUB_TYPES.map((st) => {
                        const StIcon = st.icon;
                        return (
                          <button key={st.value} onClick={() => handleAddWithSubType('combo', st.value)} style={dropdownItem}
                            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'var(--bg-panel)'}>
                            <StIcon size={14} color={iconColor} style={{ marginRight: 6, flexShrink: 0 }} />{st.label}
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
                            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'var(--bg-panel)'}>
                            <StIcon size={14} color={iconColor} style={{ marginRight: 6, flexShrink: 0 }} />{st.label}
                          </button>
                        );
                      })}
                    </div></div>
                  )}
                  {openMenu === type && type === 'gauge' && (
                    <div style={dropdownStyle}><div style={dropdownInner}>
                      {GAUGE_SUB_TYPES.map((st) => {
                        const StIcon = st.icon;
                        return (
                          <button key={st.value} onClick={() => handleAddWithSubType('gauge', st.value)} style={dropdownItem}
                            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'var(--bg-panel)'}>
                            <StIcon size={14} color={iconColor} style={{ marginRight: 6, flexShrink: 0 }} />{st.label}
                          </button>
                        );
                      })}
                    </div></div>
                  )}
                </div>
              );
            })}
          </div>
        ))}

        {/* Objects group */}
        <div style={{ width: 1, height: 22, background: 'var(--border-default)', margin: '0 4px' }} />
        <div style={{ position: 'relative' }}
          onMouseEnter={() => { setOpenMenu('objects'); scheduleHover('objects'); }}
          onMouseLeave={() => { setOpenMenu(null); clearHover(); }}
        >
          <button
            style={widgetBtnStyle(openMenu === 'objects', 'var(--text-muted)')}
            onMouseEnter={(e) => {
              if (openMenu !== 'objects') {
                e.currentTarget.style.background = 'var(--bg-panel)';
                e.currentTarget.style.boxShadow = 'var(--shadow-md)';
                e.currentTarget.style.transform = 'translateY(-1px)';
              }
            }}
            onMouseLeave={(e) => {
              if (openMenu !== 'objects') {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.boxShadow = 'none';
                e.currentTarget.style.transform = 'translateY(0)';
              }
            }}
          >
            <TbShape size={18} color="var(--text-muted)" />
            <span style={{ fontSize: 7, color: 'var(--text-disabled)', marginLeft: 2 }}>▼</span>
          </button>
          <WidgetTooltip text="Add object" show={hoverKey === 'objects' && openMenu !== 'objects'} />
          {openMenu === 'objects' && (
            <div style={dropdownStyle}><div style={dropdownInner}>
              {OBJECT_SUB_TYPES.map((st) => {
                const StIcon = st.icon;
                return (
                  <button key={st.value} onClick={() => { onAddWidget(st.type, null, st.config, st.size); setOpenMenu(null); }} style={dropdownItem}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'var(--bg-panel)'}>
                    <StIcon size={14} color="var(--text-muted)" style={{ marginRight: 6, flexShrink: 0 }} />{st.label}
                  </button>
                );
              })}
            </div></div>
          )}
        </div>
      </div>

      {/* Utility icons pill group: Refresh + Settings */}
      <div style={utilityGroupStyle}>
        {onRefresh && (
          <>
            <div style={{ position: 'relative' }}
              onMouseEnter={() => scheduleHover('refresh')}
              onMouseLeave={clearHover}>
              <button
                onClick={onRefresh}
                disabled={refreshing}
                style={{ ...utilityIconBtn, opacity: refreshing ? 0.5 : 1, cursor: refreshing ? 'not-allowed' : 'pointer' }}
                onMouseEnter={(e) => { if (!refreshing) { e.currentTarget.style.background = 'var(--bg-panel)'; e.currentTarget.style.boxShadow = 'var(--shadow-md)'; e.currentTarget.style.transform = 'translateY(-1px)'; } }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'translateY(0)'; }}
              >
                <TbRefresh size={18} color="var(--text-secondary)" style={{ animation: refreshing ? 'spin 0.8s linear infinite' : undefined }} />
              </button>
              <WidgetTooltip text="Refresh all widgets" show={hoverKey === 'refresh' && !refreshing} />
            </div>
            <div style={{ width: 1, height: 20, background: 'var(--border-default)' }} />
          </>
        )}
        <div style={{ position: 'relative' }}
          onMouseEnter={() => scheduleHover('settings')}
          onMouseLeave={clearHover}>
          <button
            onClick={onOpenSettings}
            style={utilityIconBtn}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-panel)'; e.currentTarget.style.boxShadow = 'var(--shadow-md)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'translateY(0)'; }}
          >
            <TbSettings size={18} color="var(--text-secondary)" />
          </button>
          <WidgetTooltip text="Report settings" show={hoverKey === 'settings'} />
        </div>
        {exportMenu && (
          <>
            <div style={{ width: 1, height: 20, background: 'var(--border-default)' }} />
            <div style={{ position: 'relative' }}
              onMouseEnter={() => scheduleHover('export')}
              onMouseLeave={clearHover}>
              {exportMenu}
              <WidgetTooltip text="Export report" show={hoverKey === 'export'} />
            </div>
          </>
        )}
      </div>

      {/* Preview — icon only with tooltip, sits next to Save */}
      <div style={{ position: 'relative' }}
        onMouseEnter={() => scheduleHover('preview')}
        onMouseLeave={clearHover}>
        <button
          onClick={handlePreviewClick}
          style={previewBtnStyle}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--accent-cyan-border)';
            e.currentTarget.style.borderColor = 'var(--accent-cyan)';
            e.currentTarget.style.transform = 'translateY(-1px)';
            e.currentTarget.style.boxShadow = 'var(--shadow-md)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--accent-cyan-soft)';
            e.currentTarget.style.borderColor = 'transparent';
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = 'none';
          }}
        >
          <TbEye size={18} />
        </button>
        <WidgetTooltip text="Preview report" show={hoverKey === 'preview'} />
      </div>

      <button
        onClick={onSave}
        disabled={saving}
        style={saveBtnStyle(saving)}
        onMouseEnter={(e) => {
          if (!saving) {
            e.currentTarget.style.background = 'var(--accent-primary-hover)';
            e.currentTarget.style.transform = 'translateY(-1px)';
            e.currentTarget.style.boxShadow = '0 4px 12px rgba(124,58,237,0.3)';
          }
        }}
        onMouseLeave={(e) => {
          if (!saving) {
            e.currentTarget.style.background = 'var(--accent-primary)';
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 1px 3px rgba(124,58,237,0.2)';
          }
        }}
      >
        <span>{saving ? 'Saving...' : 'Save'}</span>
      </button>

      {/* Unsaved-changes prompt before previewing */}
      {previewPrompt && (
        <>
          <div onClick={() => setPreviewPrompt(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.35)', zIndex: 1000 }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            background: 'var(--bg-panel)', borderRadius: 10, padding: 20, minWidth: 380, maxWidth: 440,
            boxShadow: '0 10px 30px rgba(15,23,42,0.25)', zIndex: 1001,
          }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
              You have unsaved changes
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.5 }}>
              The preview opens in a new tab and shows the last saved version of your report. Would you like to save before previewing?
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
              <button
                onClick={() => setPreviewPrompt(false)}
                style={{ padding: '6px 14px', fontSize: 13, background: 'var(--bg-subtle)', border: '1px solid var(--border-default)', borderRadius: 8, color: 'var(--text-secondary)', cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={() => { setPreviewPrompt(false); openPreview(); }}
                style={{ padding: '6px 14px', fontSize: 13, background: 'var(--bg-panel)', border: '1px solid var(--border-default)', borderRadius: 8, color: 'var(--text-secondary)', cursor: 'pointer' }}
              >
                Preview without saving
              </button>
              <button
                onClick={async () => {
                  setPreviewPrompt(false);
                  await onSave?.();
                  openPreview();
                }}
                style={{
                  padding: '6px 14px', fontSize: 13, fontWeight: 600,
                  background: 'var(--accent-primary)', border: 'none', borderRadius: 8, color: '#fff', cursor: 'pointer',
                  boxShadow: '0 1px 3px rgba(124,58,237,0.2)',
                }}
              >
                Save and preview
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const backBtnStyle = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px',
  background: 'var(--bg-subtle)', border: '1px solid var(--border-default)', borderRadius: 8,
  color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13, fontWeight: 500,
  transition: 'background 0.12s, border-color 0.12s, color 0.12s',
};

const utilityGroupStyle = {
  display: 'flex', alignItems: 'center', gap: 2,
  padding: '3px 6px', background: 'var(--bg-subtle)',
  border: '1px solid var(--border-default)', borderRadius: 10,
};

const utilityIconBtn = {
  padding: '6px 8px', border: 'none',
  borderRadius: 6, background: 'transparent',
  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
  transition: 'background 0.15s, box-shadow 0.15s, transform 0.15s',
  lineHeight: 1,
};

function saveBtnStyle(saving) {
  return {
    padding: '7px 18px', fontSize: 13, fontWeight: 600, border: 'none',
    borderRadius: 8, background: 'var(--accent-primary)', color: '#fff',
    cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1,
    display: 'inline-flex', alignItems: 'center', gap: 6,
    boxShadow: '0 1px 3px rgba(124,58,237,0.2)',
    transition: 'background 0.15s, transform 0.15s, box-shadow 0.15s',
  };
}

const dropdownStyle = {
  position: 'absolute', top: '100%', left: 0, paddingTop: 4, zIndex: 50, minWidth: 180,
};
const dropdownInner = {
  backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border-default)', borderRadius: 6,
  boxShadow: '0 4px 12px rgba(0,0,0,0.1)', overflow: 'hidden',
};

const dropdownItem = {
  display: 'block', width: '100%', padding: '8px 14px', fontSize: 13,
  border: 'none', background: 'var(--bg-panel)', cursor: 'pointer', textAlign: 'left',
  color: 'var(--text-secondary)',
};

// Pill-style button inside the grouped widget toolbar — larger icon, subtle hover elevation
function widgetBtnStyle(active, iconColor) {
  return {
    padding: '6px 10px', border: 'none',
    borderRadius: 8, background: active ? 'var(--bg-panel)' : 'transparent',
    cursor: 'pointer', display: 'flex', alignItems: 'center',
    transition: 'background 0.15s, box-shadow 0.15s, transform 0.15s',
    boxShadow: active ? `var(--shadow-md), inset 0 0 0 1px ${iconColor}40` : 'none',
  };
}

const previewBtnStyle = {
  padding: '7px 9px', border: '1px solid transparent',
  borderRadius: 8, background: 'var(--accent-cyan-soft)',
  cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  color: 'var(--accent-cyan)', lineHeight: 1,
  transition: 'background 0.15s, border-color 0.15s, transform 0.15s, box-shadow 0.15s',
};

function modelPillStyle(clickable) {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '5px 10px', borderRadius: 8,
    background: 'var(--accent-primary-soft)', border: '1px solid var(--accent-primary-border)',
    fontSize: 12, color: 'var(--accent-primary-text)',
    textDecoration: 'none', cursor: clickable ? 'pointer' : 'default',
    transition: 'background 0.12s, border-color 0.12s',
    maxWidth: 160, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
  };
}
