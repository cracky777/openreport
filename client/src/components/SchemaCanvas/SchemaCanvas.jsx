import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import api from '../../utils/api';

const _hs0 = {
          position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
          zIndex: 20, display: 'flex', alignItems: 'center', gap: 8,
          background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8,
          padding: '10px 16px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          animation: 'fadeIn 0.2s ease',
        };
const _hs1 = {
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 22, height: 22, borderRadius: '50%',
            background: '#dc2626', color: '#fff', fontSize: 13, fontWeight: 700,
            flexShrink: 0,
          };
const _hs2 = { fontSize: 12, color: '#991b1b', fontWeight: 500 };
const _hs3 = {
            background: 'transparent', border: '1px solid transparent', cursor: 'pointer',
            color: 'var(--state-danger)', fontSize: 16, padding: '2px 6px', lineHeight: 1, flexShrink: 0,
            borderRadius: 4,
          };
const _hs4 = { position: 'absolute', bottom: 12, right: 12, zIndex: 10, display: 'flex', gap: 4, background: 'var(--bg-panel)', borderRadius: 6, boxShadow: '0 1px 4px rgba(0,0,0,0.12)', padding: 4 };
const _hs5 = { fontSize: 11, padding: '4px 6px', color: 'var(--text-muted)', minWidth: 36, textAlign: 'center' };
const _hs6 = { width: '100%', height: '100%' };
const _hs7 = { cursor: 'pointer' };
const _hs8 = { pointerEvents: 'none' };
const _hs9 = { cursor: 'pointer' };
const _hs10 = { pointerEvents: 'none' };
const _hs11 = { cursor: 'move' };
const _hs12 = { pointerEvents: 'none' };
const _hs13 = { pointerEvents: 'none' };
const _hs14 = { pointerEvents: 'none' };
const _hs15 = { cursor: 'pointer' };
const _hs16 = { cursor: 'pointer' };
const _hs17 = { pointerEvents: 'none' };
const _hs18 = { cursor: 'pointer' };
const _hs19 = { cursor: 'pointer' };
const _hs20 = { pointerEvents: 'none' };
const _hs21 = { cursor: 'pointer' };
const _hs22 = { cursor: 'pointer' };
const _hs23 = { pointerEvents: 'none' };
const _hs24 = { cursor: 'pointer' };
const _hs25 = { cursor: 'pointer' };
const _hs26 = { cursor: 'crosshair' };
const _hs27 = { cursor: 'crosshair' };
const _hs28 = { cursor: 'pointer' };
const _hs29 = { position: 'fixed', inset: 0, zIndex: 50 };
const _hs30 = { fontWeight: 600, marginBottom: 4, color: 'var(--text-primary)' };
const _hs31 = { fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 };
const _hs32 = {
                    width: '100%', padding: '4px 6px',
                    border: '1px solid var(--border-default)', borderRadius: 4,
                    fontSize: 12, marginBottom: 8,
                  };
const _hs33 = {
                      width: '100%', padding: '4px 6px',
                      border: '1px solid var(--border-default)', borderRadius: 4,
                      fontSize: 11, marginBottom: 8,
                    };
const _hs34 = { marginTop: 8, fontSize: 11 };
const _hs35 = { color: 'var(--state-danger)' };
const _hs36 = { color: 'var(--text-muted)', marginTop: 4, wordBreak: 'break-all' };
const _hs37 = { marginTop: 10, textAlign: 'right' };
const _hs38 = { padding: '4px 12px', fontSize: 11, border: '1px solid var(--border-default)', borderRadius: 4, background: 'transparent', cursor: 'pointer', color: 'var(--text-secondary)' };

const TABLE_WIDTH = 220;
const HEADER_HEIGHT = 44;
const TYPE_BAR_HEIGHT = 20;
const ROW_HEIGHT = 24;
const COL_DOT_RADIUS = 6;
const DEFAULT_MAX_VISIBLE = 8;
const TABLE_TYPES = [null, 'dimension', 'fact']; // null = unset, cycle through
const TABLE_TYPE_COLORS = {
  dimension: { header: '#6d28d9', border: '#7c3aed', badge: '#7c3aed', label: 'DIM' },
  fact: { header: '#9a3412', border: '#f97316', badge: '#f97316', label: 'FACT' },
};

// Sort columns: id* first, then alphabetical
function sortColumns(columns) {
  return [...columns].sort((a, b) => {
    const aIsId = a.column_name.toLowerCase().startsWith('id');
    const bIsId = b.column_name.toLowerCase().startsWith('id');
    if (aIsId && !bIsId) return -1;
    if (!aIsId && bIsId) return 1;
    return a.column_name.localeCompare(b.column_name);
  });
}

