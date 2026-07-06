import { useRef, useCallback, useMemo, useState, memo } from 'react';
import formatNumber, { abbreviateNumber } from '../../utils/formatNumber';
import { formatDuration } from '../../utils/formatHuman';
import { fontStack, loadGoogleFont } from '../../utils/googleFonts';
import {
  getColumnHeaderStyle, getColumnValueStyle, getColumnDisplayName,
  getColumnWidth, getColumnTotalFn, getGridConfig, getRowConfig,
  getTotalsConfig, getFreezeConfig, ROW_HEIGHTS,
  computeTotal, getConditionalStyle,
} from '../../utils/tableConfigHelpers';

const _hs0 = { display: 'flex', flexDirection: 'column', height: '100%' };
const _hs1 = { position: 'relative', paddingRight: 14 };
const _hs2 = { position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)', fontSize: 10, color: 'var(--accent-primary)' };
const _hs3 = {
                          position: 'absolute', right: 0, top: 0, bottom: 0, width: 4,
                          cursor: 'col-resize', zIndex: 5,
                        };
const _hs4 = { padding: 12, textAlign: 'center', color: 'var(--text-disabled)', fontSize: 12 };
const _hs5 = { fontSize: 11, color: 'var(--text-muted)' };
const _hs6 = { fontSize: 10, color: 'var(--text-disabled)', marginLeft: 8 };

