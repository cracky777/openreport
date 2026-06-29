import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { WIDGET_TYPES, BAR_SUB_TYPES, LINE_SUB_TYPES, COMBO_SUB_TYPES, TABLE_SUB_TYPES, GAUGE_SUB_TYPES, OBJECT_SUB_TYPES } from '../Widgets';

// Widget types whose flyout just adds the base type with the chosen sub-type.
const SUB_TYPE_MENUS = { bar: BAR_SUB_TYPES, line: LINE_SUB_TYPES, combo: COMBO_SUB_TYPES, gauge: GAUGE_SUB_TYPES };
import { TbEye, TbArrowLeft, TbSettings, TbShape, TbRefresh, TbArrowBackUp, TbArrowForwardUp, TbPuzzle, TbUpload, TbTrash, TbDownload, TbHandClick, TbFilter, TbToggleLeft, TbToggleRightFilled } from 'react-icons/tb';
import { useCustomVisuals } from '../../hooks/useCustomVisuals';

// Ordered groups for the widget toolbar
const WIDGET_GROUPS = [
  { name: 'charts', types: ['bar', 'line', 'combo', 'pie', 'treemap', 'scatter'] },
  { name: 'data', types: ['table', 'scorecard', 'gauge'] },
  { name: 'interactive', types: ['filter'] },
];

// Custom tooltip: shows 400ms after hover, below the anchor.
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