export default function SchemaCanvas({
  tables, // { tableName: [columns] }
  positions, // { tableName: { x, y } }
  joins, // [{ from_table, from_column, to_table, to_column, cardinality, type }]
  dimensions,
  measures,
  onPositionsChange,
  onJoinsChange,
  onAddDimension,
  onAddMeasure,
  modelId, // used by the cardinality auto-detect endpoint
  datasourceId,
  isNumeric,
  isDateType,
  rlsTable, // the table currently flagged as the RLS table (if any)
  onOpenRLS, // (tableName) => void — opens the RLS dialog for that table
  onRemoveTable, // (tableName) => void — remove the table from the model schema
  columnTypes, // { "table.column": "date" | "string" | "number" | "boolean" }
  onColumnTypeChange, // (table, column, newType | 'auto') => void
  onValidateColumnType, // async (table, column, type) => void — runs the backend sample
  validatingColumn, // "table.column" while a validation request is in flight (or null)
  validationResults, // { "table.column": { validRatio, sampleSize, ... } }
}) {
  const svgRef = useRef(null);
  const containerRef = useRef(null);
  const [draggingTable, setDraggingTable] = useState(null);
  // Inline popover anchor: { table, column, dataType, screenX, screenY } when
  // the user clicks a column's type badge to override its inferred type.
  const [typePopover, setTypePopover] = useState(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [linkDrag, setLinkDrag] = useState(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [collapsedTables, setCollapsedTables] = useState({});
  const [cycleWarning, setCycleWarning] = useState(null);
  const [tableCounts, setTableCounts] = useState({}); // { tableName: { count: number, loading: boolean } }

  const fetchTableCount = useCallback(async (tableName) => {
    if (!datasourceId) return;
    setTableCounts((prev) => ({ ...prev, [tableName]: { ...prev[tableName], loading: true } }));
    try {
      // Quote table name for schema.table format
      const quoted = tableName.includes('.')
        ? tableName.split('.').map((p) => `"${p}"`).join('.')
        : `"${tableName}"`;
      const res = await api.post(`/datasources/${datasourceId}/query`, {
        sql: `SELECT COUNT(*) AS cnt FROM ${quoted}`,
      });
      const cnt = res.data.rows?.[0]?.cnt ?? res.data.rows?.[0]?.count ?? '?';
      setTableCounts((prev) => ({ ...prev, [tableName]: { count: Number(cnt), loading: false } }));
    } catch {
      setTableCounts((prev) => ({ ...prev, [tableName]: { count: '?', loading: false } }));
    }
  }, [datasourceId]);

  const tableNames = Object.keys(tables);

  // Sorted columns per table
  const sortedTables = useMemo(() => {
    const result = {};
    for (const [name, cols] of Object.entries(tables)) {
      result[name] = sortColumns(cols);
    }
    return result;
  }, [tables]);

  // Get visible columns for a table (respecting collapse)
  const getVisibleColumns = useCallback((tableName) => {
    const cols = sortedTables[tableName] || [];
    if (collapsedTables[tableName] === false) return cols; // explicitly expanded
    if (collapsedTables[tableName] === true || cols.length > DEFAULT_MAX_VISIBLE) {
      return cols.slice(0, DEFAULT_MAX_VISIBLE);
    }
    return cols;
  }, [sortedTables, collapsedTables]);

  const isExpanded = useCallback((tableName) => {
    const cols = sortedTables[tableName] || [];
    if (cols.length <= DEFAULT_MAX_VISIBLE) return true;
    return collapsedTables[tableName] === false;
  }, [sortedTables, collapsedTables]);

  const hasMore = useCallback((tableName) => {
    return (sortedTables[tableName] || []).length > DEFAULT_MAX_VISIBLE;
  }, [sortedTables]);

  const toggleExpand = (tableName) => {
    setCollapsedTables((prev) => ({ ...prev, [tableName]: prev[tableName] === false ? true : false }));
  };

  // Convert screen coords to SVG coords
  const screenToSvg = useCallback((clientX, clientY) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: clientX, y: clientY };
    return {
      x: (clientX - rect.left - pan.x) / zoom,
      y: (clientY - rect.top - pan.y) / zoom,
    };
  }, [pan, zoom]);

  // Get position of a column dot
  const getColumnPos = useCallback((tableName, columnName, side = 'right') => {
    const pos = positions[tableName];
    if (!pos) return { x: 0, y: 0 };
    const cols = getVisibleColumns(tableName);
    let colIndex = cols.findIndex((c) => c.column_name === columnName);
    if (colIndex === -1) {
      // Column might be hidden - use last visible row position
      colIndex = cols.length;
    }
    const y = pos.y + HEADER_HEIGHT + TYPE_BAR_HEIGHT + colIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
    const x = side === 'right' ? pos.x + TABLE_WIDTH : pos.x;
    return { x, y };
  }, [positions, getVisibleColumns]);

  // Table drag
  const handleTableMouseDown = (e, tableName) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    // Prevent the browser from starting a text selection when the user
    // initiates a drag on the canvas. Without this, mousemove past nearby
    // <text> elements highlights them and the cursor reverts to "I-beam".
    e.preventDefault();
    const pos = positions[tableName] || { x: 0, y: 0 };
    const svgPt = screenToSvg(e.clientX, e.clientY);
    setDraggingTable(tableName);
    setDragOffset({ x: svgPt.x - pos.x, y: svgPt.y - pos.y });
  };

  // Column link drag
  const handleColumnDotDown = (e, tableName, columnName, side = 'right') => {
    e.stopPropagation();
    // Same as table drag: stop the browser from selecting <text> labels in
    // adjacent rows while the user drags a join line.
    e.preventDefault();
    const pos = getColumnPos(tableName, columnName, side);
    const svgPt = screenToSvg(e.clientX, e.clientY);
    setLinkDrag({
      fromTable: tableName,
      fromColumn: columnName,
      fromX: pos.x,
      fromY: pos.y,
      mouseX: svgPt.x,
      mouseY: svgPt.y,
    });
  };

  // Pan start (background)
  const handleBgMouseDown = (e) => {
    if (e.button !== 0) return;
    setPanning(true);
    setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  // Zoom with mouse wheel — anchors the scale change on the cursor so the
  // logical point under the cursor stays put. Closes over the latest
  // zoom + pan via the dependency list (re-registering on every change is
  // cheap and avoids the stale-closure bug of the previous version).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handleWheel = (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.08 : 0.08;
      const nextZoom = Math.min(2, Math.max(0.3, zoom + delta));
      if (nextZoom === zoom) return;
      const rect = container.getBoundingClientRect();
      // Cursor position relative to the container (== relative to the SVG
      // since they share the same box).
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      // The inner <g> uses transform="translate(pan) scale(zoom)", so a
      // screen point P maps to logical (P - pan) / zoom. We pick the new
      // pan so the same logical point lands at the same screen point
      // after the scale change.
      const ratio = nextZoom / zoom;
      setZoom(nextZoom);
      setPan({
        x: cx - (cx - pan.x) * ratio,
        y: cy - (cy - pan.y) * ratio,
      });
    };
    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [zoom, pan]);

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (draggingTable) {
        const svgPt = screenToSvg(e.clientX, e.clientY);
        onPositionsChange({ ...positions, [draggingTable]: { ...positions[draggingTable], x: svgPt.x - dragOffset.x, y: svgPt.y - dragOffset.y } });
      }
      if (linkDrag) {
        const svgPt = screenToSvg(e.clientX, e.clientY);
        setLinkDrag((prev) => prev ? { ...prev, mouseX: svgPt.x, mouseY: svgPt.y } : null);
      }
      if (panning) {
        setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
      }
    };

    const handleMouseUp = (e) => {
      if (linkDrag) {
        const dropPt = screenToSvg(e.clientX, e.clientY);
        const SNAP_DISTANCE = 20;
        let bestMatch = null;
        let bestDist = SNAP_DISTANCE;

        // Find the closest column dot to the drop point
        for (const tName of Object.keys(tables)) {
          if (!positions[tName]) continue;
          const visibleCols = getVisibleColumns(tName);
          for (const col of visibleCols) {
            // Check both left and right dots
            for (const side of ['left', 'right']) {
              const dotPos = getColumnPos(tName, col.column_name, side);
              const dx = dropPt.x - dotPos.x;
              const dy = dropPt.y - dotPos.y;
              const dist = Math.sqrt(dx * dx + dy * dy);
              if (dist < bestDist) {
                bestDist = dist;
                bestMatch = { table: tName, column: col.column_name };
              }
            }
          }
        }

        if (bestMatch && (bestMatch.table !== linkDrag.fromTable || bestMatch.column !== linkDrag.fromColumn)) {
          const exists = joins.some(
            (j) => (j.from_table === linkDrag.fromTable && j.from_column === linkDrag.fromColumn && j.to_table === bestMatch.table && j.to_column === bestMatch.column) ||
                   (j.to_table === linkDrag.fromTable && j.to_column === linkDrag.fromColumn && j.from_table === bestMatch.table && j.from_column === bestMatch.column)
          );
          if (!exists) {
            if (wouldCreateCycle(linkDrag.fromTable, bestMatch.table, joins)) {
              setCycleWarning(`Impossible de relier ${linkDrag.fromTable} → ${bestMatch.table} : cela créerait une boucle de relations.`);
              setTimeout(() => setCycleWarning(null), 4000);
            } else {
              // Optimistic create with the star-schema default cardinality
              // (*:1). The auto-detect runs in the background and overrides
              // each side from the sample.
              const fromTbl = linkDrag.fromTable, fromCol = linkDrag.fromColumn;
              const toTbl = bestMatch.table, toCol = bestMatch.column;
              onJoinsChange([...joins, {
                from_table: fromTbl, from_column: fromCol,
                to_table: toTbl, to_column: toCol,
                cardinality: { from: '*', to: '1' },
              }]);
              if (modelId) {
                Promise.all([
                  detectCardinalitySide(fromTbl, fromCol),
                  detectCardinalitySide(toTbl, toCol),
                ]).then(([fromC, toC]) => {
                  // Re-read joins through the setter so we don't clobber
                  // edits made between create and detect completion.
                  onJoinsChange((prev) => {
                    const next = Array.isArray(prev) ? [...prev] : [];
                    const idx = next.findIndex((j) =>
                      j.from_table === fromTbl && j.from_column === fromCol &&
                      j.to_table === toTbl && j.to_column === toCol);
                    if (idx === -1) return prev;
                    next[idx] = { ...next[idx], cardinality: { from: fromC, to: toC } };
                    return next;
                  });
                }).catch(() => {});
              }
            }
          }
        }
        setLinkDrag(null);
      }
      setDraggingTable(null);
      setPanning(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingTable, dragOffset, linkDrag, panning, panStart, pan, zoom, positions, joins, tables, getVisibleColumns, getColumnPos, onPositionsChange, onJoinsChange, screenToSvg]);

  // Toggle a cardinality marker (1 ↔ *) on one end of a join. The SQL
  // JOIN keyword (LEFT/INNER) is derived server-side from cardinality, so
  // the user no longer manipulates it directly.
  const toggleCardinality = (index, side) => {
    const j = joins[index];
    const c = j.cardinality || { from: '*', to: '1' };
    const next = { ...c, [side]: c[side] === '1' ? '*' : '1' };
    onJoinsChange(joins.map((join, i) => i === index ? { ...join, cardinality: next } : join));
  };

  // Sample-based suggestion for a single side. Returns '1' or '*' (best
  // effort — failures fall back to the * default which matches the
  // common star-schema fact side). Re-used both at join creation and
  // when the user explicitly asks to refresh the suggestion.
  const detectCardinalitySide = async (table, column) => {
    try {
      const res = await api.post(`/models/${modelId}/detect-cardinality`, { table, column });
      return res.data?.cardinality === '1' ? '1' : '*';
    } catch { return '*'; }
  };

  // Detect if adding a directed join fromTable → toTable would create a
  // directed cycle. Edge orientation now follows cardinality: the edge
  // points from the "*" (many) side to the "1" (one) side — i.e. fact → dim.
  // For 1:* joins we flip from_table/to_table accordingly. The proposed
  // new edge is assumed to be *:1 (the post-creation default) which matches
  // a typical star-schema add.
  const wouldCreateCycle = (fromTable, toTable, currentJoins) => {
    const orient = (j) => {
      const c = j.cardinality;
      if (c?.from === '1' && c?.to === '*') {
        return [j.to_table, j.from_table]; // flip to keep "*" → "1"
      }
      return [j.from_table, j.to_table];
    };
    const adj = {};
    for (const j of currentJoins) {
      const [src, dst] = orient(j);
      if (!adj[src]) adj[src] = [];
      adj[src].push(dst);
    }
    const visited = new Set();
    const queue = [toTable];
    visited.add(toTable);
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === fromTable) return true;
      for (const neighbor of (adj[current] || [])) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    return false;
  };

  const cycleTableType = useCallback((tableName) => {
    const current = positions[tableName]?.tableType || null;
    const currentIdx = TABLE_TYPES.indexOf(current);
    const nextType = TABLE_TYPES[(currentIdx + 1) % TABLE_TYPES.length];
    onPositionsChange({
      ...positions,
      [tableName]: { ...positions[tableName], tableType: nextType },
    });
  }, [positions, onPositionsChange]);

  // Match by normalized (trimmed, case-insensitive) name so the D/M badges stay
  // visible even if the column / table name was stored with subtle differences
  // (BOM, trailing whitespace, casing) compared to what the schema endpoint returns.
  const norm = (s) => String(s ?? '').trim().toLowerCase();
  const dimensionKeys = useMemo(
    () => new Set(dimensions.map((d) => `${norm(d.table)}\u0000${norm(d.column)}`)),
    [dimensions],
  );
  const measureKeys = useMemo(
    () => new Set(measures.map((m) => `${norm(m.table)}\u0000${norm(m.column)}`)),
    [measures],
  );
  const isDimension = (table, col) => dimensionKeys.has(`${norm(table)}\u0000${norm(col)}`);
  const isMeasure = (table, col) => measureKeys.has(`${norm(table)}\u0000${norm(col)}`);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', overflow: 'hidden', position: 'relative', cursor: panning ? 'grabbing' : 'grab', userSelect: 'none', WebkitUserSelect: 'none' }}
    >
      {/* Cycle warning */}
      {cycleWarning && (
        <div style={_hs0}>
          <span style={_hs1}>!</span>
          <span style={_hs2}>{cycleWarning}</span>
          <button className="btn-hover btn-hover-danger" onClick={() => setCycleWarning(null)} style={_hs3}>x</button>
        </div>
      )}

      {/* Zoom controls */}
      <div style={_hs4}>
        <button className="btn-hover" onClick={() => setZoom((z) => Math.min(2, z + 0.15))} style={zoomBtn}>+</button>
        <span style={_hs5}>{Math.round(zoom * 100)}%</span>
        <button className="btn-hover" onClick={() => setZoom((z) => Math.max(0.3, z - 0.15))} style={zoomBtn}>-</button>
        <button className="btn-hover" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} style={{ ...zoomBtn, fontSize: 10, width: 'auto', padding: '4px 8px' }}>Reset</button>
      </div>

      <svg
        ref={svgRef}
        style={_hs6}
        onMouseDown={handleBgMouseDown}
      >
        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          {/* Arrow markers */}
          <defs>
            <marker id="arrow-right" viewBox="0 0 10 10" refX="8" refY="5" markerWidth={8} markerHeight={8} orient="auto-start-reverse">
              <path d="M 0 1 L 8 5 L 0 9 z" fill="#7c3aed" />
            </marker>
            <marker id="arrow-left" viewBox="0 0 10 10" refX="2" refY="5" markerWidth={8} markerHeight={8} orient="auto-start-reverse">
              <path d="M 10 1 L 2 5 L 10 9 z" fill="#7c3aed" />
            </marker>
            <marker id="arrow-both-start" viewBox="0 0 10 10" refX="2" refY="5" markerWidth={8} markerHeight={8} orient="auto-start-reverse">
              <path d="M 10 1 L 2 5 L 10 9 z" fill="#7c3aed" />
            </marker>
            <marker id="arrow-both-end" viewBox="0 0 10 10" refX="8" refY="5" markerWidth={8} markerHeight={8} orient="auto-start-reverse">
              <path d="M 0 1 L 8 5 L 0 9 z" fill="#7c3aed" />
            </marker>
          </defs>

          {/* Join lines — routed to bend around any non-endpoint table that
              the actual Bézier curve would cross. We sample the candidate
              curve at 20 points and check rect intersection; if it crashes
              into a table, we lift (or drop) the apex above (or below) all
              X-overlapping tables until the sampled curve is clear. This
              avoids the heuristic-Y-band false positives of a previous
              version which produced weird detours when a straight Bézier
              would have worked. */}
          {(() => {
            const PADDING = 18;
            const SAMPLES = 20;
            const tableRects = {};
            for (const tableName of tableNames) {
              const pos = positions[tableName] || { x: 0, y: 0 };
              const visibleCols = getVisibleColumns(tableName);
              const showToggle = hasMore(tableName);
              const toggleHeight = showToggle ? 24 : 0;
              const tableHeight = HEADER_HEIGHT + TYPE_BAR_HEIGHT + visibleCols.length * ROW_HEIGHT + toggleHeight + 4;
              tableRects[tableName] = { x: pos.x, y: pos.y, width: TABLE_WIDTH, height: tableHeight };
            }
            // Cubic Bézier sampler (control points c1,c2)
            const bezierAt = (p0, p1, p2, p3, t) => {
              const u = 1 - t;
              return u*u*u*p0 + 3*u*u*t*p1 + 3*u*t*t*p2 + t*t*t*p3;
            };
            const curveCrosses = (from, to, c1x, c1y, c2x, c2y, rects) => {
              for (let s = 1; s < SAMPLES; s++) {
                const t = s / SAMPLES;
                const x = bezierAt(from.x, c1x, c2x, to.x, t);
                const y = bezierAt(from.y, c1y, c2y, to.y, t);
                for (const r of rects) {
                  if (x > r.x && x < r.x + r.width && y > r.y && y < r.y + r.height) return true;
                }
              }
              return false;
            };
            return joins.map((join, i) => {
              const fromPos = positions[join.from_table] || { x: 0, y: 0 };
              const toPos = positions[join.to_table] || { x: 0, y: 0 };
              const fromCenter = fromPos.x + TABLE_WIDTH / 2;
              const toCenter = toPos.x + TABLE_WIDTH / 2;
              const fromSide = fromCenter <= toCenter ? 'right' : 'left';
              const toSide = fromCenter <= toCenter ? 'left' : 'right';
              const from = getColumnPos(join.from_table, join.from_column, fromSide);
              const to = getColumnPos(join.to_table, join.to_column, toSide);
              const midX = (from.x + to.x) / 2;

              // Collect non-endpoint tables that overlap the X span of the
              // curve. These are the only obstacles the curve could possibly
              // hit, regardless of vertical position.
              const xMin = Math.min(from.x, to.x);
              const xMax = Math.max(from.x, to.x);
              const xObstacles = [];
              for (const tableName of tableNames) {
                if (tableName === join.from_table || tableName === join.to_table) continue;
                const r = tableRects[tableName];
                if (!r) continue;
                if (r.x + r.width < xMin || r.x > xMax) continue;
                xObstacles.push(r);
              }

              // Default: straight S-Bézier with control points at the start/
              // end Y. This collapses to a horizontal line when from.y==to.y.
              let c1y = from.y, c2y = to.y;
              let labelY = (from.y + to.y) / 2;
              const directHits = xObstacles.length > 0
                && curveCrosses(from, to, midX, c1y, midX, c2y, xObstacles);
              if (directHits) {
                // Detour above or below ALL X-overlapping tables (not just
                // the ones the straight curve hits — picking a tighter
                // apex risks the new curve crashing into a different table
                // we hadn't flagged). Pick the side closer to the direct
                // midline.
                const topApex = Math.min(...xObstacles.map((r) => r.y)) - PADDING;
                const botApex = Math.max(...xObstacles.map((r) => r.y + r.height)) + PADDING;
                const directMidY = (from.y + to.y) / 2;
                // Bézier with both control points at apexY puts the curve's
                // peak at (from.y + to.y)/8 + 0.75*ctrlY. Invert to get
                // ctrlY so the actual peak lands on apexY.
                const ctrlForApex = (apex) => (apex - (from.y + to.y) / 8) / 0.75;
                const tryApex = (apex) => {
                  const cy = ctrlForApex(apex);
                  return curveCrosses(from, to, midX, cy, midX, cy, xObstacles) ? null : { cy, apex };
                };
                const preferTop = Math.abs(directMidY - topApex) <= Math.abs(directMidY - botApex);
                const choice = preferTop
                  ? (tryApex(topApex) || tryApex(botApex))
                  : (tryApex(botApex) || tryApex(topApex));
                if (choice) {
                  c1y = choice.cy;
                  c2y = choice.cy;
                  labelY = choice.apex;
                } else {
                  // No clean detour found (canvas dense on both sides) —
                  // fall back to the closer apex anyway. Better a routed
                  // line that grazes than a tangled one through the middle.
                  const apex = preferTop ? topApex : botApex;
                  c1y = ctrlForApex(apex);
                  c2y = c1y;
                  labelY = apex;
                }
              }

              const pathD = `M ${from.x} ${from.y} C ${midX} ${c1y}, ${midX} ${c2y}, ${to.x} ${to.y}`;
              const labelX = midX;

              // Cardinality-driven visuals — replaces the legacy LEFT/INNER
              // pill. Color is derived from the cardinality combo so the
              // user reads the relation shape at a glance:
              //   *:1 / 1:* → purple (typical fact↔dim)
              //   1:1       → cyan-ish (rare but valid)
              //   *:*       → red, to flag a likely modeling mistake
              const cardinality = join.cardinality || (() => {
                // Migrate legacy `type` field into a sensible cardinality
                // for display only — the underlying join object isn't
                // mutated until the user actually edits it.
                if (join.type === 'RIGHT') return { from: '1', to: '*' };
                return { from: '*', to: '1' };
              })();
              const isManyToMany = cardinality.from === '*' && cardinality.to === '*';
              const isOneToOne = cardinality.from === '1' && cardinality.to === '1';
              const color = isManyToMany ? '#dc2626' : isOneToOne ? '#0891b2' : '#7c3aed';

              // Anchor the cardinality markers along the curve, just inside
              // each table edge: t=0.08 from start, t=0.92 from end (close
              // enough to the table without overlapping it). Reuses the
              // bezierAt sampler defined above.
              const tStart = 0.08, tEnd = 0.92;
              const fromMarkerX = bezierAt(from.x, midX, midX, to.x, tStart);
              const fromMarkerY = bezierAt(from.y, c1y, c2y, to.y, tStart);
              const toMarkerX = bezierAt(from.x, midX, midX, to.x, tEnd);
              const toMarkerY = bezierAt(from.y, c1y, c2y, to.y, tEnd);

              const renderMarker = (cx, cy, value, side) => (
                <g
                  onClick={(e) => { e.stopPropagation(); toggleCardinality(i, side); }}
                  style={_hs7}
                >
                  <title>Cardinality {value} — click to toggle</title>
                  <circle cx={cx} cy={cy} r={9} fill="#fff" stroke={color} strokeWidth={2} />
                  <text x={cx} y={cy + 4} textAnchor="middle" fontSize={11} fill={color} fontWeight={700}
                    style={_hs8}>
                    {value}
                  </text>
                </g>
              );

              return (
                <g key={`join-${i}`}>
                  <path
                    d={pathD}
                    fill="none" stroke={color} strokeWidth={2}
                  />
                  {renderMarker(fromMarkerX, fromMarkerY, cardinality.from, 'from')}
                  {renderMarker(toMarkerX, toMarkerY, cardinality.to, 'to')}
                  {/* Delete button — kept at the curve apex */}
                  <circle cx={labelX} cy={labelY} r={9} fill="#fff" stroke="#fca5a5" strokeWidth={1.5}
                    style={_hs9}
                    onClick={(e) => { e.stopPropagation(); onJoinsChange(joins.filter((_, idx) => idx !== i)); }}
                  >
                    <title>Remove join</title>
                  </circle>
                  <text x={labelX} y={labelY + 4} textAnchor="middle" fontSize={11} fill="#dc2626" fontWeight={600}
                    style={_hs10}>×</text>
                </g>
              );
            });
          })()}

          {/* Drag line preview */}
          {linkDrag && (
            <line x1={linkDrag.fromX} y1={linkDrag.fromY} x2={linkDrag.mouseX} y2={linkDrag.mouseY}
              stroke="#7c3aed" strokeWidth={2} strokeDasharray="4,4" pointerEvents="none" />
          )}

          {/* Tables */}
          {tableNames.map((tableName) => {
            const pos = positions[tableName] || { x: 0, y: 0 };
            const visibleCols = getVisibleColumns(tableName);
            const allCols = sortedTables[tableName] || [];
            const expanded = isExpanded(tableName);
            const showToggle = hasMore(tableName);
            const hiddenCount = allCols.length - visibleCols.length;
            const toggleHeight = showToggle ? 24 : 0;
            const tableHeight = HEADER_HEIGHT + TYPE_BAR_HEIGHT + visibleCols.length * ROW_HEIGHT + toggleHeight + 4;
            const tType = pos.tableType || null;
            const tColors = TABLE_TYPE_COLORS[tType];
            const headerColor = tColors ? tColors.header : '#1e293b';
            const borderColor = tColors ? tColors.border : '#e2e8f0';

            return (
              <g key={tableName} transform={`translate(${pos.x}, ${pos.y})`}>
                {/* Shadow */}
                <rect x={2} y={2} width={TABLE_WIDTH} height={tableHeight} rx={6} fill="rgba(0,0,0,0.06)" />
                {/* Card bg */}
                <rect width={TABLE_WIDTH} height={tableHeight} rx={6} fill="#fff" stroke={borderColor} strokeWidth={tColors ? 2 : 1} />
                {/* Header */}
                <rect width={TABLE_WIDTH} height={HEADER_HEIGHT} rx={6} fill={headerColor} />
                <rect y={HEADER_HEIGHT - 6} width={TABLE_WIDTH} height={6} fill={headerColor} />
                {/* Drag handle area (full header) */}
                <rect width={TABLE_WIDTH} height={HEADER_HEIGHT} rx={6} fill="transparent"
                  style={_hs11} onMouseDown={(e) => handleTableMouseDown(e, tableName)} />
                {/* Clip path for text truncation */}
                <defs>
                  <clipPath id={`clip-header-${tableName.replace(/[^a-zA-Z0-9]/g, '_')}`}>
                    <rect x={8} y={0} width={TABLE_WIDTH - 36} height={HEADER_HEIGHT} />
                  </clipPath>
                </defs>
                {/* Schema name (small, above table name) */}
                {tableName.includes('.') && (
                  <text x={10} y={15} fontSize={9} fill="#94a3b8" fontWeight={400} style={_hs12}>
                    {tableName.split('.').slice(0, -1).join('.')}
                  </text>
                )}
                {/* Table name (truncated with clipPath) */}
                <g clipPath={`url(#clip-header-${tableName.replace(/[^a-zA-Z0-9]/g, '_')})`}>
                  <text x={10} y={tableName.includes('.') ? 30 : 28} fontSize={12} fill="#fff" fontWeight={600} style={_hs13}>
                    {tableName.includes('.') ? tableName.split('.').pop() : tableName}
                  </text>
                </g>
                {/* Row count + refresh — aligned with schema name */}
                {(() => {
                  const tc = tableCounts[tableName];
                  const countText = tc?.loading ? '...' : tc?.count != null ? Number(tc.count).toLocaleString() : '';
                  return (
                    <g>
                      {countText && (
                        <text x={TABLE_WIDTH - 36} y={15} fontSize={9} fill="#94a3b8" fontWeight={400}
                          textAnchor="end" style={_hs14}>
                          {countText} rows
                        </text>
                      )}
                      <text x={TABLE_WIDTH - 22} y={15} fontSize={10} fill="#64748b"
                        textAnchor="end" style={_hs15}
                        onClick={(e) => { e.stopPropagation(); fetchTableCount(tableName); }}>
                        ↻
                      </text>
                      {onRemoveTable && (
                        <g onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (window.confirm(`Remove table "${tableName}" from the model? Joins, dimensions and measures referencing it will also be removed.`)) {
                              onRemoveTable(tableName);
                            }
                          }}
                          style={_hs16}>
                          <title>Remove table from model</title>
                          <circle cx={TABLE_WIDTH - 10} cy={12} r={7} fill="rgba(255,255,255,0.15)" />
                          <text x={TABLE_WIDTH - 10} y={16} fontSize={11} fill="#fff" fontWeight={700}
                            textAnchor="middle" style={_hs17}>×</text>
                        </g>
                      )}
                    </g>
                  );
                })()}

                {/* Type bar — below header, click to cycle (none → dimension → fact → none) */}
                <rect y={HEADER_HEIGHT} width={TABLE_WIDTH} height={TYPE_BAR_HEIGHT}
                  fill={tColors ? tColors.badge : '#f1f5f9'} fillOpacity={tColors ? 0.1 : 1}
                  style={_hs18}
                  onClick={(e) => { e.stopPropagation(); cycleTableType(tableName); }} />
                {tColors ? (
                  <g onClick={(e) => { e.stopPropagation(); cycleTableType(tableName); }} style={_hs19}>
                    <rect x={TABLE_WIDTH / 2 - 22} y={HEADER_HEIGHT + 3} width={44} height={14} rx={7}
                      fill={tColors.badge} fillOpacity={0.2} stroke={tColors.badge} strokeWidth={1} />
                    <text x={TABLE_WIDTH / 2} y={HEADER_HEIGHT + 13} textAnchor="middle" fontSize={8} fill={tColors.badge} fontWeight={700}
                      style={_hs20}>
                      {tColors.label}
                    </text>
                  </g>
                ) : (
                  <text x={TABLE_WIDTH / 2} y={HEADER_HEIGHT + 14} textAnchor="middle" fontSize={8} fill="#94a3b8" fontWeight={500}
                    style={_hs21}
                    onClick={(e) => { e.stopPropagation(); cycleTableType(tableName); }}>
                    click to set type
                  </text>
                )}

                {/* RLS badge — top-right of the type bar. Click opens the RLS configuration dialog. */}
                {onOpenRLS && (
                  <g
                    onClick={(e) => { e.stopPropagation(); onOpenRLS(tableName); }}
                    style={_hs22}
                  >
                    <title>{rlsTable === tableName ? 'Row-level security enabled — click to configure' : 'Configure row-level security'}</title>
                    <rect
                      x={TABLE_WIDTH - 38} y={HEADER_HEIGHT + 3}
                      width={32} height={14} rx={7}
                      fill={rlsTable === tableName ? '#7c3aed' : '#fff'}
                      fillOpacity={rlsTable === tableName ? 1 : 0.7}
                      stroke={rlsTable === tableName ? '#7c3aed' : '#cbd5e1'}
                      strokeWidth={1}
                    />
                    <text
                      x={TABLE_WIDTH - 22} y={HEADER_HEIGHT + 13}
                      textAnchor="middle" fontSize={8}
                      fill={rlsTable === tableName ? '#fff' : '#64748b'} fontWeight={700}
                      style={_hs23}
                    >RLS</text>
                  </g>
                )}

                {/* Columns */}
                {visibleCols.map((col, ci) => {
                  const cy = HEADER_HEIGHT + TYPE_BAR_HEIGHT + ci * ROW_HEIGHT + ROW_HEIGHT / 2;
                  const isDim = isDimension(tableName, col.column_name);
                  const isMeas = isMeasure(tableName, col.column_name);
                  // Effective type respects per-column overrides (columnTypes prop).
                  // Override → 'date' / 'number' / 'string' / 'boolean'. Without
                  // override we infer from the native data_type.
                  const overrideKey = `${tableName}.${col.column_name}`;
                  const overrideRaw = columnTypes && columnTypes[overrideKey];
                  // Normalise: entries can be either a plain type string or
                  // an object { type, format } once a date format is set.
                  const overrideType = !overrideRaw
                    ? null
                    : (typeof overrideRaw === 'string' ? overrideRaw : overrideRaw.type);
                  const isOverridden = !!overrideType;
                  const numeric = overrideType
                    ? ['number', 'integer', 'decimal'].includes(overrideType)
                    : isNumeric(col.data_type);
                  const isDate = overrideType ? overrideType === 'date' : isDateType?.(col.data_type);
                  const displayType = overrideType || col.data_type;
                  const isId = col.column_name.toLowerCase().startsWith('id');

                  return (
                    <g key={col.column_name}>
                      {(isDim || isMeas) && (
                        <rect x={1} y={HEADER_HEIGHT + TYPE_BAR_HEIGHT + ci * ROW_HEIGHT} width={TABLE_WIDTH - 2} height={ROW_HEIGHT}
                          fill={isDim && isDate ? '#fef3c7' : isDim ? '#f5f3ff' : '#f0fdf4'} />
                      )}
                      {/* Key icon for id columns */}
                      {isId && (
                        <text x={8} y={cy + 4} fontSize={9} fill="#f59e0b">K</text>
                      )}
                      {(() => {
                        const NAME_MAX = isId ? 16 : 17;
                        const TYPE_MAX = 10;
                        const truncate = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s);
                        const nameTruncated = (col.column_name || '').length > NAME_MAX;
                        // Click on the type label opens the override popover at
                        // the click coordinates. The popover lives outside the
                        // SVG (HTML overlay) so it can host a normal <select>.
                        const onTypeClick = (e) => {
                          if (!onColumnTypeChange) return;
                          e.stopPropagation();
                          setTypePopover({
                            table: tableName,
                            column: col.column_name,
                            dataType: col.data_type,
                            screenX: e.clientX,
                            screenY: e.clientY,
                          });
                        };
                        return (
                          <>
                            <text x={isId ? 18 : 8} y={cy + 4} fontSize={11} fill="#334155" style={{ fontWeight: isId ? 600 : 400 }}>
                              {truncate(col.column_name, NAME_MAX)}
                              {nameTruncated && <title>{col.column_name}</title>}
                            </text>
                            <text
                              x={TABLE_WIDTH - (isDate ? 56 : 48)}
                              y={cy + 4}
                              fontSize={9}
                              fill={isOverridden ? '#7c3aed' : isDate ? '#d97706' : '#94a3b8'}
                              fontWeight={isOverridden ? 700 : 400}
                              textAnchor="end"
                              style={{ cursor: onColumnTypeChange ? 'pointer' : 'default' }}
                              onClick={onTypeClick}
                            >
                              {isOverridden ? '✎ ' : isDate ? '📅 ' : '✎ '}{truncate(displayType, TYPE_MAX)}
                              <title>{isOverridden
                                ? `Override actif : ${displayType}\nNatif : ${col.data_type}\nClique pour changer`
                                : `Type natif : ${col.data_type}\nClique pour forcer un autre type / format`}</title>
                            </text>
                          </>
                        );
                      })()}

                      {/* D / M buttons */}
                      <text x={TABLE_WIDTH - 36} y={cy + 4} fontSize={9}
                        fill={isDim ? '#7c3aed' : '#cbd5e1'} fontWeight={700}
                        style={_hs24}
                        onClick={(e) => { e.stopPropagation(); onAddDimension(tableName, col); }}>
                        D
                      </text>
                      {numeric && (
                        <text x={TABLE_WIDTH - 22} y={cy + 4} fontSize={9}
                          fill={isMeas ? '#16a34a' : '#cbd5e1'} fontWeight={700}
                          style={_hs25}
                          onClick={(e) => { e.stopPropagation(); onAddMeasure(tableName, col); }}>
                          M
                        </text>
                      )}

                      {/* Left dot */}
                      <circle cx={0} cy={cy} r={COL_DOT_RADIUS} fill="#fff" stroke="#94a3b8" strokeWidth={1.5}
                        style={_hs26} data-table={tableName} data-column={col.column_name}
                        onMouseDown={(e) => handleColumnDotDown(e, tableName, col.column_name, 'left')} />
                      {/* Right dot */}
                      <circle cx={TABLE_WIDTH} cy={cy} r={COL_DOT_RADIUS} fill="#fff" stroke="#94a3b8" strokeWidth={1.5}
                        style={_hs27} data-table={tableName} data-column={col.column_name}
                        onMouseDown={(e) => handleColumnDotDown(e, tableName, col.column_name, 'right')} />
                    </g>
                  );
                })}

                {/* Expand/collapse toggle */}
                {showToggle && (
                  <g
                    onClick={(e) => { e.stopPropagation(); toggleExpand(tableName); }}
                    style={_hs28}
                  >
                    <rect
                      x={1}
                      y={HEADER_HEIGHT + TYPE_BAR_HEIGHT + visibleCols.length * ROW_HEIGHT}
                      width={TABLE_WIDTH - 2}
                      height={toggleHeight}
                      fill="#f8fafc"
                      rx={0}
                    />
                    <text
                      x={TABLE_WIDTH / 2}
                      y={HEADER_HEIGHT + TYPE_BAR_HEIGHT + visibleCols.length * ROW_HEIGHT + 16}
                      textAnchor="middle"
                      fontSize={10}
                      fill="#7c3aed"
                      fontWeight={600}
                    >
                      {expanded ? '▲ Collapse' : `▼ Show ${hiddenCount} more columns`}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

        </g>
      </svg>

      {/* Column-type override popover. Floats above the SVG at the click
          coordinates, contains a normal <select> + Test/Reset buttons.
          Closing handled by clicking outside (an invisible overlay). */}
      {typePopover && (
        <>
          <div
            onClick={() => setTypePopover(null)}
            style={_hs29}
          />
          {(() => {
            const key = `${typePopover.table}.${typePopover.column}`;
            const rawEntry = columnTypes && columnTypes[key];
            // Normalise the entry to {type, format} no matter how it was stored.
            const entry = !rawEntry
              ? { type: 'auto', format: 'auto' }
              : (typeof rawEntry === 'string'
                ? { type: rawEntry, format: 'auto' }
                : { type: rawEntry.type || 'auto', format: rawEntry.format || 'auto' });
            const current = entry.type === 'number' ? 'decimal' : entry.type;
            const currentFormat = entry.format || 'auto';
            const isValidating = validatingColumn === key;
            const result = validationResults?.[key];
            const VW = 240;
            // Position the popover near the click point, but keep it on-screen.
            const left = Math.min(typePopover.screenX, window.innerWidth - VW - 16);
            const top = Math.min(typePopover.screenY + 8, window.innerHeight - 280);
            return (
              <div
                style={{
                  position: 'fixed', left, top, zIndex: 51,
                  width: VW,
                  background: 'var(--bg-panel)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 8,
                  boxShadow: '0 8px 24px rgba(15,23,42,0.18)',
                  padding: 12, fontSize: 12,
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div style={_hs30}>
                  Override column type
                </div>
                <div style={_hs31}>
                  <code>{typePopover.column}</code> · native <code>{typePopover.dataType}</code>
                </div>
                <select
                  value={current}
                  onChange={(e) => {
                    onColumnTypeChange?.(typePopover.table, typePopover.column, e.target.value, currentFormat);
                  }}
                  style={_hs32}
                >
                  <option value="auto">auto (use native)</option>
                  <option value="string">string</option>
                  <option value="integer">integer (no decimals)</option>
                  <option value="decimal">decimal (. or , as separator)</option>
                  <option value="date">date</option>
                  <option value="boolean">boolean</option>
                </select>
                {current === 'date' && (
                  <select
                    value={currentFormat}
                    onChange={(e) => onColumnTypeChange?.(typePopover.table, typePopover.column, 'date', e.target.value)}
                    style={_hs33}
                    title="Expected date format in this column"
                  >
                    <option value="auto">auto (try ISO / EU / US)</option>
                    <option value="iso">ISO (YYYY-MM-DD)</option>
                    <option value="dd/mm/yyyy">DD/MM/YYYY (FR)</option>
                    <option value="mm/dd/yyyy">MM/DD/YYYY (US)</option>
                    <option value="dd-mm-yyyy">DD-MM-YYYY</option>
                    <option value="dd.mm.yyyy">DD.MM.YYYY</option>
                    <option value="yyyymmdd">YYYYMMDD</option>
                  </select>
                )}
                {current !== 'auto' && (
                  <button
                    type="button"
                    className="btn-hover"
                    disabled={isValidating || !onValidateColumnType}
                    onClick={() => onValidateColumnType?.(typePopover.table, typePopover.column, current, currentFormat)}
                    style={{
                      width: '100%', padding: '5px 8px', fontSize: 12,
                      background: 'transparent', border: '1px solid var(--border-default)',
                      borderRadius: 4, cursor: isValidating ? 'wait' : 'pointer',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    {isValidating ? 'Testing…' : 'Test format on 100k rows'}
                  </button>
                )}
                {result && (
                  <div style={_hs34}>
                    {result.error ? (
                      <span style={_hs35}>Error: {result.error}</span>
                    ) : (
                      <>
                        <div style={{ color: result.validRatio >= 0.95 ? 'var(--state-success, #16a34a)' : 'var(--state-warning, #92400e)' }}>
                          {result.validRatio >= 0.95 ? '✓' : '!'} {Math.round((result.validRatio || 0) * 100)}% valid ({result.validCount}/{result.sampleSize} rows)
                        </div>
                        {result.invalidExamples?.length > 0 && (
                          <div style={_hs36}>
                            Invalid examples: {result.invalidExamples.slice(0, 3).map((v) => v == null ? 'NULL' : `"${v}"`).join(', ')}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
                <div style={_hs37}>
                  <button
                    type="button"
                    className="btn-hover"
                    onClick={() => setTypePopover(null)}
                    style={_hs38}
                  >
                    Close
                  </button>
                </div>
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
}

const zoomBtn = {
  width: 28, height: 28, border: '1px solid var(--border-default)', borderRadius: 4,
  background: 'var(--bg-panel)', cursor: 'pointer', fontSize: 16, fontWeight: 600,
  color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center',
};
