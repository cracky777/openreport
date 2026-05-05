import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import api from '../../utils/api';

const TABLE_WIDTH = 220;
const HEADER_HEIGHT = 44;
const TYPE_BAR_HEIGHT = 20;
const ROW_HEIGHT = 24;
const COL_DOT_RADIUS = 6;
const DEFAULT_MAX_VISIBLE = 8;
const JOIN_TYPES = ['LEFT', 'INNER', 'RIGHT', 'FULL'];
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
  joins, // [{ from_table, from_column, to_table, to_column, type }]
  dimensions,
  measures,
  onPositionsChange,
  onJoinsChange,
  onAddDimension,
  onAddMeasure,
  datasourceId,
  isNumeric,
  isDateType,
  rlsTable, // the table currently flagged as the RLS table (if any)
  onOpenRLS, // (tableName) => void — opens the RLS dialog for that table
  onRemoveTable, // (tableName) => void — remove the table from the model schema
}) {
  const svgRef = useRef(null);
  const containerRef = useRef(null);
  const [draggingTable, setDraggingTable] = useState(null);
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
    const allCols = sortedTables[tableName] || [];
    // Check visible first, then all (for hidden columns in joins)
    let colIndex = cols.findIndex((c) => c.column_name === columnName);
    if (colIndex === -1) {
      // Column might be hidden - use last visible row position
      colIndex = cols.length;
    }
    const y = pos.y + HEADER_HEIGHT + TYPE_BAR_HEIGHT + colIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
    const x = side === 'right' ? pos.x + TABLE_WIDTH : pos.x;
    return { x, y };
  }, [positions, sortedTables, getVisibleColumns]);

  // Table drag
  const handleTableMouseDown = (e, tableName) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const pos = positions[tableName] || { x: 0, y: 0 };
    const svgPt = screenToSvg(e.clientX, e.clientY);
    setDraggingTable(tableName);
    setDragOffset({ x: svgPt.x - pos.x, y: svgPt.y - pos.y });
  };

  // Column link drag
  const handleColumnDotDown = (e, tableName, columnName, side = 'right') => {
    e.stopPropagation();
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

  // Zoom with mouse wheel
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handleWheel = (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.08 : 0.08;
      setZoom((prev) => Math.min(2, Math.max(0.3, prev + delta)));
    };
    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, []);

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
        for (const [tName, cols] of Object.entries(tables)) {
          if (!positions[tName]) continue;
          const sortedCols = cols; // already sorted in parent
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
              onJoinsChange([...joins, {
                from_table: linkDrag.fromTable, from_column: linkDrag.fromColumn,
                to_table: bestMatch.table, to_column: bestMatch.column, type: 'LEFT',
              }]);
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

  const cycleJoinType = (index) => {
    const current = joins[index].type;
    const nextIdx = (JOIN_TYPES.indexOf(current) + 1) % JOIN_TYPES.length;
    onJoinsChange(joins.map((j, i) => i === index ? { ...j, type: JOIN_TYPES[nextIdx] } : j));
  };

  // Detect if adding a join between two tables would create a cycle
  const wouldCreateCycle = (fromTable, toTable, currentJoins) => {
    const adj = {};
    for (const j of currentJoins) {
      if (!adj[j.from_table]) adj[j.from_table] = [];
      if (!adj[j.to_table]) adj[j.to_table] = [];
      adj[j.from_table].push(j.to_table);
      adj[j.to_table].push(j.from_table);
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
  const isDimension = (table, col) => dimensions.some((d) => norm(d.table) === norm(table) && norm(d.column) === norm(col));
  const isMeasure = (table, col) => measures.some((m) => norm(m.table) === norm(table) && norm(m.column) === norm(col));

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', overflow: 'hidden', position: 'relative', cursor: panning ? 'grabbing' : 'grab' }}
    >
      {/* Cycle warning */}
      {cycleWarning && (
        <div style={{
          position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
          zIndex: 20, display: 'flex', alignItems: 'center', gap: 8,
          background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8,
          padding: '10px 16px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          animation: 'fadeIn 0.2s ease',
        }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 22, height: 22, borderRadius: '50%',
            background: '#dc2626', color: '#fff', fontSize: 13, fontWeight: 700,
            flexShrink: 0,
          }}>!</span>
          <span style={{ fontSize: 12, color: '#991b1b', fontWeight: 500 }}>{cycleWarning}</span>
          <button className="btn-hover btn-hover-danger" onClick={() => setCycleWarning(null)} style={{
            background: 'transparent', border: '1px solid transparent', cursor: 'pointer',
            color: 'var(--state-danger)', fontSize: 16, padding: '2px 6px', lineHeight: 1, flexShrink: 0,
            borderRadius: 4,
          }}>x</button>
        </div>
      )}

      {/* Zoom controls */}
      <div style={{ position: 'absolute', bottom: 12, right: 12, zIndex: 10, display: 'flex', gap: 4, background: 'var(--bg-panel)', borderRadius: 6, boxShadow: '0 1px 4px rgba(0,0,0,0.12)', padding: 4 }}>
        <button className="btn-hover" onClick={() => setZoom((z) => Math.min(2, z + 0.15))} style={zoomBtn}>+</button>
        <span style={{ fontSize: 11, padding: '4px 6px', color: 'var(--text-muted)', minWidth: 36, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
        <button className="btn-hover" onClick={() => setZoom((z) => Math.max(0.3, z - 0.15))} style={zoomBtn}>-</button>
        <button className="btn-hover" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} style={{ ...zoomBtn, fontSize: 10, width: 'auto', padding: '4px 8px' }}>Reset</button>
      </div>

      <svg
        ref={svgRef}
        style={{ width: '100%', height: '100%' }}
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

          {/* Join lines */}
          {joins.map((join, i) => {
            // Determine which side to connect based on relative table positions
            const fromPos = positions[join.from_table] || { x: 0, y: 0 };
            const toPos = positions[join.to_table] || { x: 0, y: 0 };
            const fromCenter = fromPos.x + TABLE_WIDTH / 2;
            const toCenter = toPos.x + TABLE_WIDTH / 2;

            // If from table is to the left of to table: connect right → left
            // If from table is to the right: connect left → right
            const fromSide = fromCenter <= toCenter ? 'right' : 'left';
            const toSide = fromCenter <= toCenter ? 'left' : 'right';

            const from = getColumnPos(join.from_table, join.from_column, fromSide);
            const to = getColumnPos(join.to_table, join.to_column, toSide);
            const midX = (from.x + to.x) / 2;
            const midY = (from.y + to.y) / 2;

            // Arrow direction based on join type
            // LEFT: arrow points to right table (→)
            // RIGHT: arrow points to left table (←)
            // INNER: arrows both directions (↔)
            // FULL: arrows both directions (↔)
            let markerStart = 'none';
            let markerEnd = 'none';
            if (join.type === 'LEFT') {
              markerEnd = 'url(#arrow-right)';
            } else if (join.type === 'RIGHT') {
              markerStart = 'url(#arrow-right)';
            } else if (join.type === 'INNER' || join.type === 'FULL') {
              markerStart = 'url(#arrow-both-start)';
              markerEnd = 'url(#arrow-both-end)';
            }

            // Join type colors
            const joinColors = { LEFT: '#7c3aed', INNER: '#8b5cf6', RIGHT: '#f59e0b', FULL: '#10b981' };
            const color = joinColors[join.type] || '#7c3aed';

            return (
              <g key={`join-${i}`}>
                {/* Line */}
                <path
                  d={`M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x} ${to.y}`}
                  fill="none" stroke={color} strokeWidth={2}
                  markerEnd={markerEnd} markerStart={markerStart}
                />

                {/* Join type badge (clickable to cycle) */}
                <rect
                  x={midX - 24} y={midY - 12} width={48} height={20} rx={10}
                  fill={color} style={{ cursor: 'pointer' }}
                  onClick={(e) => { e.stopPropagation(); cycleJoinType(i); }}
                />
                <text x={midX} y={midY + 2} textAnchor="middle" fontSize={10} fill="#fff" fontWeight={700}
                  style={{ cursor: 'pointer', pointerEvents: 'none' }}>
                  {join.type}
                </text>

                {/* Delete button */}
                <circle cx={midX + 32} cy={midY - 2} r={7} fill="#fff" stroke="#fca5a5" strokeWidth={1}
                  style={{ cursor: 'pointer' }}
                  onClick={(e) => { e.stopPropagation(); onJoinsChange(joins.filter((_, idx) => idx !== i)); }}
                />
                <text x={midX + 32} y={midY + 1} textAnchor="middle" fontSize={9} fill="#dc2626"
                  style={{ pointerEvents: 'none' }}>x</text>
              </g>
            );
          })}

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
                  style={{ cursor: 'move' }} onMouseDown={(e) => handleTableMouseDown(e, tableName)} />
                {/* Clip path for text truncation */}
                <defs>
                  <clipPath id={`clip-header-${tableName.replace(/[^a-zA-Z0-9]/g, '_')}`}>
                    <rect x={8} y={0} width={TABLE_WIDTH - 36} height={HEADER_HEIGHT} />
                  </clipPath>
                </defs>
                {/* Schema name (small, above table name) */}
                {tableName.includes('.') && (
                  <text x={10} y={15} fontSize={9} fill="#94a3b8" fontWeight={400} style={{ pointerEvents: 'none' }}>
                    {tableName.split('.').slice(0, -1).join('.')}
                  </text>
                )}
                {/* Table name (truncated with clipPath) */}
                <g clipPath={`url(#clip-header-${tableName.replace(/[^a-zA-Z0-9]/g, '_')})`}>
                  <text x={10} y={tableName.includes('.') ? 30 : 28} fontSize={12} fill="#fff" fontWeight={600} style={{ pointerEvents: 'none' }}>
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
                          textAnchor="end" style={{ pointerEvents: 'none' }}>
                          {countText} rows
                        </text>
                      )}
                      <text x={TABLE_WIDTH - 22} y={15} fontSize={10} fill="#64748b"
                        textAnchor="end" style={{ cursor: 'pointer' }}
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
                          style={{ cursor: 'pointer' }}>
                          <title>Remove table from model</title>
                          <circle cx={TABLE_WIDTH - 10} cy={12} r={7} fill="rgba(255,255,255,0.15)" />
                          <text x={TABLE_WIDTH - 10} y={16} fontSize={11} fill="#fff" fontWeight={700}
                            textAnchor="middle" style={{ pointerEvents: 'none' }}>×</text>
                        </g>
                      )}
                    </g>
                  );
                })()}

                {/* Type bar — below header, click to cycle (none → dimension → fact → none) */}
                <rect y={HEADER_HEIGHT} width={TABLE_WIDTH} height={TYPE_BAR_HEIGHT}
                  fill={tColors ? tColors.badge : '#f1f5f9'} fillOpacity={tColors ? 0.1 : 1}
                  style={{ cursor: 'pointer' }}
                  onClick={(e) => { e.stopPropagation(); cycleTableType(tableName); }} />
                {tColors ? (
                  <g onClick={(e) => { e.stopPropagation(); cycleTableType(tableName); }} style={{ cursor: 'pointer' }}>
                    <rect x={TABLE_WIDTH / 2 - 22} y={HEADER_HEIGHT + 3} width={44} height={14} rx={7}
                      fill={tColors.badge} fillOpacity={0.2} stroke={tColors.badge} strokeWidth={1} />
                    <text x={TABLE_WIDTH / 2} y={HEADER_HEIGHT + 13} textAnchor="middle" fontSize={8} fill={tColors.badge} fontWeight={700}
                      style={{ pointerEvents: 'none' }}>
                      {tColors.label}
                    </text>
                  </g>
                ) : (
                  <text x={TABLE_WIDTH / 2} y={HEADER_HEIGHT + 14} textAnchor="middle" fontSize={8} fill="#94a3b8" fontWeight={500}
                    style={{ cursor: 'pointer' }}
                    onClick={(e) => { e.stopPropagation(); cycleTableType(tableName); }}>
                    click to set type
                  </text>
                )}

                {/* RLS badge — top-right of the type bar. Click opens the RLS configuration dialog. */}
                {onOpenRLS && (
                  <g
                    onClick={(e) => { e.stopPropagation(); onOpenRLS(tableName); }}
                    style={{ cursor: 'pointer' }}
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
                      style={{ pointerEvents: 'none' }}
                    >RLS</text>
                  </g>
                )}

                {/* Columns */}
                {visibleCols.map((col, ci) => {
                  const cy = HEADER_HEIGHT + TYPE_BAR_HEIGHT + ci * ROW_HEIGHT + ROW_HEIGHT / 2;
                  const isDim = isDimension(tableName, col.column_name);
                  const isMeas = isMeasure(tableName, col.column_name);
                  const numeric = isNumeric(col.data_type);
                  const isDate = isDateType?.(col.data_type);
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
                        const typeTruncated = (col.data_type || '').length > TYPE_MAX;
                        return (
                          <>
                            <text x={isId ? 18 : 8} y={cy + 4} fontSize={11} fill="#334155" style={{ fontWeight: isId ? 600 : 400 }}>
                              {truncate(col.column_name, NAME_MAX)}
                              {nameTruncated && <title>{col.column_name}</title>}
                            </text>
                            <text x={TABLE_WIDTH - (isDate ? 56 : 48)} y={cy + 4} fontSize={9} fill={isDate ? '#d97706' : '#94a3b8'} textAnchor="end">
                              {isDate ? '📅 ' : ''}{truncate(col.data_type, TYPE_MAX)}
                              {typeTruncated && <title>{col.data_type}</title>}
                            </text>
                          </>
                        );
                      })()}

                      {/* D / M buttons */}
                      <text x={TABLE_WIDTH - 36} y={cy + 4} fontSize={9}
                        fill={isDim ? '#7c3aed' : '#cbd5e1'} fontWeight={700}
                        style={{ cursor: 'pointer' }}
                        onClick={(e) => { e.stopPropagation(); onAddDimension(tableName, col); }}>
                        D
                      </text>
                      {numeric && (
                        <text x={TABLE_WIDTH - 22} y={cy + 4} fontSize={9}
                          fill={isMeas ? '#16a34a' : '#cbd5e1'} fontWeight={700}
                          style={{ cursor: 'pointer' }}
                          onClick={(e) => { e.stopPropagation(); onAddMeasure(tableName, col); }}>
                          M
                        </text>
                      )}

                      {/* Left dot */}
                      <circle cx={0} cy={cy} r={COL_DOT_RADIUS} fill="#fff" stroke="#94a3b8" strokeWidth={1.5}
                        style={{ cursor: 'crosshair' }} data-table={tableName} data-column={col.column_name}
                        onMouseDown={(e) => handleColumnDotDown(e, tableName, col.column_name, 'left')} />
                      {/* Right dot */}
                      <circle cx={TABLE_WIDTH} cy={cy} r={COL_DOT_RADIUS} fill="#fff" stroke="#94a3b8" strokeWidth={1.5}
                        style={{ cursor: 'crosshair' }} data-table={tableName} data-column={col.column_name}
                        onMouseDown={(e) => handleColumnDotDown(e, tableName, col.column_name, 'right')} />
                    </g>
                  );
                })}

                {/* Expand/collapse toggle */}
                {showToggle && (
                  <g
                    onClick={(e) => { e.stopPropagation(); toggleExpand(tableName); }}
                    style={{ cursor: 'pointer' }}
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
    </div>
  );
}

const zoomBtn = {
  width: 28, height: 28, border: '1px solid var(--border-default)', borderRadius: 4,
  background: 'var(--bg-panel)', cursor: 'pointer', fontSize: 16, fontWeight: 600,
  color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center',
};
