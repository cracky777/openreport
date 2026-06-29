import { useRef, useState, useEffect, useCallback, memo, useMemo, Fragment } from 'react';
import { createPortal } from 'react-dom';
import Draggable from 'react-draggable';
import { TbCode, TbX, TbCopy, TbRefresh, TbMagnet, TbMagnetOff, TbMinus } from 'react-icons/tb';
import { WIDGET_TYPES } from '../Widgets';
import { fontStack, loadGoogleFont } from '../../utils/googleFonts';
import MaxRowsWarning from '../Widgets/MaxRowsWarning';
import { evaluateColorCondition } from '../../utils/conditionalFormat';
import { getMergeGroups, groupSeams, mergeCorners, edgeMidpoint } from '../../utils/mergeFrames';

function buildGradientCSS(g) {
  if (!g?.enabled) return null;
  return `linear-gradient(${g.angle ?? 180}deg, ${g.color1 || '#ffffff'}, ${g.color2 || '#e2e8f0'})`;
}

function buildShadowCSS(s) {
  if (!s?.enabled) return null;
  const angleRad = ((s.angle ?? 135) * Math.PI) / 180;
  const dist = (s.blur ?? 10) / 2;
  const x = Math.round(Math.cos(angleRad) * dist);
  const y = Math.round(Math.sin(angleRad) * dist);
  const inset = s.type === 'inner' ? 'inset ' : '';
  return `${inset}${x}px ${y}px ${s.blur ?? 10}px ${s.spread ?? 2}px ${s.color || 'rgba(0,0,0,0.15)'}`;
}