export default memo(function TableWidget({ data, config, columnOrder, onLoadMore, onConfigUpdate }) {
  const rawColumns = data?.columns;
  const rawRows = data?.rows;

  // Reorder columns according to columnOrder (allows mixing dims and measures)
  const { columns, rows } = useMemo(() => {
    if (!rawColumns || !rawRows || !columnOrder || columnOrder.length === 0) {
      return { columns: rawColumns, rows: rawRows };
    }
    // columnOrder contains field names like "table.col", columns contains labels like "col"
    // Match by suffix: columnOrder entry ends with the column label
    const colIndices = [];
    const used = new Set();
    const newCols = [];
    // Build a mapping: for each columnOrder entry, find matching column index
    for (const orderName of columnOrder) {
      const parts = orderName.split('.');
      const suffix = parts[parts.length - 1].replace(/_sum$|_avg$|_count$|_min$|_max$/, '');
      const idx = rawColumns.findIndex((c, i) => !used.has(i) && c === suffix);
      if (idx !== -1) {
        used.add(idx);
        colIndices.push(idx);
        newCols.push(rawColumns[idx]);
      }
    }
    // Add remaining columns not in columnOrder
    rawColumns.forEach((c, i) => {
      if (!used.has(i)) { colIndices.push(i); newCols.push(c); }
    });
    const newRows = rawRows.map((row) => colIndices.map((i) => row[i]));
    return { columns: newCols, rows: newRows };
  }, [rawColumns, rawRows, columnOrder]);

  const hasData = columns?.length > 0 && rows?.length > 0;
  const scrollRef = useRef(null);
  const loadingMore = data?._loadingMore || false;
  const hasMore = data?._hasMore !== false;

  const tc = config?.tableConfig || {};
  const grid = getGridConfig(tc);
  const rowCfg = getRowConfig(tc);
  const totalsCfg = getTotalsConfig(tc);
  // Lazy-load any Fontsource face referenced by the table config so the
  // first paint already uses the right typeface instead of the fallback.
  if (tc.header?.fontFamily) loadGoogleFont(tc.header.fontFamily);
  if (tc.values?.fontFamily) loadGoogleFont(tc.values.fontFamily);
  const freeze = getFreezeConfig(tc);
  const sortCol = tc.sort?.columnName || null;
  const sortDir = tc.sort?.direction || 'asc';
  const paginationMode = tc.pagination?.mode || 'infinite';
  const rowsPerPage = tc.pagination?.rowsPerPage || 50;
  const showHeaders = tc.header?.show ?? config?.showColumnNames ?? true;
  const rowHeight = ROW_HEIGHTS[rowCfg.height] || ROW_HEIGHTS.normal;

  const [hoveredRow, setHoveredRow] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [colWidths, setColWidths] = useState({});

  // Sort rows
  const sortedRows = useMemo(() => {
    if (!rows || !sortCol) return rows;
    const colIdx = columns?.indexOf(sortCol);
    if (colIdx == null || colIdx === -1) return rows;
    return [...rows].sort((a, b) => {
      const va = a[colIdx], vb = b[colIdx];
      const na = parseFloat(va), nb = parseFloat(vb);
      const isNum = !isNaN(na) && !isNaN(nb);
      const cmp = isNum ? na - nb : String(va || '').localeCompare(String(vb || ''));
      return sortDir === 'desc' ? -cmp : cmp;
    });
  }, [rows, columns, sortCol, sortDir]);

  // Paginate
  const displayRows = useMemo(() => {
    if (!sortedRows) return [];
    if (paginationMode === 'paginated') {
      const start = (currentPage - 1) * rowsPerPage;
      return sortedRows.slice(start, start + rowsPerPage);
    }
    return sortedRows;
  }, [sortedRows, paginationMode, currentPage, rowsPerPage]);

  const totalPages = sortedRows ? Math.ceil(sortedRows.length / rowsPerPage) : 1;

  // Column values for conditional formatting
  const colValuesCache = useMemo(() => {
    if (!rows || !columns) return {};
    const cache = {};
    columns.forEach((col, ci) => {
      const rules = tc.columns?.[col]?.conditionalFormatting;
      if (rules && rules.length > 0) {
        cache[col] = rows.map((r) => r[ci]);
      }
    });
    return cache;
  }, [rows, columns, tc.columns]);

  // Lookup set for interval-typed measures so per-cell / per-total checks
  // don't re-scan the duration-columns array on every cell render.
  const durationCols = useMemo(
    () => new Set(Array.isArray(data?._durationColumns) ? data._durationColumns : []),
    [data?._durationColumns],
  );

  // Scroll handler for infinite mode
  const handleScroll = useCallback(() => {
    if (paginationMode !== 'infinite') return;
    if (!scrollRef.current || !onLoadMore || loadingMore || !hasMore) return;
    const el = scrollRef.current;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 100) onLoadMore();
  }, [onLoadMore, loadingMore, hasMore, paginationMode]);

  // Sort click
  const handleSort = (colName) => {
    if (!onConfigUpdate) return;
    const newSort = sortCol === colName
      ? (sortDir === 'asc' ? { columnName: colName, direction: 'desc' } : { columnName: null, direction: 'asc' })
      : { columnName: colName, direction: 'asc' };
    onConfigUpdate('tableConfig', { ...tc, sort: newSort });
    setCurrentPage(1);
  };

  // Column resize. Local state during drag (fast, no React re-render
  // storm on every pixel of mousemove); persist into config on mouseup
  // so the width survives across re-renders + saves.
  const handleResizeStart = (e, colName) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = colWidths[colName] || getColumnWidth(tc, colName) || 120;
    let lastW = startW;
    const onMove = (ev) => {
      const newW = Math.max(40, startW + ev.clientX - startX);
      lastW = newW;
      setColWidths((p) => ({ ...p, [colName]: newW }));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      // Persist the final width onto tc.columns[colName].width so a
      // re-render (model reload, sort click, …) doesn't snap back to
      // the auto-layout default. tc is closure-captured at resize
      // start; one column drag at a time, so it's never stale.
      if (lastW !== startW) {
        const prevCol = (tc.columns && tc.columns[colName]) || {};
        const nextColumns = { ...(tc.columns || {}), [colName]: { ...prevCol, width: lastW } };
        onConfigUpdate?.('tableConfig', { ...tc, columns: nextColumns });
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  if (!hasData) {
    if (data?._rowCount === 0) {
      if (config?.hideEmptyMessage) return <div style={emptyStyle} />;
      return <div style={emptyStyle}>{config?.emptyMessage || 'No values'}</div>;
    }
    return <div style={emptyStyle}>Select dimensions & measures to display a table</div>;
  }

  const isFixedWidth = tc.columnWidthMode === 'fixed';

  return (
    <div style={_hs0}>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        style={{ flex: 1, overflow: 'auto', fontSize: config?.fontSize || 13 }}
      >
        <table style={{
          width: '100%', borderCollapse: 'collapse',
          tableLayout: isFixedWidth ? 'fixed' : 'auto',
          ...(grid.outerBorder ? { border: `${grid.outerBorderWidth}px solid ${grid.outerBorderColor}` } : {}),
        }}>
          {(() => {
            // Render the colgroup whenever ANY column has an explicit
            // width — either from the saved tableConfig (fixed-width
            // mode) or from a user drag (any mode). Without this, an
            // auto-width table's drag updates colWidths but nothing
            // visible changes because <col> never lands. Per-column
            // explicit widths in an otherwise auto-laid table work:
            // the <col> hint sizes that column, others stay auto.
            const explicitForCol = (col) =>
              colWidths[col] || getColumnWidth(tc, col) || null;
            const anyExplicit = isFixedWidth
              || columns.some((c) => explicitForCol(c));
            if (!anyExplicit) return null;
            return (
              <colgroup>
                {columns.map((col, i) => {
                  const w = explicitForCol(col);
                  return <col key={i} style={w ? { width: w } : undefined} />;
                })}
              </colgroup>
            );
          })()}

          {/* HEADER */}
          {showHeaders && (
            <thead>
              <tr>
                {columns.map((col, ci) => {
                  const hs = getColumnHeaderStyle(tc, col);
                  const displayName = getColumnDisplayName(tc, col);
                  const isFrozenCol = freeze.freezeFirstColumn && ci === 0;
                  // Auto-wrap when the column has an explicit width
                  // (user dragged or persisted). Without this, narrowing
                  // a column with the resize handle would just clip the
                  // content with an ellipsis — visually useful only for
                  // widening. `hs.wordWrap === false` keeps the explicit
                  // no-wrap intent if the user toggled it off in the
                  // header style options.
                  const hasExplicitW = !!(colWidths[col] || getColumnWidth(tc, col));
                  const hWrap = hs.wordWrap === true
                    || (hs.wordWrap !== false && hasExplicitW);
                  return (
                    <th
                      key={ci}
                      onClick={() => handleSort(col)}
                      style={{
                        padding: `${grid.cellPadding}px`,
                        fontSize: hs.fontSize || 13,
                        color: hs.fontColor || 'var(--text-primary)',
                        fontFamily: hs.fontFamily ? fontStack(hs.fontFamily) : undefined,
                        fontWeight: hs.fontBold !== false ? 600 : 400,
                        fontStyle: hs.fontItalic ? 'italic' : 'normal',
                        backgroundColor: hs.bgColor || 'var(--bg-hover)',
                        textAlign: hs.alignment || 'left',
                        whiteSpace: hWrap ? 'normal' : 'nowrap',
                        overflow: hWrap ? 'visible' : 'hidden',
                        textOverflow: hWrap ? 'unset' : 'ellipsis',
                        // Drop the 200px maxWidth when there's an
                        // explicit column width — that width IS the
                        // bound now, the maxWidth would otherwise lock
                        // a user-resized wide column to 200px.
                        maxWidth: hWrap ? 'none' : (hasExplicitW ? 'none' : 200),
                        // Allow long words (URLs, IDs) to break inside
                        // when wrapping is on — `overflow-wrap: anywhere`
                        // is the modern way to break unbreakable strings.
                        overflowWrap: hWrap ? 'anywhere' : 'normal',
                        borderBottom: grid.horizontalLines ? `${grid.horizontalWidth}px solid ${grid.horizontalColor}` : 'none',
                        borderRight: grid.verticalLines && ci < columns.length - 1 ? `${grid.verticalWidth}px solid ${grid.verticalColor}` : 'none',
                        // Header positioning. Three modes that all need a
                        // containing block for the absolutely positioned
                        // resize handle below (otherwise the handle
                        // escapes the th's rect → no col-resize cursor +
                        // no drag):
                        //   - stickyHeader → sticky to top during scroll
                        //   - frozen first column → sticky to left
                        //     during horizontal scroll (matches the
                        //     body-cell sticky on line 332; without this
                        //     the header of col 0 drifted out of sync
                        //     with the frozen body, and the user
                        //     reported they couldn't grab the resize
                        //     handle for the leftmost column)
                        //   - neither → relative (still a containing
                        //     block, just no sticky scroll behaviour)
                        position: (freeze.stickyHeader || isFrozenCol) ? 'sticky' : 'relative',
                        top: 0,
                        left: isFrozenCol ? 0 : undefined,
                        zIndex: freeze.stickyHeader && isFrozenCol ? 3 : freeze.stickyHeader ? 2 : isFrozenCol ? 1 : 'auto',
                        cursor: 'pointer',
                        userSelect: 'none',
                        boxShadow: isFrozenCol ? '2px 0 4px rgba(0,0,0,0.06)' : undefined,
                      }}
                    >
                      <span style={_hs1}>
                        {displayName}
                        {sortCol === col && (
                          <span style={_hs2}>
                            {sortDir === 'asc' ? '▲' : '▼'}
                          </span>
                        )}
                      </span>
                      {/* Resize handle */}
                      <div
                        onMouseDown={(e) => handleResizeStart(e, col)}
                        style={_hs3}
                      />
                    </th>
                  );
                })}
              </tr>
            </thead>
          )}

          {/* BODY */}
          <tbody>
            {displayRows.map((row, ri) => {
              const isHovered = hoveredRow === ri;
              const stripeBg = rowCfg.striped
                ? (ri % 2 === 0 ? rowCfg.stripeColor1 : rowCfg.stripeColor2)
                : rowCfg.stripeColor1 || 'var(--bg-panel)';
              const rowBg = isHovered && rowCfg.hoverHighlight ? rowCfg.hoverColor : stripeBg;

              return (
                <tr
                  key={ri}
                  onMouseEnter={rowCfg.hoverHighlight ? () => setHoveredRow(ri) : undefined}
                  onMouseLeave={rowCfg.hoverHighlight ? () => setHoveredRow(null) : undefined}
                  style={{ height: rowHeight, backgroundColor: rowBg, transition: 'background-color 0.1s' }}
                >
                  {row.map((cell, ci) => {
                    const col = columns[ci];
                    const vs = getColumnValueStyle(tc, col);
                    const numVal = parseFloat(cell);
                    const isNum = !isNaN(numVal) && cell !== '' && cell != null;
                    const align = vs.alignment === 'auto' || !vs.alignment ? (isNum ? 'right' : 'left') : vs.alignment;
                    const isFrozenCol = freeze.freezeFirstColumn && ci === 0;
                    // Same auto-wrap rule as the header: explicit width
                    // (drag / persisted) defaults to wrapping content so
                    // narrowing the column doesn't just ellipsis-clip.
                    // `vs.wordWrap === false` keeps the explicit no-wrap
                    // intent if set in the column value-style options.
                    const hasExplicitW = !!(colWidths[col] || getColumnWidth(tc, col));
                    const cellWrap = vs.wordWrap === true
                      || (vs.wordWrap !== false && hasExplicitW);
                    // Interval-typed measures arrive as EPOCH seconds (the
                    // server flattens INTERVAL values to a number) — format
                    // them as a duration ("1h", "30min", "45s") rather than
                    // showing the raw second count.
                    const isDurationCol = durationCols.has(col);

                    // Format
                    const nf = vs.numberFormat || {};
                    const fmt = data._measureFormats?.[col];
                    let display = cell;
                    if (isNum) {
                      if (isDurationCol) {
                        display = formatDuration(numVal);
                      } else {
                        const abbr = abbreviateNumber(numVal, nf.abbreviation || 'none');
                        if (abbr != null) display = abbr;
                        else if (fmt) display = formatNumber(numVal, nf.decimals != null ? { ...fmt, decimals: nf.decimals } : fmt);
                        else if (nf.decimals != null) display = numVal.toFixed(nf.decimals);
                      }
                    }

                    // Conditional formatting
                    const rules = tc.columns?.[col]?.conditionalFormatting;
                    const cf = rules ? getConditionalStyle(rules, cell, colValuesCache[col] || []) : { style: {}, extraElements: [] };

                    return (
                      <td
                        key={ci}
                        style={{
                          padding: `${Math.max(2, grid.cellPadding - 2)}px ${grid.cellPadding}px`,
                          fontSize: vs.fontSize || 13,
                          color: vs.fontColor || 'var(--text-secondary)',
                          fontFamily: vs.fontFamily ? fontStack(vs.fontFamily) : undefined,
                          fontWeight: vs.fontBold ? 600 : 400,
                          fontStyle: vs.fontItalic ? 'italic' : 'normal',
                          textAlign: align,
                          whiteSpace: cellWrap ? 'normal' : 'nowrap',
                          overflow: cellWrap ? 'visible' : 'hidden',
                          textOverflow: cellWrap ? 'unset' : 'ellipsis',
                          maxWidth: cellWrap ? 'none' : (hasExplicitW ? 'none' : 250),
                          overflowWrap: cellWrap ? 'anywhere' : 'normal',
                          borderBottom: grid.horizontalLines ? `${grid.horizontalWidth}px solid ${grid.horizontalColor}` : 'none',
                          borderRight: grid.verticalLines && ci < columns.length - 1 ? `${grid.verticalWidth}px solid ${grid.verticalColor}` : 'none',
                          position: isFrozenCol ? 'sticky' : 'static',
                          left: isFrozenCol ? 0 : undefined,
                          zIndex: isFrozenCol ? 1 : 'auto',
                          backgroundColor: isFrozenCol ? rowBg : undefined,
                          boxShadow: isFrozenCol ? '2px 0 4px rgba(0,0,0,0.06)' : undefined,
                          ...cf.style,
                        }}
                      >
                        {cf.extraElements?.map((el, ei) => (
                          <span key={ei} style={{ color: el.color, marginRight: 4, fontSize: 12 }}>{el.icon}</span>
                        ))}
                        {!(tc.columns?.[col]?.hideValue) && display}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>

          {/* TOTALS */}
          {totalsCfg.enabled && sortedRows && (
            <tfoot>
              <tr style={{
                backgroundColor: totalsCfg.bgColor,
                fontWeight: totalsCfg.fontBold ? 700 : 400,
                color: totalsCfg.fontColor,
                position: freeze.stickyHeader ? 'sticky' : 'static',
                bottom: 0, zIndex: 2,
              }}>
                {columns.map((col, ci) => {
                  const fn = getColumnTotalFn(tc, col);
                  const val = computeTotal(sortedRows, ci, fn);
                  const fmt = data._measureFormats?.[col];
                  const isDurationCol = durationCols.has(col);
                  const display = typeof val === 'number'
                    ? (isDurationCol ? formatDuration(val) : (fmt ? formatNumber(val, fmt) : val.toLocaleString()))
                    : val;

                  return (
                    <td key={ci} style={{
                      padding: `${grid.cellPadding}px`,
                      borderTop: `${totalsCfg.borderTopWidth}px solid ${totalsCfg.borderTopColor}`,
                      textAlign: typeof val === 'number' ? 'right' : 'left',
                      borderRight: grid.verticalLines && ci < columns.length - 1 ? `${grid.verticalWidth}px solid ${grid.verticalColor}` : 'none',
                    }}>
                      {ci === 0 && typeof val !== 'number' ? 'Total' : display}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          )}
        </table>

        {/* Infinite scroll indicators */}
        {paginationMode === 'infinite' && loadingMore && (
          <div style={_hs4}>
            Loading more rows...
          </div>
        )}
      </div>

      {/* Pagination controls */}
      {paginationMode === 'paginated' && totalPages > 1 && (
        <div style={paginationStyle}>
          <button
            disabled={currentPage <= 1}
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            style={pageBtn}
          >
            ◀
          </button>
          <span style={_hs5}>
            {currentPage} / {totalPages}
          </span>
          <button
            disabled={currentPage >= totalPages}
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            style={pageBtn}
          >
            ▶
          </button>
          <span style={_hs6}>
            {sortedRows.length} rows
          </span>
        </div>
      )}
    </div>
  );
});

const emptyStyle = {
  height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: 'var(--text-disabled)', fontSize: 12, textAlign: 'center', padding: 16,
};

const paginationStyle = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  gap: 8, padding: '6px 0', borderTop: '1px solid var(--border-default)', flexShrink: 0,
};

const pageBtn = {
  background: 'transparent', border: '1px solid var(--border-default)', borderRadius: 4,
  padding: '2px 8px', cursor: 'pointer', fontSize: 11, color: 'var(--text-secondary)',
};