export default function Toolbar({ reportTitle, onTitleChange, onAddWidget, onSave, saving, onUndo, onRedo, canUndo, canRedo, onOpenSettings, reportId, onRefresh, refreshing, onRebuildCache, cacheWarming = false, cacheWarmPct = 0, isReportDirty, exportMenu, workspaceId, editInteractions, onToggleEditInteractions, canEditInteractions, onOpenReportFilters, reportFilterCount = 0, reportFilterBarVisible = false }) {
  const navigate = useNavigate();
  const [openMenu, setOpenMenu] = useState(null); // 'bar' | 'line' | 'refresh' | null
  const [hoverKey, setHoverKey] = useState(null);
  const hoverTimerRef = useRef(null);
  const [previewPrompt, setPreviewPrompt] = useState(false);
  const [rebuildPrompt, setRebuildPrompt] = useState(false);
  const [uploadStatus, setUploadStatus] = useState(null); // {type: 'error'|'success', msg}
  const fileInputRef = useRef(null);
  const customVisualsApi = useCustomVisuals(workspaceId);

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

  const handleAddCustomVisual = (visual) => {
    onAddWidget('customVisual', null, {
      visualId: visual.id,
      visualName: visual.name,
      bundleUrl: visual.bundleUrl,
      manifest: visual.manifest,
    });
    setOpenMenu(null);
  };

  const handleUploadVisual = async (file) => {
    if (!file || !workspaceId) return;
    setUploadStatus(null);
    const fd = new FormData();
    fd.append('package', file);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/visuals`, {
        method: 'POST', credentials: 'include', body: fd,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Upload failed (${res.status})`);
      }
      const j = await res.json();
      setUploadStatus({ type: 'success', msg: `Installed ${j.visual.name}` });
      customVisualsApi.refresh();
      setTimeout(() => setUploadStatus(null), 3000);
    } catch (err) {
      setUploadStatus({ type: 'error', msg: String(err.message || err) });
    }
  };

  const handleDeleteVisual = async (visualId) => {
    if (!workspaceId) return;
    if (!window.confirm('Delete this custom visual? Widgets that use it will stop rendering.')) return;
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/visuals/${visualId}`, {
        method: 'DELETE', credentials: 'include',
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Delete failed (${res.status})`);
      }
      customVisualsApi.refresh();
    } catch (err) {
      setUploadStatus({ type: 'error', msg: String(err.message || err) });
    }
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
      <div style={utilityGroupStyle}>
        <div style={{ position: 'relative' }}
          onMouseEnter={() => scheduleHover('back')}
          onMouseLeave={clearHover}>
          <button
            onClick={() => navigate('/')}
            aria-label="Back"
            style={utilityIconBtn}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-panel)';
              e.currentTarget.style.boxShadow = 'var(--shadow-md)';
              e.currentTarget.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.boxShadow = 'none';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            <TbArrowLeft size={18} color="var(--text-secondary)" />
          </button>
          <WidgetTooltip text="Back" show={hoverKey === 'back'} />
        </div>
      </div>

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
                  onMouseEnter={() => { if (hasSubTypes) setOpenMenu(type); }}
                  onMouseLeave={() => { if (hasSubTypes) setOpenMenu(null); }}
                >
                  <button
                    onClick={() => { if (!hasSubTypes) onAddWidget(type); }}
                    style={widgetBtnStyle(openMenu === type, iconColor)}
                    onMouseEnter={(e) => {
                      scheduleHover(type);
                      if (openMenu !== type) {
                        e.currentTarget.style.background = 'var(--bg-panel)';
                        e.currentTarget.style.boxShadow = 'var(--shadow-md)';
                        e.currentTarget.style.transform = 'translateY(-1px)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      clearHover();
                      if (openMenu !== type) {
                        e.currentTarget.style.background = 'transparent';
                        e.currentTarget.style.boxShadow = 'none';
                        e.currentTarget.style.transform = 'translateY(0)';
                      }
                    }}
                  >
                    <Icon size={18} color={iconColor} />
                    {hasSubTypes && <span style={{ fontSize: 7, color: 'var(--text-disabled)', marginLeft: 2 }}>▼</span>}
                    {type === 'filter' && reportFilterCount > 0 && (
                      <span style={{
                        position: 'absolute', top: -2, right: -2,
                        minWidth: 14, height: 14, padding: '0 3px',
                        borderRadius: '50%', background: 'var(--accent-primary)', color: '#fff',
                        fontSize: 9, fontWeight: 700,
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        boxSizing: 'border-box',
                      }}>{reportFilterCount}</span>
                    )}
                  </button>
                  <WidgetTooltip text={`Add ${label}`} show={hoverKey === type} />

                  {/* Sub-type dropdowns */}
                  {openMenu === type && SUB_TYPE_MENUS[type] && (
                    <div style={dropdownStyle}><div style={dropdownInner}>
                      {SUB_TYPE_MENUS[type].map((st) => {
                        const StIcon = st.icon;
                        return (
                          <button key={st.value} onClick={() => handleAddWithSubType(type, st.value)} style={dropdownItem}
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
                  {openMenu === type && type === 'filter' && (
                    <div style={dropdownStyle}><div style={dropdownInner}>
                      <button onClick={() => { onAddWidget('filter'); setOpenMenu(null); }} style={dropdownItem}
                        onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'var(--bg-panel)'}>
                        <TbFilter size={14} color={iconColor} style={{ marginRight: 6, flexShrink: 0 }} />Visual Filter
                      </button>
                      <button onClick={() => { onOpenReportFilters?.(); setOpenMenu(null); }} style={dropdownItem}
                        onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'var(--bg-panel)'}>
                        {reportFilterBarVisible
                          ? <TbToggleRightFilled size={16} style={{ marginRight: 6, color: iconColor, flexShrink: 0 }} />
                          : <TbToggleLeft size={16} style={{ marginRight: 6, color: 'var(--text-disabled)', flexShrink: 0 }} />}
                        <span>Global filter</span>
                        {reportFilterCount > 0 && (
                          <span style={{
                            marginLeft: 6, minWidth: 16, height: 16, padding: '0 4px',
                            borderRadius: '50%', background: 'var(--accent-primary)', color: '#fff',
                            fontSize: 9, fontWeight: 700,
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            boxSizing: 'border-box',
                          }}>
                            {reportFilterCount}
                          </span>
                        )}
                      </button>
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
          onMouseEnter={() => setOpenMenu('objects')}
          onMouseLeave={() => setOpenMenu(null)}
        >
          <button
            style={widgetBtnStyle(openMenu === 'objects', 'var(--text-muted)')}
            onMouseEnter={(e) => {
              scheduleHover('objects');
              if (openMenu !== 'objects') {
                e.currentTarget.style.background = 'var(--bg-panel)';
                e.currentTarget.style.boxShadow = 'var(--shadow-md)';
                e.currentTarget.style.transform = 'translateY(-1px)';
              }
            }}
            onMouseLeave={(e) => {
              clearHover();
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
          <WidgetTooltip text="Add object" show={hoverKey === 'objects'} />
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

        {/* Custom visuals — workspace-uploaded plugins. Hidden when no workspace. */}
        {workspaceId && (
          <>
            <div style={{ width: 1, height: 22, background: 'var(--border-default)', margin: '0 4px' }} />
            <div style={{ position: 'relative' }}
              onMouseEnter={() => setOpenMenu('customVisuals')}
              onMouseLeave={() => setOpenMenu(null)}
            >
              <button
                style={widgetBtnStyle(openMenu === 'customVisuals', 'var(--accent-primary)')}
                onMouseEnter={(e) => {
                  scheduleHover('customVisuals');
                  if (openMenu !== 'customVisuals') {
                    e.currentTarget.style.background = 'var(--bg-panel)';
                    e.currentTarget.style.boxShadow = 'var(--shadow-md)';
                    e.currentTarget.style.transform = 'translateY(-1px)';
                  }
                }}
                onMouseLeave={(e) => {
                  clearHover();
                  if (openMenu !== 'customVisuals') {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.boxShadow = 'none';
                    e.currentTarget.style.transform = 'translateY(0)';
                  }
                }}
              >
                <TbPuzzle size={18} color="var(--accent-primary)" />
                <span style={{ fontSize: 7, color: 'var(--text-disabled)', marginLeft: 2 }}>▼</span>
              </button>
              <WidgetTooltip text="Custom visuals" show={hoverKey === 'customVisuals'} />
              {openMenu === 'customVisuals' && (
                <div style={{ ...dropdownStyle, minWidth: 240 }}>
                  <div style={dropdownInner}>
                    {customVisualsApi.error && !customVisualsApi.loading && (
                      <div style={{ padding: '12px 14px', fontSize: 11, color: 'var(--state-danger)', background: 'rgba(220,38,38,0.06)' }}>
                        {customVisualsApi.error}
                      </div>
                    )}
                    {customVisualsApi.visuals.length === 0 && !customVisualsApi.loading && !customVisualsApi.error && (
                      <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--text-disabled)', fontStyle: 'italic' }}>
                        No custom visual installed
                      </div>
                    )}
                    {customVisualsApi.loading && (
                      <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--text-disabled)' }}>Loading...</div>
                    )}
                    {customVisualsApi.visuals.map((v) => (
                      <div key={v.id} style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border-default)' }}>
                        <button onClick={() => handleAddCustomVisual(v)} style={{ ...dropdownItem, flex: 1, display: 'flex', alignItems: 'center', borderBottom: 'none' }}
                          onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                          onMouseLeave={(e) => e.currentTarget.style.background = 'var(--bg-panel)'}>
                          {v.iconUrl
                            ? <img src={v.iconUrl} alt="" style={{ width: 16, height: 16, marginRight: 8, flexShrink: 0, objectFit: 'contain' }} />
                            : <TbPuzzle size={14} color="var(--accent-primary)" style={{ marginRight: 8, flexShrink: 0 }} />}
                          <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                            <div style={{ fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.name}</div>
                            <div style={{ fontSize: 10, color: 'var(--text-disabled)' }}>v{v.version}</div>
                          </div>
                        </button>
                        {customVisualsApi.canManage && (
                          <button onClick={() => handleDeleteVisual(v.id)} title="Delete"
                            style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '8px 10px', color: 'var(--text-disabled)' }}
                            onMouseEnter={(e) => e.currentTarget.style.color = 'var(--state-danger)'}
                            onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-disabled)'}>
                            <TbTrash size={14} />
                          </button>
                        )}
                      </div>
                    ))}
                    {customVisualsApi.canManage && (
                      <>
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          style={{ ...dropdownItem, display: 'flex', alignItems: 'center', color: 'var(--accent-primary)', fontWeight: 500 }}
                          onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                          onMouseLeave={(e) => e.currentTarget.style.background = 'var(--bg-panel)'}>
                          <TbUpload size={14} style={{ marginRight: 8 }} />
                          Upload custom visual (.zip)
                        </button>
                        <a
                          href="/api/custom-visual-template.zip"
                          download="custom-visual-template.zip"
                          style={{ ...dropdownItem, display: 'flex', alignItems: 'center', color: 'var(--text-secondary)', textDecoration: 'none' }}
                          onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                          onMouseLeave={(e) => e.currentTarget.style.background = 'var(--bg-panel)'}>
                          <TbDownload size={14} style={{ marginRight: 8 }} />
                          Download starter template
                        </a>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept=".zip"
                          style={{ display: 'none' }}
                          onChange={(e) => { handleUploadVisual(e.target.files?.[0]); e.target.value = ''; }}
                        />
                      </>
                    )}
                    {uploadStatus && (
                      <div style={{
                        padding: '8px 14px', fontSize: 11,
                        color: uploadStatus.type === 'error' ? 'var(--state-danger)' : 'var(--state-success)',
                        background: uploadStatus.type === 'error' ? 'rgba(220,38,38,0.08)' : 'rgba(22,163,74,0.08)',
                      }}>
                        {uploadStatus.msg}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Utility icons pill group: Refresh + Settings */}
      <div style={utilityGroupStyle}>
        {onRefresh && (
          <>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}
              onMouseEnter={() => { if (onRebuildCache && !refreshing && !cacheWarming) setOpenMenu('refresh'); }}
              onMouseLeave={() => { if (openMenu === 'refresh') setOpenMenu(null); }}
            >
              <div style={{ position: 'relative' }}
                onMouseEnter={() => { if (!onRebuildCache) scheduleHover('refresh'); }}
                onMouseLeave={clearHover}>
                <button
                  onClick={() => { if (!onRebuildCache && !refreshing && !cacheWarming) onRefresh(); }}
                  disabled={refreshing || cacheWarming}
                  style={{ ...utilityIconBtn, opacity: (refreshing || cacheWarming) ? 0.5 : 1, cursor: (refreshing || cacheWarming) ? 'not-allowed' : 'pointer' }}
                  onMouseEnter={(e) => { if (!refreshing && !cacheWarming) { e.currentTarget.style.background = 'var(--bg-panel)'; e.currentTarget.style.boxShadow = 'var(--shadow-md)'; e.currentTarget.style.transform = 'translateY(-1px)'; } }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'translateY(0)'; }}
                >
                  <TbRefresh size={18} color="var(--text-secondary)" style={{ animation: (refreshing || cacheWarming) ? 'spin 0.8s linear infinite' : undefined }} />
                  {onRebuildCache && <span style={{ fontSize: 7, color: 'var(--text-disabled)', marginLeft: 2 }}>▼</span>}
                </button>
                {!onRebuildCache && <WidgetTooltip text="Refresh all widgets (live query)" show={hoverKey === 'refresh' && !refreshing && !cacheWarming} />}
              </div>
              {/* Hover flyout (mirrors the widget sub-type menus): two
                  refresh modes, same icon. "Live query" = bypass cache,
                  query the source; "Cache" = rebuild rollups then refetch
                  from them (progress bar below while it warms). */}
              {onRebuildCache && openMenu === 'refresh' && !refreshing && !cacheWarming && (
                <div style={dropdownStyle}><div style={dropdownInner}>
                  <button style={{ ...dropdownItem, display: 'flex', alignItems: 'center' }}
                    onClick={() => { setOpenMenu(null); onRefresh(); }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'var(--bg-panel)'}>
                    <TbRefresh size={14} color="var(--text-secondary)" style={{ marginRight: 6, flexShrink: 0 }} />Live query
                  </button>
                  <button style={{ ...dropdownItem, display: 'flex', alignItems: 'center' }}
                    onClick={() => {
                      setOpenMenu(null);
                      // The server-side rebuild reads the report's widget
                      // list from the DB to enumerate which grains to bake.
                      // If the user just added a widget (new grain) but
                      // hasn't saved yet, the rebuild misses that grain —
                      // queries against it then fall through the planner
                      // and look broken. Force a save first when dirty.
                      if (isReportDirty?.()) setRebuildPrompt(true);
                      else onRebuildCache();
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'var(--bg-panel)'}>
                    <TbRefresh size={14} color="var(--text-secondary)" style={{ marginRight: 6, flexShrink: 0 }} />Cache
                  </button>
                </div></div>
              )}
              {cacheWarming && (
                <div className="rollup-progress determinate"
                  role="progressbar"
                  aria-valuenow={Math.round(cacheWarmPct)} aria-valuemin={0} aria-valuemax={100}
                  aria-label="Rebuilding cache"
                  style={{ position: 'absolute', left: 4, right: 4, bottom: -7, width: 'auto' }}>
                  <span style={{ width: `${Math.max(0, Math.min(100, cacheWarmPct))}%` }} />
                </div>
              )}
            </div>
            <div style={{ width: 1, height: 20, background: 'var(--border-default)' }} />
          </>
        )}
        {onToggleEditInteractions && (
          <>
            <div style={{ position: 'relative' }}
              onMouseEnter={() => scheduleHover('editInteractions')}
              onMouseLeave={clearHover}>
              <button
                onClick={onToggleEditInteractions}
                disabled={!canEditInteractions && !editInteractions}
                style={{
                  ...utilityIconBtn,
                  background: editInteractions ? 'var(--accent-primary-soft)' : 'transparent',
                  boxShadow: editInteractions ? `inset 0 0 0 1px var(--accent-primary)` : undefined,
                  opacity: (!canEditInteractions && !editInteractions) ? 0.4 : 1,
                  cursor: (!canEditInteractions && !editInteractions) ? 'not-allowed' : 'pointer',
                }}
                onMouseEnter={(e) => { if (canEditInteractions || editInteractions) { e.currentTarget.style.background = editInteractions ? 'var(--accent-primary-soft)' : 'var(--bg-panel)'; e.currentTarget.style.boxShadow = editInteractions ? `inset 0 0 0 1px var(--accent-primary)` : 'var(--shadow-md)'; e.currentTarget.style.transform = 'translateY(-1px)'; } }}
                onMouseLeave={(e) => { e.currentTarget.style.background = editInteractions ? 'var(--accent-primary-soft)' : 'transparent'; e.currentTarget.style.boxShadow = editInteractions ? `inset 0 0 0 1px var(--accent-primary)` : 'none'; e.currentTarget.style.transform = 'translateY(0)'; }}
              >
                <TbHandClick size={18} color={editInteractions ? 'var(--accent-primary)' : 'var(--text-secondary)'} />
              </button>
              <WidgetTooltip
                text={canEditInteractions || editInteractions
                  ? (editInteractions ? 'Exit Edit interactions' : 'Edit interactions (which widgets a click filters)')
                  : 'Select a widget first to edit interactions'}
                show={hoverKey === 'editInteractions'} />
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

      {/* Unsaved-changes prompt before rebuilding the cache. The rebuild
          reads the widget list from the saved DB state to enumerate grains
          — unsaved widgets would be invisible to the plan and their later
          queries would silently miss the rollup planner. */}
      {rebuildPrompt && (
        <>
          <div onClick={() => setRebuildPrompt(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.35)', zIndex: 1000 }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            background: 'var(--bg-panel)', borderRadius: 10, padding: 20, minWidth: 320, maxWidth: 420,
            boxShadow: '0 10px 30px rgba(15,23,42,0.25)', zIndex: 1001,
          }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 16 }}>
              You have unsaved changes
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
              <button
                onClick={() => setRebuildPrompt(false)}
                style={{ padding: '6px 14px', fontSize: 13, background: 'var(--bg-subtle)', border: '1px solid var(--border-default)', borderRadius: 8, color: 'var(--text-secondary)', cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  setRebuildPrompt(false);
                  await onSave?.();
                  onRebuildCache?.();
                }}
                style={{
                  padding: '6px 14px', fontSize: 13, fontWeight: 600,
                  background: 'var(--accent-primary)', border: 'none', borderRadius: 8, color: '#fff', cursor: 'pointer',
                  boxShadow: '0 1px 3px rgba(124,58,237,0.2)',
                }}
              >
                Save and rebuild
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

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