const WidgetItem = memo(function WidgetItem({ item, widget, isSelected, readOnly, onSelect, onDragStop, onStartResize, onAutoHeight, onLoadMore, onWidgetUpdate, onSlicerFilter, onSlicerSearch, onCrossFilter, onDrillUp, onDrillReset, crossHighlight, snapGrid, reportFilters, editInteractionsActive, isExcludedFromSource, onToggleCrossFilter, onCancelFetch, onRefreshWidget, refreshKind, mergeCorners }) {
  const nodeRef = useRef(null);
  const [showSql, setShowSql] = useState(false);
  // Hover state for the in-flight cancel button — the X icon is hidden
  // by default so the spinner reads as "loading" rather than "error";
  // surfacing it only on hover keeps the cancel affordance discoverable
  // without the red glyph competing with the rotating ring at rest.
  const [cancelHover, setCancelHover] = useState(false);
  const WidgetType = WIDGET_TYPES[widget.type];
  if (!WidgetType) return null;

  const Component = WidgetType.component;
  const w = item.w || 400;
  const isAutoHeight = widget.type === 'table' && widget.config?.autoHeight;
  const h = isAutoHeight ? 'auto' : (item.h || 300);
  const titleHeight = widget.config?.title ? 30 : 0;
  // Filter widgets use tighter padding (4px vs 8px) for a more compact look.
  // Text widgets get zero so the configured alignment (left / centre / right
  // and top / middle / bottom) actually reaches the widget's outer edges
  // instead of being inset by an invisible 8 px frame.
  const contentPadding = widget.type === 'filter' ? 2 : (widget.type === 'text' ? 0 : 8);
  const paddingTotal = contentPadding * 2;
  const contentWidth = Math.max(50, (typeof w === 'number' ? w : 400) - paddingTotal);
  const contentHeight = Math.max(50, (typeof h === 'number' ? h : 300) - titleHeight - paddingTotal);

  // ── Frame chrome (bg / border / radius / shadow) ────────────────────
  // Seam-merge model: EVERY widget (merged or not) keeps its own full
  // frame — border + rounded corners everywhere, own size. Merging only
  // overlays a "seam cover" on the exact touching segment (rendered in
  // ReportCanvas), so the parts that don't touch keep their border and
  // rounding intact.
  const _bgValue = (() => {
    const cc = widget.config?.colorCondition;
    const cond = cc?.enabled ? evaluateColorCondition(cc, widget.data?._colorValue) : null;
    if (cond) return cond;
    // Image widgets default to a transparent background (same fallback as
    // filter / slicer widgets) so the uploaded image sits on the canvas
    // without an opaque white panel framing it.
    const defaultTransparent = widget.type === 'filter' || widget.type === 'image';
    return (widget.config?.transparentBg ?? defaultTransparent)
      ? 'transparent'
      : (buildGradientCSS(widget.config?.gradientBg) || widget.config?.backgroundColor || 'var(--bg-panel)');
  })();
  // Border off by default for image widgets — let the picture be the picture;
  // every other widget keeps "border on" as the default chrome.
  const _hasBorder = widget.config?.borderEnabled ?? (widget.type !== 'image');
  const _borderColor = widget.config?.borderColor || 'var(--border-default)';
  const _baseRadius = (widget.type === 'shape' && widget.config?.shape === 'round')
    ? '50%' : (widget.config?.borderRadius ?? 8);
  // Per-corner radius: a corner that sits exactly at a merge junction is
  // squared (→ continuous frame at the seam); every other corner keeps
  // its rounding. Border stays full everywhere; the seam cover (rendered
  // in ReportCanvas) masks the doubled border on the touching segment.
  const _r = (squared) => (squared ? 0 : _baseRadius);
  const mc = mergeCorners || null;
  const frameChrome = {
    background: _bgValue,
    borderTopLeftRadius: mc ? _r(mc.tl) : _baseRadius,
    borderTopRightRadius: mc ? _r(mc.tr) : _baseRadius,
    borderBottomRightRadius: mc ? _r(mc.br) : _baseRadius,
    borderBottomLeftRadius: mc ? _r(mc.bl) : _baseRadius,
    border: isSelected
      ? '1px solid var(--accent-primary)'
      : (_hasBorder ? `1px solid ${_borderColor}` : 'none'),
    boxShadow: [
      // Light "selected" halo — a single faded violet ring instead of the
      // earlier 3px solid-violet glow which felt too heavy on the canvas.
      isSelected ? '0 0 0 1px rgba(124,58,237,0.18)' : null,
      buildShadowCSS(widget.config?.shadow),
      !isSelected && !widget.config?.shadow?.enabled && _hasBorder ? '0 1px 3px rgba(0,0,0,0.05)' : null,
    ].filter(Boolean).join(', ') || 'none',
  };

  return (
    <Draggable
      nodeRef={nodeRef}
      position={{ x: item.x || 0, y: item.y || 0 }}
      onStop={(e, data) => onDragStop(item.i, data)}
      disabled={readOnly}
      cancel=".widget-content, .resize-handle"
      grid={snapGrid}
    >
      <div
        ref={nodeRef}
        onClick={(e) => {
          e.stopPropagation();
          onSelect?.(item.i);
        }}
        style={{
          position: 'absolute',
          width: w,
          height: h,
          zIndex: Math.max(1, item.z || 1),
          cursor: readOnly ? 'default' : 'move',
        }}
      >
        <div style={{
          width: '100%', height: '100%',
          transform: widget.config?.rotation ? `rotate(${widget.config.rotation}deg)` : undefined,
          transformOrigin: 'center center',
          ...frameChrome,
          overflow: widget.config?.shadow?.enabled ? 'visible' : 'hidden',
        }}>
        {widget.config?.title && (
          <div style={{
            padding: '8px 12px 0', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)',
            fontFamily: widget.config?.titleFontFamily ? fontStack(widget.config.titleFontFamily) : undefined,
          }}>
            {widget.config.title}
          </div>
        )}
        {/* Drag overlay: allows dragging from borders/edges of the widget */}
        {!readOnly && (
          <>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 8 + (widget.config?.title ? 30 : 0), cursor: 'move', zIndex: 2 }} />
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 8, cursor: 'move', zIndex: 2 }} />
            <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: 8, cursor: 'move', zIndex: 2 }} />
            <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 8, cursor: 'move', zIndex: 2 }} />
          </>
        )}
        <div className="widget-content" style={{
          // Override the project-wide `* { box-sizing: border-box }` for
          // this one node: contentWidth/contentHeight are computed as
          // `w - paddingTotal` and only make sense as the *content* size,
          // not the outer size. Without this override the widget-content
          // shrinks by 16 px and leaves a strip of empty space on the
          // right (and below) — visible as off-centre content inside an
          // otherwise correctly sized widget.
          boxSizing: 'content-box',
          padding: contentPadding,
          width: contentWidth,
          height: contentHeight,
          overflow: 'hidden',
          cursor: 'default',
        }}>
          <Component
            data={widget.data}
            config={widget.config}
            chartWidth={contentWidth}
            chartHeight={contentHeight}
            onAutoHeight={isAutoHeight ? (newH) => onAutoHeight(item.i, newH) : undefined}
            columnOrder={widget.dataBinding?.columnOrder}
            onLoadMore={widget.type === 'table' ? () => onLoadMore?.(item.i) : undefined}
            onConfigUpdate={onWidgetUpdate ? (key, val) => onWidgetUpdate(item.i, { ...widget, config: { ...widget.config, [key]: val } }) : undefined}
            // Parallel to onConfigUpdate but writes into widget.data — used
            // by TextWidget's inline editor so the typed text round-trips
            // into history (and so the same component renders read-only in
            // the Viewer, which doesn't wire this prop).
            onDataUpdate={onWidgetUpdate ? (key, val) => onWidgetUpdate(item.i, { ...widget, data: { ...widget.data, [key]: val } }) : undefined}
            onFilterChange={widget.type === 'filter' && onSlicerFilter ? (vals) => {
              const dimName = widget.dataBinding?.selectedDimensions?.[0];
              if (dimName) onSlicerFilter(item.i, dimName, vals);
            } : undefined}
            onSearchValues={widget.type === 'filter' && onSlicerSearch
              ? (term) => onSlicerSearch(item.i, term)
              : undefined}
            activeSelection={widget.type === 'filter' && reportFilters ? reportFilters[widget.dataBinding?.selectedDimensions?.[0]] : undefined}
            onDataClick={onCrossFilter ? (dimName, value) => onCrossFilter(item.i, dimName, value) : undefined}
            highlightValue={crossHighlight?.widgetId === item.i ? crossHighlight.value : null}
          />
        </div>

        {/* Loading spinner doubles as a Cancel button. The rotating ring
            colour reflects the kind of fetch that's actually in flight
            (cyan = planner / cache path, violet = live source query),
            read off `widget._loadingKind` which is stamped at fetch
            kick-off so it stays accurate per-cycle (a cross-filter
            after a cache rebuild reads 'cache' here, NOT 'live').
            The red X cancel glyph is shown only when the user hovers
            the spinner — at rest the widget reads "loading", on hover
            it offers the cancel affordance. Placed at top-left so it
            doesn't fight with the SQL / Refresh buttons in the top-right
            of selected widgets.
            When the widget is drilled (`_drillDepth > 0`), the drill
            up/reset toolbar also lands at top-left — slide the spinner
            down underneath it so the two don't overlap and the user can
            still see the loading state during a drill refetch. */}
        {widget._loading && (
          <div style={{
            position: 'absolute',
            top: widget.data?._drillDepth > 0 ? 32 : 6,
            left: 6,
            zIndex: 11,
          }}>
            {(() => {
              const ringStyle = {
                ...spinnerStyle,
                borderTopColor: widget._loadingKind === 'live' ? 'var(--accent-primary)' : 'var(--accent-cyan)',
              };
              return !readOnly && onCancelFetch ? (
                <button
                  onClick={(e) => { e.stopPropagation(); onCancelFetch(); }}
                  onMouseEnter={() => setCancelHover(true)}
                  onMouseLeave={() => setCancelHover(false)}
                  title="Cancel query"
                  style={{
                    position: 'relative', width: 18, height: 18, padding: 0,
                    border: 'none', background: 'transparent', cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <span style={ringStyle} />
                  {cancelHover && (
                    <TbX size={12} style={{
                      position: 'absolute', color: 'var(--state-danger)',
                    }} />
                  )}
                </button>
              ) : (
                <div style={ringStyle} />
              );
            })()}
          </div>
        )}

        {/* "View SQL" — small icon button on selected widgets that hit the
            query API. Opens a portal modal showing the raw SQL. Hidden in
            read-only mode, during Edit Interactions, and on widgets that
            don't query (text / shape / filter / custom visual). */}
        {isSelected && !readOnly && !editInteractionsActive
          && !['text', 'shape', 'filter', 'customVisual'].includes(widget.type) && (
          <button
            onClick={(e) => { e.stopPropagation(); setShowSql(true); }}
            title="View the SQL query"
            style={{
              position: 'absolute', top: 6, right: 6, zIndex: 11,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 24, height: 24, borderRadius: 12, padding: 0,
              border: '1px solid var(--border-default)', background: 'var(--bg-panel)',
              color: 'var(--text-secondary)', cursor: 'pointer',
              boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-primary)'; e.currentTarget.style.borderColor = 'var(--accent-primary)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'var(--border-default)'; }}
          >
            <TbCode size={14} />
          </button>
        )}
        {/* Refresh — explicit per-widget refetch. Sits right under the SQL
            button. Auto-fetch on click is disabled, so this is the way to
            trigger a fresh query without editing the binding. */}
        {isSelected && !readOnly && !editInteractionsActive
          && !['text', 'shape', 'filter', 'customVisual'].includes(widget.type) && onRefreshWidget && (
          <button
            onClick={(e) => { e.stopPropagation(); onRefreshWidget(item.i); }}
            title="Refresh this widget's data"
            style={{
              position: 'absolute', top: 36, right: 6, zIndex: 11,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 24, height: 24, borderRadius: 12, padding: 0,
              border: '1px solid var(--border-default)', background: 'var(--bg-panel)',
              color: 'var(--text-secondary)', cursor: 'pointer',
              boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-primary)'; e.currentTarget.style.borderColor = 'var(--accent-primary)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'var(--border-default)'; }}
          >
            <TbRefresh size={14} />
          </button>
        )}
        {showSql && createPortal(
          <SqlViewerModal sql={widget.data?._sql} onClose={() => setShowSql(false)} />,
          document.body,
        )}

        {/* Edit Interactions overlay — appears on every non-source widget while
            the user is configuring which targets a click on the source filters. */}
        {editInteractionsActive && onToggleCrossFilter && (
          <div
            onClick={(e) => { e.stopPropagation(); onToggleCrossFilter(item.i); }}
            style={{
              position: 'absolute', top: 6, right: 6, zIndex: 12,
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '4px 8px', borderRadius: 16, fontSize: 11, fontWeight: 600,
              background: isExcludedFromSource ? 'var(--bg-panel)' : 'var(--accent-primary)',
              color: isExcludedFromSource ? 'var(--text-secondary)' : '#fff',
              border: `1px solid ${isExcludedFromSource ? 'var(--border-default)' : 'var(--accent-primary)'}`,
              cursor: 'pointer', userSelect: 'none',
              boxShadow: '0 2px 6px rgba(0,0,0,0.12)',
            }}
            title={isExcludedFromSource ? 'Click to enable cross-filter from the selected widget' : 'Click to disable cross-filter from the selected widget'}
          >
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: isExcludedFromSource ? 'var(--text-disabled)' : '#fff' }} />
            {isExcludedFromSource ? 'None' : 'Filter'}
          </div>
        )}

        {/* Drill-down controls (up / reset) — shown when widget has an active drill path */}
        {widget.data?._drillDepth > 0 && (onDrillUp || onDrillReset) && (
          <div style={{
            position: 'absolute', top: 6, left: 6, zIndex: 11,
            display: 'flex', gap: 2, pointerEvents: 'auto',
          }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {onDrillUp && (
              <button
                title="Drill up"
                onClick={(e) => { e.stopPropagation(); onDrillUp(item.i); }}
                style={drillBtnStyle}
              >↑</button>
            )}
            {onDrillReset && (
              <button
                title="Reset drill"
                onClick={(e) => { e.stopPropagation(); onDrillReset(item.i); }}
                style={drillBtnStyle}
              >⟲</button>
            )}
          </div>
        )}

        {/* Max rows warning */}
        {widget.data?._maxReached && <MaxRowsWarning />}

        {/* Query error overlay — shown when the widget's last fetch failed.
            Timeout has its own warning style so the user knows to either
            simplify the query or ask the admin to raise the limit. */}
        {widget.data?._error && !widget._loading && widget.type !== 'text' && widget.type !== 'shape' && (() => {
          const isTimeout = widget.data?._errorCode === 'TIMEOUT';
          const timeoutS = widget.data?._errorTimeoutMs ? Math.round(widget.data._errorTimeoutMs / 1000) : null;
          const accent = isTimeout ? 'var(--state-warning)' : 'var(--state-danger)';
          const bg = isTimeout ? 'var(--state-warning-soft)' : 'var(--state-danger-soft)';
          return (
            <div style={{
              position: 'absolute', inset: 0, zIndex: 6,
              background: bg,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              padding: 16, textAlign: 'center', gap: 6,
              borderRadius: 'inherit', pointerEvents: 'none',
            }}>
              <div style={{ fontSize: 22 }}>{isTimeout ? '⏱️' : '⚠️'}</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: accent }}>
                {isTimeout ? 'Query timed out' : 'Data error'}
              </div>
              <div style={{ fontSize: 11, color: accent, maxWidth: 280, lineHeight: 1.4, wordBreak: 'break-word' }}>
                {isTimeout
                  ? `Cancelled after ${timeoutS ?? '?'}s.`
                  : widget.data._error}
              </div>
              <div style={{ fontSize: 10, color: accent, marginTop: 4 }}>
                {isTimeout
                  ? 'Simplify the query, add filters, or ask an admin to raise the timeout.'
                  : 'Check the model — a referenced field may have been removed or renamed.'}
              </div>
            </div>
          );
        })()}
        </div>{/* end rotation wrapper */}

        {/* Resize handles — all edges and corners, only when selected */}
        {!readOnly && isSelected && (
          <>
            {/* Edges */}
            <div className="resize-handle" onMouseDown={(e) => onStartResize(e, item.i, 'n')}
              style={{ position: 'absolute', top: -3, left: 6, right: 6, height: 6, cursor: 'n-resize', zIndex: 10 }} />
            <div className="resize-handle" onMouseDown={(e) => onStartResize(e, item.i, 's')}
              style={{ position: 'absolute', bottom: -3, left: 6, right: 6, height: 6, cursor: 's-resize', zIndex: 10 }} />
            <div className="resize-handle" onMouseDown={(e) => onStartResize(e, item.i, 'w')}
              style={{ position: 'absolute', left: -3, top: 6, bottom: 6, width: 6, cursor: 'w-resize', zIndex: 10 }} />
            <div className="resize-handle" onMouseDown={(e) => onStartResize(e, item.i, 'e')}
              style={{ position: 'absolute', right: -3, top: 6, bottom: 6, width: 6, cursor: 'e-resize', zIndex: 10 }} />
            {/* Corners */}
            <div className="resize-handle" onMouseDown={(e) => onStartResize(e, item.i, 'nw')}
              style={{ position: 'absolute', top: -3, left: -3, width: 8, height: 8, cursor: 'nw-resize', zIndex: 11 }} />
            <div className="resize-handle" onMouseDown={(e) => onStartResize(e, item.i, 'ne')}
              style={{ position: 'absolute', top: -3, right: -3, width: 8, height: 8, cursor: 'ne-resize', zIndex: 11 }} />
            <div className="resize-handle" onMouseDown={(e) => onStartResize(e, item.i, 'sw')}
              style={{ position: 'absolute', bottom: -3, left: -3, width: 8, height: 8, cursor: 'sw-resize', zIndex: 11 }} />
            <div className="resize-handle" onMouseDown={(e) => onStartResize(e, item.i, 'se')}
              style={{ position: 'absolute', bottom: -3, right: -3, width: 8, height: 8, cursor: 'se-resize', zIndex: 11 }} />
          </>
        )}
      </div>
    </Draggable>
  );
});

