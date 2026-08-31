import { useRef, useState, useEffect, useCallback, useMemo, Fragment } from 'react';
import { TbMagnet, TbMagnetOff, TbMinus, TbLayersSubtract, TbLayersLinked, TbArrowBigDown, TbArrowBigUp } from 'react-icons/tb';
import { WIDGET_TYPES } from '../Widgets';
import { getMergeGroups, groupSeams, mergeCorners, edgeMidpoint } from '../../utils/mergeFrames';
import WidgetItem from './WidgetItem';
import { stackedOrder, stackedHeight, STACK_BREAKPOINT, STACK_GAP } from '../../utils/stackedLayout';

// Inner padding of the stacked (small-screen) column.
const STACK_PAD = 12;



export default function ReportCanvas({
  layout,
  widgets,
  selectedWidget,
  onLayoutChange,
  onLayoutChangeLive,
  onSelectWidget,
  readOnly,
  settings = {},
  onLoadMore,
  onWidgetUpdate,
  reportFilters,
  onSlicerFilter,
  onSlicerSearch,
  onCrossFilter,
  onDrillUp,
  onDrillReset,
  crossHighlight,
  reportRef,
  editInteractions,
  onToggleCrossFilter,
  // When non-null and editInteractions is true, the source for the edit-
  // interactions overlay is settings.reportFilters[interactionsRule.idx]
  // rather than the selected widget. `interactionsRule.exclusions` drives
  // the per-widget badge state instead of source.config.crossFilterExclusions.
  interactionsRule,
  onCancelFetch,
  onRefreshWidget,
  // Last triggered refresh type — colours each loading widget's spinner
  // so the user can tell at a glance whether the load is a live-source
  // refetch ('live' → violet) or a post-rebuild planner refetch ('cache'
  // → cyan). Other fetch causes (cross-filter, drill, binding edit) keep
  // the previous kind set by the user's last explicit refresh trigger.
  refreshKind,
  // Merge the selected widget with a neighbour (called by the on-canvas
  // magnet affordance). No-op in read-only.
  onMergeWith,
  // Z-order handlers for the floating bar pinned above the selected widget.
  // Layer order is a canvas concern, so its controls live next to the
  // object they move rather than in the config panel.
  onBringToFront,
  onSendToBack,
  onBringForward,
  onSendBackward,
  // Unmerge the currently-selected widget from its group, and toggle the
  // group's separator. Same handlers as the PropertyPanel actions — also
  // surfaced on-canvas at each seam of the selected widget's group.
  onUnmerge,
  onToggleSeparator,
  // Print mode strips the surrounding chrome (outer padding + bg-app
  // background + auto-margin centering + fit-to-width scale) so a server
  // -side Puppeteer renderer can capture just the report canvas at its
  // native dimensions.
  printMode,
}) {
  const [resizing, setResizing] = useState(null);
  const justResizedRef = useRef(false);
  const resizedRef = useRef(false);
  const containerRef = useRef(null);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  // Which merge-magnet trigger zone the cursor is currently over.
  // Drives the hover-reveal of the merge button at that junction —
  // the magnet stays invisible until the user moves the pointer onto
  // the shared edge, then fades in. Reverts to null when the mouse
  // leaves the zone. Reset implicitly when the selection changes (a
  // different widget's magnets render under different ids).
  const [hoveredMagnetId, setHoveredMagnetId] = useState(null);
  // Which merged-group seam the cursor is currently over. Same
  // hover-reveal pattern as the merge magnet, but for the unmerge +
  // separator-toggle cluster that sits at the seam midpoint between
  // already-merged widgets. Keyed by `seam-${groupIdx}-${seamIdx}`
  // so each seam in a multi-member group toggles independently.
  const [hoveredSeamKey, setHoveredSeamKey] = useState(null);

  // Track container size for fit modes
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerSize({ w: el.clientWidth - 40, h: el.clientHeight - 40, raw: el.clientWidth });
    update(); // Initial measurement
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pageWidth = settings.pageWidth || 1140;
  const pageHeight = settings.pageHeight || 800;
  const viewMode = settings.viewMode || 'fitToWidth';

  const canvasHeight = pageHeight;

  // Small screens (phone, narrow embed iframe): instead of scaling the fixed
  // page down to an unreadable thumbnail, the READ-ONLY canvas stacks the
  // widgets in one full-width column (slicers first, then reading order —
  // see utils/stackedLayout). The editor never stacks: it is the desktop
  // authoring surface, and the persisted layout stays in pixels. Authors
  // can opt a report out ('scale') from the report settings.
  const stacked = !!readOnly && !printMode && containerSize.raw > 0
    && (settings.smallScreens || 'stack') === 'stack'
    && containerSize.raw < STACK_BREAKPOINT;

  const scale = useMemo(() => {
    if (printMode) return 1;
    if (viewMode === 'actual' || containerSize.w <= 0) return 1;
    if (viewMode === 'fitToWidth') return Math.min(1, containerSize.w / pageWidth);
    if (viewMode === 'fitToPage') return Math.min(1, containerSize.w / pageWidth, containerSize.h / canvasHeight);
    return 1;
  }, [viewMode, containerSize, pageWidth, canvasHeight, printMode]);

  const gridSize = (settings.snapToGrid ?? true) ? (settings.gridSize || 20) : 1;
  const snap = useCallback((v) => Math.round(v / gridSize) * gridSize, [gridSize]);
  // The grid react-draggable enforces is in SCREEN pixels — it quantises the
  // raw pointer delta, before the scale is divided out. Handed the page-pixel
  // grid it snapped a scaled-down canvas to cells larger than its own, and the
  // widget advanced one cell per tick whatever the cursor did: it crawled
  // behind the mouse at exactly the raw distance, the scale correction rounded
  // away. Scaled here, one cell on screen is one cell on the page.
  const snapGrid = (settings.snapToGrid ?? true) ? [gridSize * scale, gridSize * scale] : undefined;

  // Groups of merged widgets (gid -> items, only groups with >= 2 present
  // members). Used to render the single shared frame + drive solid-block
  // dragging + neutralise each member's own chrome.
  const mergeGroups = useMemo(() => getMergeGroups(layout, widgets), [layout, widgets]);
  const mergedGidById = useMemo(() => {
    const m = {};
    for (const [gid, items] of Object.entries(mergeGroups)) {
      for (const it of items) m[it.i] = gid;
    }
    return m;
  }, [mergeGroups]);

  // On-canvas "magnet" affordances: when a widget is selected (edit mode),
  // a small magnet sits at the junction with each adjacent neighbour that
  // isn't already merged with it — click to merge the two.
  const mergeMagnets = useMemo(() => {
    if (readOnly || !selectedWidget) return [];
    const sel = layout.find((l) => l.i === selectedWidget);
    const selW = widgets[selectedWidget];
    if (!sel || !selW) return [];
    const selGid = selW.config?.mergeGroup || null;
    const out = [];
    for (const it of layout) {
      if (it.i === selectedWidget) continue;
      const w = widgets[it.i];
      if (!w || !WIDGET_TYPES[w.type]) continue;
      if (selGid && w.config?.mergeGroup === selGid) continue;
      const p = edgeMidpoint(sel, it);
      if (p) out.push({ id: it.i, x: p.x, y: p.y, vertical: p.vertical, start: p.start, length: p.length });
    }
    return out;
  }, [readOnly, selectedWidget, layout, widgets]);

  // Move `id` to the dragged position, translating its merged group as a
  // solid block ("bloc solidaire"). `emit` picks the channel: the LIVE one
  // fires on every drag tick so the group members and the on-canvas
  // adornments (z-order bar, magnets) follow the widget DURING the move;
  // the recorded one fires once on drop = one undo step per gesture.
  const applyMove = useCallback((id, data, emit) => {
    const it = layout.find((l) => l.i === id);
    const nx = Math.max(0, snap(data.x));
    const ny = Math.max(0, snap(data.y));
    const gid = mergedGidById[id];
    if (gid && it) {
      const dx = nx - (it.x || 0);
      const dy = ny - (it.y || 0);
      const memberIds = new Set((mergeGroups[gid] || []).map((m) => m.i));
      emit(layout.map((l) => memberIds.has(l.i)
        ? { ...l, x: Math.max(0, (l.x || 0) + dx), y: Math.max(0, (l.y || 0) + dy) }
        : l));
      return;
    }
    emit(layout.map((item) =>
      item.i === id ? { ...item, x: nx, y: ny } : item
    ));
  }, [layout, snap, mergedGidById, mergeGroups]);

  const emitLive = onLayoutChangeLive || onLayoutChange;
  const handleDrag = useCallback((id, data) => {
    applyMove(id, data, emitLive);
  }, [applyMove, emitLive]);
  const handleDragStop = useCallback((id, data) => {
    applyMove(id, data, onLayoutChange);
  }, [applyMove, onLayoutChange]);

  const handleAutoHeight = useCallback((id, newH) => {
    onLayoutChange(layout.map((item) =>
      item.i === id ? { ...item, h: newH } : item
    ));
  }, [layout, onLayoutChange]);

  useEffect(() => {
    if (!resizing) return;
    const { dir } = resizing;

    const handleMouseMove = (e) => {
      // Pointer deltas are screen pixels; `w`/`h` are page pixels. On a canvas
      // scaled to fit, the two are not the same unit — the widget grew by the
      // raw distance, so the edge crept away from the handle under the cursor.
      const dx = (e.clientX - resizing.startX) / scale;
      const dy = (e.clientY - resizing.startY) / scale;
      const updates = {};

      // Width changes (snap to grid)
      if (dir.includes('e')) updates.w = Math.max(80, snap(resizing.startW + dx));
      if (dir.includes('w')) { updates.w = Math.max(80, snap(resizing.startW - dx)); updates.x = snap(resizing.startPosX + dx); if (updates.w <= 80) updates.x = resizing.startPosX + resizing.startW - 80; }

      // Height changes (snap to grid)
      if (dir.includes('s')) updates.h = Math.max(40, snap(resizing.startH + dy));
      if (dir.includes('n')) { updates.h = Math.max(40, snap(resizing.startH - dy)); updates.y = snap(resizing.startPosY + dy); if (updates.h <= 40) updates.y = resizing.startPosY + resizing.startH - 40; }

      resizedRef.current = true;
      emitLive(layout.map((item) =>
        item.i === resizing.id ? { ...item, ...updates } : item
      ));
    };

    const handleMouseUp = () => {
      setResizing(null);
      // Commit the final geometry as ONE recorded step (the per-tick
      // updates above went through the transient channel).
      if (resizedRef.current) {
        resizedRef.current = false;
        onLayoutChange(layout.map((l) => ({ ...l })));
      }
      // Ending a resize fires a synthetic click: mousedown hit the handle,
      // mouseup lands wherever the cursor stopped, so the click lands on
      // their common ancestor — this canvas — whose onClick deselects.
      // Flag it for exactly one tick so that click is swallowed and the
      // widget stays selected after resizing.
      justResizedRef.current = true;
      setTimeout(() => { justResizedRef.current = false; }, 0);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizing, layout, onLayoutChange, emitLive, scale, snap]);

  const startResize = useCallback((e, id, dir = 'se') => {
    e.stopPropagation();
    e.preventDefault();
    const item = layout.find((l) => l.i === id);
    if (!item) return;
    setResizing({
      id, dir,
      startW: item.w || 400,
      startH: item.h || 300,
      startX: e.clientX,
      startY: e.clientY,
      startPosX: item.x || 0,
      startPosY: item.y || 0,
    });
  }, [layout]);

  // Stacked column: one widget per row, each spanning the column width at
  // its authored height. No seams, magnets or z-order bar — those are
  // absolute-canvas concerns and the canvas is read-only here anyway.
  const stackedColumn = stacked ? (() => {
    const colWidth = Math.max(200, containerSize.raw - 2 * STACK_PAD);
    const viewportH = containerSize.h + 40;
    return (
      <div
        ref={reportRef}
        data-stacked="1"
        style={{
          display: 'flex', flexDirection: 'column', gap: STACK_GAP,
          width: colWidth,
          padding: STACK_PAD,
          boxSizing: 'border-box',
          backgroundColor: settings.transparentBg ? 'transparent' : (settings.backgroundColor || 'var(--bg-canvas)'),
          borderRadius: settings.borderRadius ?? 8,
        }}
      >
        {stackedOrder(layout, widgets).map((item) => {
          const widget = widgets[item.i];
          if (!WIDGET_TYPES[widget.type]) return null;
          const stackedItem = {
            ...item, x: 0, y: 0, z: 1,
            w: colWidth - 2 * STACK_PAD,
            h: stackedHeight(item, widget, viewportH),
          };
          return (
            <WidgetItem
              key={item.i}
              stacked
              item={stackedItem}
              widget={widget}
              readOnly
              onLoadMore={onLoadMore}
              onSlicerFilter={onSlicerFilter}
              onSlicerSearch={onSlicerSearch}
              onCrossFilter={onCrossFilter}
              onDrillUp={onDrillUp}
              onDrillReset={onDrillReset}
              crossHighlight={crossHighlight}
              reportFilters={reportFilters}
              mergeCorners={null}
            />
          );
        })}
      </div>
    );
  })() : null;

  return (
    <div
      ref={containerRef}
      onClick={() => {
        if (justResizedRef.current) return; // the click that ends a resize
        onSelectWidget?.(null);
      }}
      style={{
        flex: 1,
        backgroundColor: printMode ? 'transparent' : 'var(--bg-app)',
        overflowX: 'hidden',
        overflowY: (viewMode === 'fitToPage' && !stacked) || printMode ? 'hidden' : 'auto',
        padding: printMode ? 0 : (stacked ? STACK_PAD : 20),
        minWidth: 0, minHeight: 0,
      }}
    >
      {stacked ? stackedColumn : (
      <div style={{
        width: scale < 1 ? pageWidth * scale : pageWidth,
        minHeight: scale < 1 ? canvasHeight * scale : canvasHeight,
        margin: printMode ? 0 : '0 auto',
        overflow: 'visible',
      }}>
        <div
          ref={reportRef}
          style={{
            width: pageWidth,
            minWidth: pageWidth,
            minHeight: canvasHeight,
            transform: scale < 1 ? `scale(${scale})` : undefined,
            transformOrigin: 'top left',
            backgroundColor: settings.transparentBg ? 'transparent' : (settings.backgroundColor || 'var(--bg-canvas)'),
            backgroundImage: !settings.transparentBg && settings.backgroundImage ? `url(${settings.backgroundImage})` : 'none',
            backgroundSize: settings.backgroundSize || 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: settings.backgroundSize === 'repeat' ? 'repeat' : 'no-repeat',
            borderRadius: settings.borderRadius ?? 8,
            boxShadow: (settings.showShadow ?? true) ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            border: (settings.showBorder ?? true) ? undefined : 'none',
            position: 'relative',
          }}
        >
        {/* Grid overlay */}
        {settings.showGrid && !readOnly && (
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            backgroundImage: `linear-gradient(rgba(0,0,0,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.05) 1px, transparent 1px)`,
            backgroundSize: `${settings.gridSize || 20}px ${settings.gridSize || 20}px`,
            pointerEvents: 'none', zIndex: 0, borderRadius: settings.borderRadius ?? 8,
          }} />
        )}
        {/* Seam-merge model: NO bounding-box backdrop — each merged
            member keeps its own size/frame; the shared border between
            two members is dropped (per-edge, in WidgetItem). */}
        {layout.map((item) => {
          const widget = widgets[item.i];
          if (!widget) return null;
          if (!WIDGET_TYPES[widget.type]) return null;

          // Show the Edit Interactions overlay on every widget except the
          // currently-selected source. The overlay reads the source's
          // exclusions to render its filter / off state. Source can be either
          // the selected widget (cross-filter / slicer) or a global filter
          // rule (settings.reportFilters[idx]) — the latter wins when set.
          const ruleSource = editInteractions && interactionsRule ? interactionsRule : null;
          const editInteractionsActive = ruleSource
            ? true
            : (editInteractions && selectedWidget && selectedWidget !== item.i);
          let isExcludedFromSource = false;
          if (ruleSource) {
            const excl = Array.isArray(ruleSource.exclusions) ? ruleSource.exclusions : [];
            isExcludedFromSource = excl.includes(item.i);
          } else {
            const sourceWidget = selectedWidget ? widgets[selectedWidget] : null;
            const sourceExclusions = sourceWidget?.config?.crossFilterExclusions || [];
            isExcludedFromSource = sourceExclusions.includes(item.i);
          }

          return (
            <WidgetItem
              key={item.i}
              item={item}
              widget={widget}
              isSelected={selectedWidget === item.i}
              readOnly={readOnly}
              onSelect={onSelectWidget}
              onDrag={handleDrag}
              onDragStop={handleDragStop}
              onStartResize={startResize}
              onAutoHeight={handleAutoHeight}
              onLoadMore={onLoadMore}
              onWidgetUpdate={onWidgetUpdate}
              onSlicerFilter={onSlicerFilter}
              onSlicerSearch={onSlicerSearch}
              onCrossFilter={onCrossFilter}
              onDrillUp={onDrillUp}
              onDrillReset={onDrillReset}
              crossHighlight={crossHighlight}
              snapGrid={snapGrid}
              scale={scale}
              reportFilters={reportFilters}
              editInteractionsActive={editInteractionsActive}
              isExcludedFromSource={isExcludedFromSource}
              onToggleCrossFilter={onToggleCrossFilter}
              onCancelFetch={onCancelFetch}
              onRefreshWidget={onRefreshWidget}
              refreshKind={refreshKind}
              mergeCorners={mergedGidById[item.i]
                ? mergeCorners(item, mergeGroups[mergedGidById[item.i]] || [])
                : null}
            />
          );
        })}
        {/* Seam covers: each merged member keeps its FULL frame; we only
            mask the exact touching segment (doubled border + rounded-
            corner nubs) so the parts that don't touch keep their border
            and rounding. When the group's separator is on, a single thin
            line is drawn over the seam instead. */}
        {Object.values(mergeGroups).map((items, gi) => {
          const sep = items.some((it) => widgets[it.i]?.config?.mergeSeparator);
          const inGroupSelected = !readOnly && selectedWidget && items.some((it) => it.i === selectedWidget);
          const COVER = 6; // masks 1px border on each side + radius nubs
          return groupSeams(items).map((s, k) => {
            const inset = Math.max(6, Math.min(16, s.length * 0.12));
            const lineLen = Math.max(2, s.length - 2 * inset);
            const capCss = '1px solid var(--border-default)';
            // At an end that is NOT an aligned outer corner (a concave
            // L-corner: one widget terminates there, the other goes on)
            // pull the cover back ~2px so the two widgets' own kept
            // borders meet cleanly at the corner instead of leaving a
            // 1px hole. Aligned ends keep the continuity cap.
            const PULL = 2;
            // On-canvas action cluster at the seam midpoint (rendered
            // only when the selected widget is in this group). Two
            // affordances: broken-magnet → unmerge ; line → toggle the
            // separator line. Hover-revealed: the cluster fades in
            // when the cursor enters the seam trigger zone OR the
            // cluster itself; fades back out on leave. Same pattern
            // as the merge magnet so the canvas stays clean by default.
            const midX = s.vertical ? s.x : s.x + s.length / 2;
            const midY = s.vertical ? s.y + s.length / 2 : s.y;
            const iconBtnBase = {
              width: 22, height: 22, padding: 0, border: 'none', borderRadius: 11,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            };
            // Cluster oriented along the seam: vertical seam → buttons
            // stacked (pill is tall); horizontal seam → buttons side by
            // side (pill is wide). Keeps the affordance compact along
            // the actual junction.
            const clusterStyle = s.vertical
              ? { left: midX - 13, top: midY - 28, width: 26, height: 56, flexDirection: 'column', padding: '2px 0' }
              : { left: midX - 28, top: midY - 13, width: 56, height: 26, flexDirection: 'row', padding: '0 2px' };
            const seamKey = `seam-${gi}-${k}`;
            const isSeamHovered = hoveredSeamKey === seamKey;
            const onSeamEnter = () => setHoveredSeamKey(seamKey);
            const onSeamLeave = () => setHoveredSeamKey((cur) => (cur === seamKey ? null : cur));
            const cluster = inGroupSelected ? (
              <div
                onMouseEnter={onSeamEnter}
                onMouseLeave={onSeamLeave}
                style={{
                  position: 'absolute',
                  ...clusterStyle,
                  borderRadius: 13,
                  background: 'var(--bg-panel)',
                  border: '1px solid var(--border-default)',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.18)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  gap: 2,
                  zIndex: 60,
                  opacity: isSeamHovered ? 1 : 0,
                  // Block clicks while invisible so a stray pointer
                  // event on the (still-laid-out) cluster doesn't fire
                  // unmerge/separator-toggle when the user can't see
                  // the buttons. Hover state re-enables it.
                  pointerEvents: isSeamHovered ? 'auto' : 'none',
                  transition: 'opacity 0.12s',
                }}>
                <button
                  title="Unmerge frames"
                  onClick={(e) => { e.stopPropagation(); onUnmerge?.(); }}
                  onMouseDown={(e) => e.stopPropagation()}
                  style={{ ...iconBtnBase, background: 'transparent', color: 'var(--text-secondary)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--state-danger)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
                >
                  <TbMagnetOff size={13} />
                </button>
                <button
                  title={sep ? 'Hide separator' : 'Show separator'}
                  onClick={(e) => { e.stopPropagation(); onToggleSeparator?.(); }}
                  onMouseDown={(e) => e.stopPropagation()}
                  style={{
                    ...iconBtnBase,
                    background: sep ? 'var(--accent-primary)' : 'transparent',
                    color: sep ? '#fff' : 'var(--text-secondary)',
                  }}
                  onMouseEnter={(e) => { if (!sep) { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--accent-primary)'; } }}
                  onMouseLeave={(e) => { if (!sep) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; } }}
                >
                  <TbMinus size={14} />
                </button>
              </div>
            ) : null;

            // Hover-trigger strip: 14px-thick band straddling the seam,
            // spanning the entire seam length. Lets the user approach
            // the cluster from anywhere on the junction. Only rendered
            // when the selection is inside the group (otherwise the
            // cluster wouldn't exist anyway).
            const HOVER_THICK = 14;
            const triggerStyle = s.vertical
              ? { left: s.x - HOVER_THICK / 2, top: s.y, width: HOVER_THICK, height: s.length }
              : { left: s.x, top: s.y - HOVER_THICK / 2, width: s.length, height: HOVER_THICK };
            const trigger = inGroupSelected ? (
              <div
                onMouseEnter={onSeamEnter}
                onMouseLeave={onSeamLeave}
                style={{ position: 'absolute', ...triggerStyle, zIndex: 55, pointerEvents: 'auto' }}
              />
            ) : null;

            if (s.vertical) {
              const ti = s.capStart ? 0 : PULL;
              const bi = s.capEnd ? 0 : PULL;
              return (
                <Fragment key={seamKey}>
                  <div style={{
                    position: 'absolute', left: s.x - COVER / 2, top: s.y + ti,
                    width: COVER, height: Math.max(1, s.length - ti - bi),
                    background: 'var(--bg-panel)',
                    borderTop: s.capStart ? capCss : 'none',
                    borderBottom: s.capEnd ? capCss : 'none',
                    boxSizing: 'border-box',
                    zIndex: 50, pointerEvents: 'none',
                  }}>
                    {sep && <div style={{
                      position: 'absolute', left: COVER / 2 - 0.5, top: inset,
                      width: 1, height: lineLen, background: 'var(--border-default)',
                    }} />}
                  </div>
                  {trigger}
                  {cluster}
                </Fragment>
              );
            }
            const li = s.capStart ? 0 : PULL;
            const ri = s.capEnd ? 0 : PULL;
            return (
              <Fragment key={seamKey}>
                <div style={{
                  position: 'absolute', left: s.x + li, top: s.y - COVER / 2,
                  width: Math.max(1, s.length - li - ri), height: COVER,
                  background: 'var(--bg-panel)',
                  borderLeft: s.capStart ? capCss : 'none',
                  borderRight: s.capEnd ? capCss : 'none',
                  boxSizing: 'border-box',
                  zIndex: 50, pointerEvents: 'none',
                }}>
                  {sep && <div style={{
                    position: 'absolute', top: COVER / 2 - 0.5, left: inset,
                    height: 1, width: lineLen, background: 'var(--border-default)',
                  }} />}
                </div>
                {trigger}
                {cluster}
              </Fragment>
            );
          });
        })}
        {/* Magnet affordances at the junctions of the selected widget
            with its mergeable neighbours (edit mode only). The magnet
            is hover-revealed: an invisible trigger zone runs along
            the entire shared edge, the button fades in only when the
            cursor enters that strip. Keeps the canvas clean by
            default and matches the on-seam merged-cluster behaviour. */}
        {/* Floating z-order bar above the selected widget. Hidden during
            edit-interactions (that mode has its own per-widget overlays). */}
        {!readOnly && !editInteractions && selectedWidget && onBringToFront && (() => {
          const sel = layout.find((l) => l.i === selectedWidget);
          if (!sel || !widgets[selectedWidget]) return null;
          const BAR_H = 28;
          // Above the widget; when it touches the page top, BELOW it — never
          // inside, where it would sit on top of the widget's own title.
          const top = (sel.y || 0) >= BAR_H + 8
            ? (sel.y || 0) - BAR_H - 6
            : (sel.y || 0) + (sel.h || 0) + 6;
          const left = (sel.x || 0) + (sel.w || 0) / 2;
          const actions = [
            { title: 'Send to back', Icon: TbLayersSubtract, fn: onSendToBack },
            { title: 'Backward one', Icon: TbArrowBigDown, fn: onSendBackward },
            { title: 'Forward one', Icon: TbArrowBigUp, fn: onBringForward },
            { title: 'Bring to front', Icon: TbLayersLinked, fn: onBringToFront },
          ];
          return (
            <div
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              style={{ ...zOrderBar, top, left }}
            >
              {actions.map(({ title, Icon, fn }) => (
                <button key={title} className="btn-hover" title={title}
                  onClick={() => fn?.(selectedWidget)} style={zOrderBtn}>
                  <Icon size={13} />
                </button>
              ))}
            </div>
          );
        })()}

        {mergeMagnets.map((mag) => {
          const isHovered = hoveredMagnetId === mag.id;
          // Trigger zone — 12px thick (6 on each side of the seam),
          // covering the FULL overlap so the user can approach the
          // magnet from anywhere along the shared edge.
          const ZONE_THICK = 12;
          const zoneStyle = mag.vertical
            ? { left: mag.x - ZONE_THICK / 2, top: mag.start, width: ZONE_THICK, height: mag.length }
            : { left: mag.start, top: mag.y - ZONE_THICK / 2, width: mag.length, height: ZONE_THICK };
          // Magnet button offset INSIDE the zone — centred at the
          // edge midpoint (= zone centre line, mid of the overlap).
          const BTN = 26;
          const btnLeft = mag.vertical ? (ZONE_THICK - BTN) / 2 : (mag.length / 2 - BTN / 2);
          const btnTop = mag.vertical ? (mag.length / 2 - BTN / 2) : (ZONE_THICK - BTN) / 2;
          return (
            <div
              key={'magnet-zone-' + mag.id}
              onMouseEnter={() => setHoveredMagnetId(mag.id)}
              onMouseLeave={() => setHoveredMagnetId((cur) => (cur === mag.id ? null : cur))}
              style={{
                position: 'absolute',
                ...zoneStyle,
                zIndex: 55,
                pointerEvents: 'auto',
              }}
            >
              <button
                title="Merge these two frames"
                onClick={(e) => { e.stopPropagation(); onMergeWith?.(mag.id); }}
                onMouseDown={(e) => e.stopPropagation()}
                style={{
                  position: 'absolute',
                  left: btnLeft, top: btnTop,
                  width: BTN, height: BTN, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: 0, cursor: 'pointer',
                  background: 'var(--bg-panel)',
                  border: '1px solid var(--accent-primary)',
                  color: 'var(--accent-primary)',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.18)',
                  opacity: isHovered ? 1 : 0,
                  // Block clicks while invisible — a 0-opacity button
                  // still receives pointer events otherwise.
                  pointerEvents: isHovered ? 'auto' : 'none',
                  transition: 'opacity 0.12s, background 0.12s, transform 0.12s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent-primary)'; e.currentTarget.style.color = '#fff'; e.currentTarget.style.transform = 'scale(1.12)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-panel)'; e.currentTarget.style.color = 'var(--accent-primary)'; e.currentTarget.style.transform = 'scale(1)'; }}
              >
                <TbMagnet size={14} />
              </button>
            </div>
          );
        })}
        </div>
      </div>
      )}
    </div>
  );
}



// Floating z-order bar — pill of icon buttons pinned above the selection.
// High zIndex: layout `z` values grow unbounded as the user stacks widgets,
// so the bar must clear them all.
const zOrderBar = {
  position: 'absolute', transform: 'translateX(-50%)',
  display: 'flex', gap: 2, padding: 3, zIndex: 500,
  background: 'var(--bg-panel)', border: '1px solid var(--border-default)',
  borderRadius: 6, boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
};
const zOrderBtn = {
  width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 0, border: 'none', borderRadius: 4, background: 'transparent',
  color: 'var(--text-secondary)', cursor: 'pointer',
};
