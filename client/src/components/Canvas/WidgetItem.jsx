import { memo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Draggable from 'react-draggable';
import { TbCode, TbCopy, TbRefresh, TbX, TbBug } from 'react-icons/tb';
import { WIDGET_TYPES } from '../Widgets';
import { fontStack } from '../../utils/googleFonts';
import MaxRowsWarning from '../Widgets/MaxRowsWarning';
import { evaluateColorCondition } from '../../utils/conditionalFormat';
import { useBugReport } from '../BugReport/BugReportProvider';

// A single positioned/draggable widget on the report canvas: chrome (border,
// gradient, shadow), the widget body, loading spinner, drill controls, the SQL
// viewer modal and the query-error overlay. Extracted verbatim from
// ReportCanvas.jsx (LOT 6.3) with its private helpers/styles/SqlViewerModal.
// NB: `mergeCorners` is a PROP here (the frame-merge corner geometry), not the
// mergeFrames import — which is intentionally NOT imported in this file.

const _hs0 = { position: 'absolute', bottom: 0, left: 0, right: 0, height: 8, cursor: 'move', zIndex: 2 };
const _hs1 = { position: 'absolute', top: 0, left: 0, bottom: 0, width: 8, cursor: 'move', zIndex: 2 };
const _hs2 = { position: 'absolute', top: 0, right: 0, bottom: 0, width: 8, cursor: 'move', zIndex: 2 };
const _hs3 = {
                    position: 'relative', width: 18, height: 18, padding: 0,
                    border: 'none', background: 'transparent', cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  };
const _hs4 = {
                      position: 'absolute', color: 'var(--state-danger)',
                    };
const _hs5 = {
              position: 'absolute', top: 6, right: 6, zIndex: 11,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 24, height: 24, borderRadius: 12, padding: 0,
              border: '1px solid var(--border-default)', background: 'var(--bg-panel)',
              color: 'var(--text-secondary)', cursor: 'pointer',
              boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
            };
const _hs6 = {
              position: 'absolute', top: 36, right: 6, zIndex: 11,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 24, height: 24, borderRadius: 12, padding: 0,
              border: '1px solid var(--border-default)', background: 'var(--bg-panel)',
              color: 'var(--text-secondary)', cursor: 'pointer',
              boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
            };
const _hs7 = {
            position: 'absolute', top: 6, left: 6, zIndex: 11,
            display: 'flex', gap: 2, pointerEvents: 'auto',
          };
const _hs8 = { fontSize: 22 };
const _hs9 = { position: 'absolute', top: -3, left: 6, right: 6, height: 6, cursor: 'n-resize', zIndex: 10 };
const _hs10 = { position: 'absolute', bottom: -3, left: 6, right: 6, height: 6, cursor: 's-resize', zIndex: 10 };
const _hs11 = { position: 'absolute', left: -3, top: 6, bottom: 6, width: 6, cursor: 'w-resize', zIndex: 10 };
const _hs12 = { position: 'absolute', right: -3, top: 6, bottom: 6, width: 6, cursor: 'e-resize', zIndex: 10 };
const _hs13 = { position: 'absolute', top: -3, left: -3, width: 8, height: 8, cursor: 'nw-resize', zIndex: 11 };
const _hs14 = { position: 'absolute', top: -3, right: -3, width: 8, height: 8, cursor: 'ne-resize', zIndex: 11 };
const _hs15 = { position: 'absolute', bottom: -3, left: -3, width: 8, height: 8, cursor: 'sw-resize', zIndex: 11 };
const _hs16 = { position: 'absolute', bottom: -3, right: -3, width: 8, height: 8, cursor: 'se-resize', zIndex: 11 };
const _hs17 = {
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    };
const _hs18 = {
        background: 'var(--bg-panel)', border: '1px solid var(--border-default)', borderRadius: 10,
        width: 'min(720px, 92vw)', maxHeight: '80vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
      };
const _hs19 = {
          padding: '12px 14px', borderBottom: '1px solid var(--border-default)',
          display: 'flex', alignItems: 'center', gap: 10,
        };
const _hs20 = { fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' };
const _hs21 = { flex: 1 };
const _hs22 = {
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 26, height: 26, padding: 0, borderRadius: 6,
            background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-disabled)',
          };
const _hs23 = {
          margin: 0, padding: 14, overflow: 'auto', flex: 1,
          fontSize: 12, lineHeight: 1.5,
          fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
          color: 'var(--text-primary)', background: 'var(--bg-subtle)',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        };

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

const WidgetItem = memo(function WidgetItem({ item, widget, isSelected, readOnly, onSelect, onDrag, onDragStop, onStartResize, onAutoHeight, onLoadMore, onWidgetUpdate, onSlicerFilter, onSlicerSearch, onCrossFilter, onDrillUp, onDrillReset, crossHighlight, snapGrid, scale = 1, reportFilters, editInteractionsActive, isExcludedFromSource, onToggleCrossFilter, onCancelFetch, onRefreshWidget, mergeCorners, stacked }) {
  const openBugReport = useBugReport();
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
      onDrag={(e, data) => onDrag?.(item.i, data)}
      onStop={(e, data) => onDragStop(item.i, data)}
      disabled={readOnly}
      cancel=".widget-content, .resize-handle"
      grid={snapGrid}
      // The canvas is a fixed page scaled down to fit (`fitToWidth`, the
      // default), so a pointer that travels 100px on screen has travelled
      // 100/scale page pixels. Without this the widget was moved by the RAW
      // delta and lagged the cursor by (1 - scale) of the distance: the visual
      // no longer followed the mouse, and on a long move the cursor ended up
      // outside it — so the click that closes the gesture landed on the canvas,
      // which deselects, and the configuration bar vanished on drop.
      scale={scale}
    >
      <div
        ref={nodeRef}
        onClick={(e) => {
          e.stopPropagation();
          onSelect?.(item.i);
        }}
        style={{
          // Stacked (small-screen) mode flows the widgets in a column:
          // the item's x/y are meaningless there, the frame just takes
          // its slot. Absolute everywhere else (the pixel canvas).
          position: stacked ? 'relative' : 'absolute',
          flexShrink: 0,
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
            <div style={_hs0} />
            <div style={_hs1} />
            <div style={_hs2} />
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
                  style={_hs3}
                >
                  <span style={ringStyle} />
                  {cancelHover && (
                    <TbX size={12} style={_hs4} />
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
            style={_hs5}
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
            style={_hs6}
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
          <div style={_hs7}
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
              <div style={_hs8}>{isTimeout ? '⏱️' : '⚠️'}</div>
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
              {/* La surcouche est en pointerEvents:none pour laisser passer la
                  sélection du widget ; seul ce bouton la réactive. C'est le
                  signalement qui vaut : il part d'ici avec le message du moteur,
                  le type de visuel et les champs liés — la différence entre
                  « le graphique est cassé » et une cause nommée. */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  openBugReport({
                    Widget: widget.title || widget.name || item.i,
                    'Widget type': widget.type,
                    Error: widget.data?._error,
                    'Error code': widget.data?._errorCode,
                    Dimensions: (widget.dataBinding?.selectedDimensions || []).join(', '),
                    Measures: (widget.dataBinding?.selectedMeasures || []).join(', '),
                  });
                }}
                style={{
                  pointerEvents: 'auto', marginTop: 8, padding: '4px 10px', borderRadius: 5,
                  border: '1px solid ' + accent, background: 'transparent', color: accent,
                  font: 'inherit', fontSize: 11, cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                }}
              >
                <TbBug size={12} /> Report this
              </button>
            </div>
          );
        })()}

        </div>{/* end rotation wrapper */}

        {/* Resize handles — all edges and corners, only when selected */}
        {!readOnly && isSelected && (
          <>
            {/* Edges */}
            <div className="resize-handle" onMouseDown={(e) => onStartResize(e, item.i, 'n')}
              style={_hs9} />
            <div className="resize-handle" onMouseDown={(e) => onStartResize(e, item.i, 's')}
              style={_hs10} />
            <div className="resize-handle" onMouseDown={(e) => onStartResize(e, item.i, 'w')}
              style={_hs11} />
            <div className="resize-handle" onMouseDown={(e) => onStartResize(e, item.i, 'e')}
              style={_hs12} />
            {/* Corners */}
            <div className="resize-handle" onMouseDown={(e) => onStartResize(e, item.i, 'nw')}
              style={_hs13} />
            <div className="resize-handle" onMouseDown={(e) => onStartResize(e, item.i, 'ne')}
              style={_hs14} />
            <div className="resize-handle" onMouseDown={(e) => onStartResize(e, item.i, 'sw')}
              style={_hs15} />
            <div className="resize-handle" onMouseDown={(e) => onStartResize(e, item.i, 'se')}
              style={_hs16} />
          </>
        )}
      </div>
    </Draggable>
  );
});

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
    <div onClick={onClose} style={_hs17}>
      <div onClick={(e) => e.stopPropagation()} style={_hs18}>
        <div style={_hs19}>
          <span style={_hs20}>SQL query</span>
          <span style={_hs21} />
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
          <button onClick={onClose} style={_hs22}>
            <TbX size={14} />
          </button>
        </div>
        <pre style={_hs23}>
          {sql || '(no SQL captured for this widget)'}
        </pre>
      </div>
    </div>
  );
}

export default WidgetItem;