export default function ReportCanvas({
  layout,
  widgets,
  selectedWidget,
  onLayoutChange,
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
    const update = () => setContainerSize({ w: el.clientWidth - 40, h: el.clientHeight - 40 });
    update(); // Initial measurement
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pageWidth = settings.pageWidth || 1140;
  const pageHeight = settings.pageHeight || 800;
  const viewMode = settings.viewMode || 'fitToWidth';

  const canvasHeight = pageHeight;

  const scale = useMemo(() => {
    if (printMode) return 1;
    if (viewMode === 'actual' || containerSize.w <= 0) return 1;
    if (viewMode === 'fitToWidth') return Math.min(1, containerSize.w / pageWidth);
    if (viewMode === 'fitToPage') return Math.min(1, containerSize.w / pageWidth, containerSize.h / canvasHeight);
    return 1;
  }, [viewMode, containerSize, pageWidth, canvasHeight, printMode]);

  const gridSize = (settings.snapToGrid ?? true) ? (settings.gridSize || 20) : 1;
  const snap = useCallback((v) => Math.round(v / gridSize) * gridSize, [gridSize]);
  const snapGrid = (settings.snapToGrid ?? true) ? [gridSize, gridSize] : undefined;

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

  const handleDragStop = useCallback((id, data) => {
    const it = layout.find((l) => l.i === id);
    const nx = Math.max(0, snap(data.x));
    const ny = Math.max(0, snap(data.y));
    const gid = mergedGidById[id];
    if (gid && it) {
      // Solid block: translate every member by the same delta so a merged
      // group stays contiguous (chosen behaviour: "bloc solidaire").
      const dx = nx - (it.x || 0);
      const dy = ny - (it.y || 0);
      const memberIds = new Set((mergeGroups[gid] || []).map((m) => m.i));
      onLayoutChange(layout.map((l) => memberIds.has(l.i)
        ? { ...l, x: Math.max(0, (l.x || 0) + dx), y: Math.max(0, (l.y || 0) + dy) }
        : l));
      return;
    }
    onLayoutChange(layout.map((item) =>
      item.i === id ? { ...item, x: nx, y: ny } : item
    ));
  }, [layout, onLayoutChange, snap, mergedGidById, mergeGroups]);

  const handleAutoHeight = useCallback((id, newH) => {
    onLayoutChange(layout.map((item) =>
      item.i === id ? { ...item, h: newH } : item
    ));
  }, [layout, onLayoutChange]);

  useEffect(() => {
    if (!resizing) return;
    const { dir } = resizing;

    const handleMouseMove = (e) => {
      const dx = e.clientX - resizing.startX;
      const dy = e.clientY - resizing.startY;
      const updates = {};

      // Width changes (snap to grid)
      if (dir.includes('e')) updates.w = Math.max(80, snap(resizing.startW + dx));
      if (dir.includes('w')) { updates.w = Math.max(80, snap(resizing.startW - dx)); updates.x = snap(resizing.startPosX + dx); if (updates.w <= 80) updates.x = resizing.startPosX + resizing.startW - 80; }

      // Height changes (snap to grid)
      if (dir.includes('s')) updates.h = Math.max(40, snap(resizing.startH + dy));
      if (dir.includes('n')) { updates.h = Math.max(40, snap(resizing.startH - dy)); updates.y = snap(resizing.startPosY + dy); if (updates.h <= 40) updates.y = resizing.startPosY + resizing.startH - 40; }

      onLayoutChange(layout.map((item) =>
        item.i === resizing.id ? { ...item, ...updates } : item
      ));
    };

    const handleMouseUp = () => setResizing(null);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizing, layout, onLayoutChange]);

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

  return (
    <div
      ref={containerRef}
      onClick={() => onSelectWidget?.(null)}
      style={{
        flex: 1,
        backgroundColor: printMode ? 'transparent' : 'var(--bg-app)',
        overflowX: 'hidden',
        overflowY: viewMode === 'fitToPage' || printMode ? 'hidden' : 'auto',
        padding: printMode ? 0 : 20,
        minWidth: 0, minHeight: 0,
      }}
    >
      {/* Scale wrapper — takes the visual size in the layout */}
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
    </div>
  );
}

const spinnerStyle = {
  width: 16,
  height: 16,
  border: '2px solid #e2e8f0',
  borderTopColor: 'var(--accent-primary)',
  borderRadius: '50%',
  animation: 'spin 0.8s linear infinite',
};

const drillBtnStyle = {
  width: 22, height: 22, padding: 0, lineHeight: 1,
  fontSize: 13, fontWeight: 600,
  color: 'var(--text-secondary)', background: 'var(--bg-panel)',
  border: '1px solid var(--border-default)', borderRadius: 4,
  cursor: 'pointer', boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
};

function SqlViewerModal({ sql, onClose }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(sql || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked — silently ignore */ }
  };
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: 'var(--bg-panel)', border: '1px solid var(--border-default)', borderRadius: 10,
        width: 'min(720px, 92vw)', maxHeight: '80vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
      }}>
        <div style={{
          padding: '12px 14px', borderBottom: '1px solid var(--border-default)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>SQL query</span>
          <span style={{ flex: 1 }} />
          <button onClick={handleCopy} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '5px 10px', fontSize: 12, fontWeight: 500,
            background: copied ? 'var(--state-success-soft)' : 'var(--bg-subtle)',
            color: copied ? 'var(--state-success)' : 'var(--text-secondary)',
            border: '1px solid var(--border-default)', borderRadius: 6, cursor: 'pointer',
          }}>
            <TbCopy size={13} />
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button onClick={onClose} style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 26, height: 26, padding: 0, borderRadius: 6,
            background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-disabled)',
          }}>
            <TbX size={14} />
          </button>
        </div>
        <pre style={{
          margin: 0, padding: 14, overflow: 'auto', flex: 1,
          fontSize: 12, lineHeight: 1.5,
          fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
          color: 'var(--text-primary)', background: 'var(--bg-subtle)',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          {sql || '(no SQL captured for this widget)'}
        </pre>
      </div>
    </div>
  );
}
