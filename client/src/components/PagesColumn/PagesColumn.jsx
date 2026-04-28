import { useState } from 'react';
import { TbChevronsLeft, TbChevronsRight, TbSettings, TbPlus } from 'react-icons/tb';
import PageNavSettings from './PageNavSettings';

const COLLAPSED_WIDTH = 36;
const EXPANDED_WIDTH = 150;
const SINGLE_PAGE_WIDTH = 28;
const STORAGE_KEY = 'openreport.pagesColumn.collapsed';

// Width animations trigger layout reflow each frame. Keep the duration short
// to minimize the time window for jank when the report has many widgets.
const TRANSITION_DURATION_MS = 120;
export const PAGES_COLUMN_TRANSITION_MS = TRANSITION_DURATION_MS + 40; // small buffer for the canvas pin

export default function PagesColumn({
  pages,
  currentPageIdx,
  onSwitch,
  onAdd,
  onRename,
  onCopy,
  onDelete,
  editMode = false,
  config,
  onConfigChange,
  onAnimationStart,
}) {
  const [collapsed, setCollapsed] = useState(() => {
    // Default to collapsed in edit mode; honor any prior user preference if set.
    if (!editMode || typeof window === 'undefined') return false;
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored == null) return true;
      return stored === '1';
    } catch { return true; }
  });
  const [showSettings, setShowSettings] = useState(false);
  const [editingIdx, setEditingIdx] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [hoverIdx, setHoverIdx] = useState(null);
  const [pressedIdx, setPressedIdx] = useState(null);

  const toggleCollapsed = () => {
    const next = !collapsed;
    onAnimationStart?.();
    setCollapsed(next);
    try { window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0'); } catch { /* ignore */ }
  };

  const c = config || {};
  // Single-page edit: don't show the accordion at all — just expose the "+ add page" affordance.
  const isSinglePageEdit = editMode && pages.length <= 1;
  const isCollapsed = editMode && collapsed && !isSinglePageEdit;

  // Block-level (column container) styling
  const containerBg = c.bgColor || 'var(--bg-panel)';
  const blockWidth = c.width || EXPANDED_WIDTH;

  // All-pages-level (default for every page button) styling
  const fontSize = c.fontSize || 12;
  const fontFamily = c.fontFamily || 'inherit';
  const buttonSize = c.buttonSize || 32;

  // Default state colors when no per-page override exists. Theme-aware via CSS vars.
  const STATE_DEFAULTS = {
    default: { bg: 'transparent',         text: 'var(--text-muted)' },
    hover:   { bg: 'var(--bg-subtle)',    text: 'var(--accent-primary)' },
    active:  { bg: 'var(--bg-active)',    text: 'var(--accent-primary)' },
    pressed: { bg: 'var(--bg-active)',    text: 'var(--accent-primary)' },
  };

  // Resolve a per-page per-state value. The pageIcons map can hold:
  //  - legacy string (treated as { default: { image: <string> } })
  //  - legacy { default: '<url>', hover: '<url>', ... } shape (each value treated as image)
  //  - new shape { position, default: { bg, text, font, image }, hover: {...}, ... }
  const resolveStateValue = (pageId, state, key) => {
    const cfg = (c.pageIcons || {})[pageId];
    if (!cfg) return null;
    if (typeof cfg === 'string') return key === 'image' && state === 'default' ? cfg : null;
    const stateCfg = cfg[state];
    if (typeof stateCfg === 'string') return key === 'image' ? stateCfg : null;
    if (stateCfg && stateCfg[key] != null && stateCfg[key] !== '') return stateCfg[key];
    // Fallback to default state
    if (state !== 'default') {
      const defCfg = cfg.default;
      if (typeof defCfg === 'string') return key === 'image' ? defCfg : null;
      if (defCfg && defCfg[key] != null && defCfg[key] !== '') return defCfg[key];
    }
    return null;
  };
  const getIconPosition = (pageId) => {
    const cfg = (c.pageIcons || {})[pageId];
    if (!cfg || typeof cfg === 'string') return 'left';
    return cfg.position || 'left';
  };

  const showHeader = !!(c.title || c.logo);
  const width = isSinglePageEdit ? SINGLE_PAGE_WIDTH : (isCollapsed ? COLLAPSED_WIDTH : blockWidth);
  const titleColor = 'var(--text-primary)';

  // Single-page edit mode: minimal column with a vertical "Pages" label and the add button.
  if (isSinglePageEdit) {
    return (
      <nav
        className="no-print"
        style={{
          width,
          flexShrink: 0,
          backgroundColor: containerBg,
          borderRight: '1px solid var(--border-default)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '8px 0',
          position: 'relative',
        }}
      >
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.15em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
          writingMode: 'vertical-rl',
          transform: 'rotate(180deg)',
          userSelect: 'none',
        }}>
          Pages
        </div>
        <button onClick={onAdd} title="Add page" style={{ ...floatBtn, marginBottom: 4 }}>
          <TbPlus size={14} />
        </button>
      </nav>
    );
  }

  return (
    <>
      <nav
        className="no-print"
        style={{
          width,
          flexShrink: 0,
          backgroundColor: containerBg,
          borderRight: '1px solid var(--border-default)',
          display: 'flex',
          flexDirection: 'column',
          fontFamily,
          overflow: 'hidden',
          position: 'relative',
          transition: `width ${TRANSITION_DURATION_MS}ms linear`,
          // Isolate the column's own layout/paint from the rest of the document
          // so animating its width doesn't ripple into sibling layout work.
          contain: 'layout paint style',
          willChange: 'width',
        }}
      >
        {/* Header (logo + title) — identical in edit and preview.
            Layout controls (only apply when expanded): horizontal vs vertical, logo before/after, align left/center/right. */}
        {showHeader && (() => {
          const headerLayout = c.headerLayout || 'horizontal';
          const headerLogoPosition = c.headerLogoPosition || 'before';
          const headerAlign = c.headerAlign || 'left';
          const justifyMap = { left: 'flex-start', center: 'center', right: 'flex-end' };
          const itemsAlign = justifyMap[headerAlign] || 'flex-start';
          const isVertical = !isCollapsed && headerLayout === 'vertical';
          const logoNode = c.logo && (
            <img src={c.logo} alt="" style={{
              width: isCollapsed ? 24 : 28,
              height: isCollapsed ? 24 : 28,
              objectFit: 'contain',
              flexShrink: 0,
            }} />
          );
          const titleNode = !isCollapsed && c.title && (
            <span style={{
              fontSize: fontSize + 2,
              fontWeight: 700,
              color: titleColor,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: '100%',
            }}>{c.title}</span>
          );
          return (
            <div style={{
              padding: isCollapsed ? '8px 4px' : '10px 12px',
              display: 'flex',
              flexDirection: isVertical ? 'column' : 'row',
              alignItems: isVertical ? itemsAlign : 'center',
              justifyContent: isCollapsed ? 'center' : (isVertical ? 'center' : itemsAlign),
              gap: isVertical ? 6 : 8,
              minHeight: 40,
            }}>
              {headerLogoPosition === 'before' ? (
                <>{logoNode}{titleNode}</>
              ) : (
                <>{titleNode}{logoNode}</>
              )}
            </div>
          );
        })()}

        {/* Page list — push down in edit mode (when no header) so the floating toggle/settings buttons
            don't overlap the first page item. The two flexible spacers position the list at any
            point between top (0%) and bottom (100%) of the available space. When the list is taller
            than the available space, the spacers collapse and scrolling kicks in. */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          paddingTop: editMode && !showHeader ? 32 : 4,
          paddingBottom: editMode ? 36 : 4,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
        }}>
          {(() => {
            // Accept both legacy string values ('top' | 'center' | 'bottom') and new numeric (0-100).
            const raw = c.pagesAlignment;
            const pos = typeof raw === 'number' ? Math.max(0, Math.min(100, raw))
              : raw === 'center' ? 50
              : raw === 'bottom' ? 100
              : 0;
            return <div style={{ flexGrow: pos, flexShrink: 1, minHeight: 0 }} />;
          })()}
          <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
          {pages.map((page, idx) => {
            const active = idx === currentPageIdx;
            const hovered = hoverIdx === idx && !active;
            const pressed = pressedIdx === idx;
            const state = pressed ? 'pressed' : (active ? 'active' : (hovered ? 'hover' : 'default'));
            const icon = resolveStateValue(page.id, state, 'image');
            const iconPosition = getIconPosition(page.id);
            const isCenterPos = iconPosition === 'center' && !isCollapsed;
            const flexDir = isCenterPos ? 'column' : (iconPosition === 'right' && !isCollapsed ? 'row-reverse' : 'row');
            const bg = resolveStateValue(page.id, state, 'bg') || STATE_DEFAULTS[state].bg;
            const color = resolveStateValue(page.id, state, 'text') || STATE_DEFAULTS[state].text;
            const itemFont = resolveStateValue(page.id, state, 'font') || fontFamily;
            const isEditing = editMode && editingIdx === idx;

            return (
              <div
                key={page.id}
                onClick={() => { if (!isEditing) onSwitch(idx); }}
                onDoubleClick={() => editMode && setEditingIdx(idx)}
                onContextMenu={(e) => {
                  if (!editMode) return;
                  e.preventDefault();
                  setContextMenu({ idx, x: e.clientX, y: e.clientY });
                }}
                onMouseEnter={() => setHoverIdx(idx)}
                onMouseLeave={() => { setHoverIdx(null); setPressedIdx(null); }}
                onMouseDown={() => setPressedIdx(idx)}
                onMouseUp={() => setPressedIdx(null)}
                title={isCollapsed ? page.name : undefined}
                style={{
                  display: 'flex',
                  flexDirection: flexDir,
                  alignItems: 'center',
                  gap: isCenterPos ? 4 : 8,
                  padding: isCenterPos ? '6px 4px' : (isCollapsed ? '0 4px' : '0 12px'),
                  height: isCenterPos ? 'auto' : buttonSize,
                  minHeight: buttonSize,
                  cursor: 'pointer',
                  backgroundColor: bg,
                  color,
                  borderLeft: active ? `3px solid ${color}` : '3px solid transparent',
                  fontSize,
                  fontWeight: active ? 600 : 400,
                  fontFamily: itemFont,
                  justifyContent: isCenterPos ? 'center' : (isCollapsed ? 'center' : 'flex-start'),
                  textAlign: isCenterPos ? 'center' : 'left',
                  userSelect: 'none',
                  transition: 'background 0.1s, color 0.1s',
                }}
              >
                {icon ? (
                  <img
                    src={icon}
                    alt=""
                    style={{ width: 18, height: 18, objectFit: 'contain', flexShrink: 0 }}
                  />
                ) : isCollapsed ? (
                  <span style={{ fontSize: 11, fontWeight: 700 }}>{idx + 1}</span>
                ) : null}
                {!isCollapsed && (isEditing ? (
                  <input
                    autoFocus
                    defaultValue={page.name}
                    onBlur={(e) => { onRename(idx, e.target.value || page.name); setEditingIdx(null); }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { onRename(idx, e.target.value || page.name); setEditingIdx(null); }
                      if (e.key === 'Escape') setEditingIdx(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      border: 'none', outline: 'none', flex: 1, minWidth: 0,
                      background: 'transparent', fontSize: 'inherit', fontWeight: 'inherit',
                      color: 'inherit', fontFamily: 'inherit',
                    }}
                  />
                ) : (
                  <span style={{
                    flex: 1, minWidth: 0,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>{page.name}</span>
                ))}
              </div>
            );
          })}
          </div>
          {(() => {
            const raw = c.pagesAlignment;
            const pos = typeof raw === 'number' ? Math.max(0, Math.min(100, raw))
              : raw === 'center' ? 50
              : raw === 'bottom' ? 100
              : 0;
            return <div style={{ flexGrow: 100 - pos, flexShrink: 1, minHeight: 0 }} />;
          })()}
        </div>

        {/* Floating edit controls — only in edit mode.
            Kept as overlays so the column body stays WYSIWYG with the preview. */}
        {editMode && !isCollapsed && (
          <>
            {/* Collapse toggle — top-right */}
            <button
              onClick={toggleCollapsed}
              title="Collapse navigation"
              style={{ ...floatBtn, position: 'absolute', top: 6, right: 6 }}
            >
              <TbChevronsLeft size={14} />
            </button>
            {/* Settings — bottom-left */}
            <button
              onClick={() => setShowSettings(true)}
              title="Customize navigation"
              style={{ ...floatBtn, position: 'absolute', bottom: 8, left: 8 }}
            >
              <TbSettings size={14} />
            </button>
            {/* Add page — bottom-right */}
            <button
              onClick={onAdd}
              title="Add page"
              style={{ ...floatBtn, position: 'absolute', bottom: 8, right: 8 }}
            >
              <TbPlus size={14} />
            </button>
          </>
        )}
        {editMode && isCollapsed && (
          <>
            <button
              onClick={toggleCollapsed}
              title="Expand navigation"
              style={{ ...floatBtn, position: 'absolute', top: 6, left: '50%', transform: 'translateX(-50%)' }}
            >
              <TbChevronsRight size={14} />
            </button>
            <button
              onClick={onAdd}
              title="Add page"
              style={{ ...floatBtn, position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)' }}
            >
              <TbPlus size={14} />
            </button>
          </>
        )}
      </nav>

      {/* Context menu */}
      {contextMenu && editMode && (
        <>
          <div
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }}
            onClick={() => setContextMenu(null)}
          />
          <div style={{
            position: 'fixed', top: contextMenu.y, left: contextMenu.x, zIndex: 100,
            backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border-default)',
            borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.15)', overflow: 'hidden',
            minWidth: 140,
          }}>
            <button
              onClick={() => { setEditingIdx(contextMenu.idx); setContextMenu(null); }}
              style={ctxItem}
            >Rename</button>
            <button
              onClick={() => { onCopy(contextMenu.idx); setContextMenu(null); }}
              style={ctxItem}
            >Duplicate</button>
            {pages.length > 1 && (
              <button
                onClick={() => { onDelete(contextMenu.idx); setContextMenu(null); }}
                style={{ ...ctxItem, color: 'var(--state-danger)' }}
              >Delete</button>
            )}
          </div>
        </>
      )}

      {/* Settings popover */}
      {showSettings && editMode && (
        <PageNavSettings
          config={c}
          pages={pages}
          onChange={onConfigChange}
          onClose={() => setShowSettings(false)}
        />
      )}
    </>
  );
}

const floatBtn = {
  width: 22,
  height: 22,
  padding: 0,
  border: 'none',
  borderRadius: 4,
  background: 'rgba(0,0,0,0.06)',
  cursor: 'pointer',
  color: 'var(--text-muted)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  backdropFilter: 'blur(4px)',
  zIndex: 1,
};

const ctxItem = {
  display: 'block',
  width: '100%',
  padding: '8px 12px',
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  textAlign: 'left',
  fontSize: 12,
  color: 'var(--text-secondary)',
};
