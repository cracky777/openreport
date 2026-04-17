import { useRef, useCallback, useMemo, useState, memo } from 'react';
import formatNumber, { abbreviateNumber } from '../../utils/formatNumber';
import {
  getColumnHeaderStyle, getColumnValueStyle, getColumnDisplayName,
  getColumnWidth, getColumnTotalFn, getGridConfig, getRowConfig,
  getTotalsConfig, getFreezeConfig, ROW_HEIGHTS,
  computeTotal, getConditionalStyle,
} from '../../utils/tableConfigHelpers';

export default memo(function TableWidget({ data, config, onLoadMore, onConfigUpdate }) {
  const columns = data?.columns;
  const rows = data?.rows;
  const hasData = columns?.length > 0 && rows?.length > 0;
  const scrollRef = useRef(null);
  const loadingMore = data?._loadingMore || false;
  const hasMore = data?._hasMore !== false;

  const tc = config?.tableConfig || {};
  const grid = getGridConfig(tc);
  const rowCfg = getRowConfig(tc);
  const totalsCfg = getTotalsConfig(tc);
  const freeze = getFreezeConfig(tc);
  const sortCol = tc.sort?.columnName || null;
  const sortDir = tc.sort?.direction || 'asc';
  const paginationMode = tc.pagination?.mode || 'infinite';
  const rowsPerPage = tc.pagination?.rowsPerPage || 50;
  const showHeaders = tc.header?.show ?? config?.showColumnNames ?? true;
  const rowHeight = ROW_HEIGHTS[rowCfg.height] || ROW_HEIGHTS.normal;

  const [hoveredRow, setHoveredRow] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [resizingCol, setResizingCol] = useState(null);
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

  // Column resize
  const handleResizeStart = (e, colName) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = colWidths[colName] || getColumnWidth(tc, colName) || 120;
    const onMove = (ev) => {
      const newW = Math.max(40, startW + ev.clientX - startX);
      setColWidths((p) => ({ ...p, [colName]: newW }));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  if (!hasData) {
    return <div style={emptyStyle}>Select dimensions & measures to display a table</div>;
  }

  const isFixedWidth = tc.columnWidthMode === 'fixed';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
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
          {isFixedWidth && (
            <colgroup>
              {columns.map((col, i) => (
                <col key={i} style={{ width: colWidths[col] || getColumnWidth(tc, col) || undefined }} />
              ))}
            </colgroup>
          )}

          {/* HEADER */}
          {showHeaders && (
            <thead>
              <tr>
                {columns.map((col, ci) => {
                  const hs = getColumnHeaderStyle(tc, col);
                  const displayName = getColumnDisplayName(tc, col);
                  const isFrozenCol = freeze.freezeFirstColumn && ci === 0;
                  return (
                    <th
                      key={ci}
                      onClick={() => handleSort(col)}
                      style={{
                        padding: `${grid.cellPadding}px`,
                        fontSize: hs.fontSize || 13,
                        color: hs.fontColor || '#334155',
                        fontWeight: hs.fontBold !== false ? 600 : 400,
                        fontStyle: hs.fontItalic ? 'italic' : 'normal',
                        backgroundColor: hs.bgColor || '#f8fafc',
                        textAlign: hs.alignment || 'left',
                        whiteSpace: hs.wordWrap ? 'normal' : 'nowrap',
                        overflow: hs.wordWrap ? 'visible' : 'hidden',
                        textOverflow: hs.wordWrap ? 'unset' : 'ellipsis',
                        maxWidth: hs.wordWrap ? 'none' : 200,
                        borderBottom: grid.horizontalLines ? `${grid.horizontalWidth}px solid ${grid.horizontalColor}` : 'none',
                        borderRight: grid.verticalLines && ci < columns.length - 1 ? `${grid.verticalWidth}px solid ${grid.verticalColor}` : 'none',
                        position: freeze.stickyHeader ? 'sticky' : 'static',
                        top: 0,
                        left: isFrozenCol ? 0 : undefined,
                        zIndex: freeze.stickyHeader && isFrozenCol ? 3 : freeze.stickyHeader ? 2 : isFrozenCol ? 1 : 'auto',
                        cursor: 'pointer',
                        userSelect: 'none',
                        boxShadow: isFrozenCol ? '2px 0 4px rgba(0,0,0,0.06)' : undefined,
                      }}
                    >
                      <span style={{ position: 'relative', paddingRight: 14 }}>
                        {displayName}
                        {sortCol === col && (
                          <span style={{ position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)', fontSize: 10, color: '#3b82f6' }}>
                            {sortDir === 'asc' ? '▲' : '▼'}
                          </span>
                        )}
                      </span>
                      {/* Resize handle */}
                      <div
                        onMouseDown={(e) => handleResizeStart(e, col)}
                        style={{
                          position: 'absolute', right: 0, top: 0, bottom: 0, width: 4,
                          cursor: 'col-resize', zIndex: 5,
                        }}
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
                : rowCfg.stripeColor1 || '#fff';
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

                    // Format
                    const nf = vs.numberFormat || {};
                    const fmt = data._measureFormats?.[col];
                    let display = cell;
                    if (isNum) {
                      const abbr = abbreviateNumber(numVal, nf.abbreviation || 'none');
                      if (abbr != null) display = abbr;
                      else if (fmt) display = formatNumber(numVal, nf.decimals != null ? { ...fmt, decimals: nf.decimals } : fmt);
                      else if (nf.decimals != null) display = numVal.toFixed(nf.decimals);
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
                          color: vs.fontColor || '#475569',
                          fontWeight: vs.fontBold ? 600 : 400,
                          fontStyle: vs.fontItalic ? 'italic' : 'normal',
                          textAlign: align,
                          whiteSpace: vs.wordWrap ? 'normal' : 'nowrap',
                          overflow: vs.wordWrap ? 'visible' : 'hidden',
                          textOverflow: vs.wordWrap ? 'unset' : 'ellipsis',
                          maxWidth: vs.wordWrap ? 'none' : 250,
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
                  const display = typeof val === 'number' ? (fmt ? formatNumber(val, fmt) : val.toLocaleString()) : val;

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
          <div style={{ padding: 12, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>
            Loading more rows...
          </div>
        )}
        {paginationMode === 'infinite' && !hasMore && sortedRows.length > 0 && (
          <div style={{ padding: 8, textAlign: 'center', color: '#cbd5e1', fontSize: 11 }}>
            All {sortedRows.length} rows loaded
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
          <span style={{ fontSize: 11, color: '#64748b' }}>
            {currentPage} / {totalPages}
          </span>
          <button
            disabled={currentPage >= totalPages}
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            style={pageBtn}
          >
            ▶
          </button>
          <span style={{ fontSize: 10, color: '#94a3b8', marginLeft: 8 }}>
            {sortedRows.length} rows
          </span>
        </div>
      )}
    </div>
  );
});

const emptyStyle = {
  height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: '#94a3b8', fontSize: 12, textAlign: 'center', padding: 16,
};

const paginationStyle = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  gap: 8, padding: '6px 0', borderTop: '1px solid #e2e8f0', flexShrink: 0,
};

const pageBtn = {
  background: 'none', border: '1px solid #e2e8f0', borderRadius: 4,
  padding: '2px 8px', cursor: 'pointer', fontSize: 11, color: '#475569',
};
