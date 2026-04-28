import { memo, useMemo, useState } from 'react';
import { pivotData, flattenHeaderLevels, resolveCell } from '../../utils/pivotEngine';
import formatNumber, { abbreviateNumber } from '../../utils/formatNumber';
import {
  getGridConfig, getRowConfig, getTotalsConfig, getFreezeConfig, ROW_HEIGHTS,
  getColumnHeaderStyle, getColumnValueStyle, getColumnDisplayName,
} from '../../utils/tableConfigHelpers';

/**
 * Build a tree of row groups for Power BI-style hierarchy.
 * Each node: { key, value, depth, children[], rowKey (leaf only) }
 */
function buildRowTree(rowKeys, rowDims) {
  const root = { key: '__root__', value: '', depth: -1, children: [] };
  for (const [rk, vals] of rowKeys) {
    let parent = root;
    for (let d = 0; d < rowDims.length; d++) {
      const v = String(vals[d] ?? '(blank)');
      const nodeKey = vals.slice(0, d + 1).join('\x00');
      let child = parent.children.find((c) => c.key === nodeKey);
      if (!child) {
        child = { key: nodeKey, value: v, depth: d, children: [], rowKeys: [] };
        parent.children.push(child);
      }
      if (d === rowDims.length - 1) {
        child.rowKeys.push(rk);
      }
      parent = child;
    }
  }
  return root;
}

/**
 * Flatten tree into display rows, respecting collapse state.
 * Each row: { type: 'group'|'leaf', node, depth, rk? }
 */
function flattenTree(node, collapsed, depth = 0) {
  const rows = [];
  for (const child of node.children) {
    const isLeaf = child.children.length === 0;
    const isCollapsed = collapsed.has(child.key);

    if (isLeaf) {
      // Leaf node — data row
      for (const rk of child.rowKeys) {
        rows.push({ type: 'leaf', node: child, depth, rk });
      }
    } else {
      // Group node — always show the group header
      rows.push({ type: 'group', node: child, depth, isCollapsed });
      // If expanded, show children
      if (!isCollapsed) {
        rows.push(...flattenTree(child, collapsed, depth + 1));
      }
    }
  }
  return rows;
}

export default memo(function PivotTableWidget({ data, config }) {
  const rawRows = data?.rawRows;
  const rowDims = data?._rowDims || [];
  const colDims = data?._colDims || [];
  const measures = data?._measures || [];
  const hasData = rawRows?.length > 0 && measures.length > 0;

  const tc = config?.tableConfig || {};
  const pc = config?.pivotConfig || {};
  const grid = getGridConfig(tc);
  const rowCfg = getRowConfig(tc);
  const totalsCfg = getTotalsConfig(tc);
  const freeze = getFreezeConfig(tc);
  const rowHeight = ROW_HEIGHTS[rowCfg.height] || ROW_HEIGHTS.normal;
  const showGrandRow = pc.showGrandTotalRow ?? true;
  const showGrandCol = pc.showGrandTotalCol ?? true;
  const valueAbbr = pc.valueAbbreviation || 'none';

  // Per-measure config resolver
  const getMeasureConfig = (measure, key, defaultVal) => {
    const perM = pc.perMeasure?.[measure]?.[key];
    if (perM !== undefined) return perM;
    return pc[key] ?? defaultVal;
  };

  const [collapsedGroups, setCollapsedGroups] = useState(new Set());
  const [hoveredRow, setHoveredRow] = useState(null);

  const toggleGroup = (key) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const showSubTotals = pc.showRowSubTotals ?? true;
  const defaultAgg = pc.defaultAggregation || 'sum';

  const pivot = useMemo(() => {
    if (!hasData) return null;
    // Build per-measure aggregation map from perMeasure config
    const aggFns = {};
    for (const m of measures) {
      const mAgg = pc.perMeasure?.[m]?.aggregation;
      if (mAgg) aggFns[m] = mAgg;
    }
    return pivotData({
      rawRows, rowDims, colDims, measures,
      aggregationFns: aggFns,
      defaultAggregation: defaultAgg,
    });
  }, [rawRows, rowDims, colDims, measures, hasData, pc.perMeasure, defaultAgg]);

  // Build row tree and flatten
  const rowTree = useMemo(() => {
    if (!pivot) return null;
    return buildRowTree(pivot.rowKeys, rowDims);
  }, [pivot, rowDims]);

  const displayRows = useMemo(() => {
    if (!rowTree) return [];
    return flattenTree(rowTree, collapsedGroups);
  }, [rowTree, collapsedGroups]);

  if (!hasData || !pivot) {
    if (data?._rowCount === 0) {
      if (config?.hideEmptyMessage) return <div style={emptyStyle} />;
      return <div style={emptyStyle}>{config?.emptyMessage || 'No values'}</div>;
    }
    return <div style={emptyStyle}>Drop dimensions into Rows/Columns and measures into Values</div>;
  }

  const { colKeys, cellMap, rowTotals, colTotals, grandTotal, subTotals, colTree, getFn } = pivot;
  const colLevels = colDims.length > 0 ? flattenHeaderLevels(colTree, colDims.length) : [];
  const numMeasures = measures.length;

  const formatVal = (val, measure) => {
    if (val == null) return '';
    const mAbbr = getMeasureConfig(measure, 'valueAbbreviation', valueAbbr);
    const abbr = abbreviateNumber(val, mAbbr);
    if (abbr != null) return abbr;
    const fmt = data._measureFormats?.[measure];
    return fmt ? formatNumber(val, fmt) : typeof val === 'number' ? val.toLocaleString() : String(val);
  };

  // Style resolvers — per column/measure overrides
  const hBorder = grid.horizontalLines ? `${grid.horizontalWidth}px solid ${grid.horizontalColor}` : 'none';
  const vBorder = grid.verticalLines ? `${grid.verticalWidth}px solid ${grid.verticalColor}` : 'none';
  const cellPad = grid.cellPadding || 6;
  const globalHs = getColumnHeaderStyle(tc, '__none__');
  const showHeaders = globalHs.show ?? true;

  const headerRowHeight = (cellPad * 2) + 16; // approximate row height

  const getHeaderStyle = (colName, stickyTop = 0) => {
    const hs = getColumnHeaderStyle(tc, colName);
    return {
      padding: cellPad,
      fontWeight: hs.fontBold !== false ? 600 : 400,
      fontStyle: hs.fontItalic ? 'italic' : 'normal',
      fontSize: hs.fontSize || 12,
      color: hs.fontColor || 'var(--text-primary)',
      backgroundColor: hs.bgColor || 'var(--bg-hover)',
      borderBottom: hBorder, borderRight: vBorder,
      whiteSpace: hs.wordWrap ? 'normal' : 'nowrap',
      position: freeze.stickyHeader ? 'sticky' : 'static',
      top: stickyTop, zIndex: 2, textAlign: hs.alignment || 'center',
    };
  };

  const getCellStyle = (measureName) => {
    const vs = getColumnValueStyle(tc, measureName);
    return {
      padding: cellPad,
      textAlign: vs.alignment === 'auto' || !vs.alignment ? 'right' : vs.alignment,
      fontSize: vs.fontSize || 12,
      color: vs.fontColor || 'var(--text-secondary)',
      fontWeight: vs.fontBold ? 600 : 400,
      fontStyle: vs.fontItalic ? 'italic' : 'normal',
      borderBottom: hBorder, borderRight: vBorder,
    };
  };

  // For row dimension cells: merge header + values overrides (header takes priority)
  const getRowDimCellStyle = () => {
    const vs = getColumnValueStyle(tc, 'Rows');
    return {
      padding: cellPad,
      fontSize: vs.fontSize || 12,
      color: vs.fontColor || 'var(--text-primary)',
      fontWeight: vs.fontBold ? 600 : 400,
      fontStyle: vs.fontItalic ? 'italic' : 'normal',
      backgroundColor: vs.bgColor || undefined,
      borderBottom: hBorder, borderRight: vBorder,
    };
  };

  const defaultHeaderStyle = getHeaderStyle('__none__');
  const totalStyle = {
    padding: cellPad, fontWeight: totalsCfg.fontBold ? 700 : 400,
    backgroundColor: totalsCfg.bgColor, color: totalsCfg.fontColor,
    borderBottom: hBorder, borderRight: vBorder, fontSize: 12, textAlign: 'right',
  };

  return (
    <div style={{ height: '100%', overflow: 'auto', fontSize: 12 }}>
      <table style={{
        borderCollapse: 'collapse', width: 'auto', minWidth: '100%',
        ...(grid.outerBorder ? { border: `${grid.outerBorderWidth}px solid ${grid.outerBorderColor}` } : {}),
      }}>
        {showHeaders && <thead>
          {/* Column dimension headers */}
          {colLevels.map((level, li) => (
            <tr key={`ch-${li}`}>
              {li === 0 && (
                <th rowSpan={colLevels.length + (numMeasures > 1 ? 1 : 0)}
                  style={{ ...getHeaderStyle('Rows', 0), minWidth: 160, backgroundColor: 'var(--accent-primary-soft)', color: 'var(--accent-primary-text)' }}>
                  {getColumnDisplayName(tc, 'Rows') !== 'Rows' ? getColumnDisplayName(tc, 'Rows') : rowDims.join(' / ')}
                </th>
              )}
              {level.map((item, ci) => (
                <th key={ci} colSpan={item.span * numMeasures} style={{ ...getHeaderStyle(colDims[li] || item.value, li * headerRowHeight), backgroundColor: 'var(--accent-primary-soft)', color: 'var(--accent-primary-text)' }}>
                  {item.value}
                </th>
              ))}
              {li === 0 && showGrandCol && (
                <th rowSpan={colLevels.length + (numMeasures > 1 ? 1 : 0)} colSpan={numMeasures}
                  style={{ ...getHeaderStyle('__none__', 0), backgroundColor: 'var(--bg-hover)', color: 'var(--text-primary)' }}>
                  Total
                </th>
              )}
            </tr>
          ))}
          {/* Measure names row (if multiple measures) */}
          {numMeasures > 1 && colDims.length > 0 && (
            <tr>
              {colKeys.map(([ck], ci) =>
                measures.map((m, mi) => (
                  <th key={`${ci}-${mi}`} style={{ ...getHeaderStyle(m, colLevels.length * headerRowHeight), fontSize: 10, fontWeight: 500, backgroundColor: 'var(--bg-hover)', color: 'var(--text-primary)' }}>{getColumnDisplayName(tc, m)}</th>
                ))
              )}
              {showGrandCol && measures.map((m, mi) => (
                <th key={`gt-${mi}`} style={{ ...getHeaderStyle('__none__', colLevels.length * headerRowHeight), fontSize: 10, fontWeight: 500, backgroundColor: 'var(--bg-hover)', color: 'var(--text-primary)' }}>{getColumnDisplayName(tc, m)}</th>
              ))}
            </tr>
          )}
          {/* If no col dims, show measure names as column headers */}
          {colDims.length === 0 && (
            <tr>
              <th style={{ ...getHeaderStyle('Rows'), minWidth: 160, backgroundColor: 'var(--accent-primary-soft)', color: 'var(--accent-primary-text)' }}>{getColumnDisplayName(tc, 'Rows') !== 'Rows' ? getColumnDisplayName(tc, 'Rows') : rowDims.join(' / ')}</th>
              {measures.map((m, mi) => (
                <th key={mi} style={{ ...getHeaderStyle(m), backgroundColor: 'var(--bg-hover)', color: 'var(--text-primary)' }}>{getColumnDisplayName(tc, m)}</th>
              ))}
              {showGrandCol && <th style={{ ...defaultHeaderStyle, backgroundColor: 'var(--bg-hover)' }}>Total</th>}
            </tr>
          )}
        </thead>}
        <tbody>
          {displayRows.map((row, idx) => {
            const isHovered = hoveredRow === idx;
            const isGroup = row.type === 'group';
            const depth = row.depth;
            const stripeBg = rowCfg.striped
              ? (idx % 2 === 0 ? rowCfg.stripeColor1 : rowCfg.stripeColor2)
              : 'var(--bg-panel)';
            const bg = isHovered && rowCfg.hoverHighlight ? rowCfg.hoverColor
              : isGroup ? 'var(--bg-subtle)' : stripeBg;

            if (isGroup) {
              // Group header row — show aggregated values (subtotals)
              const node = row.node;
              return (
                <tr key={`g-${node.key}`} style={{ height: rowHeight, backgroundColor: bg, fontWeight: 600 }}
                  onMouseEnter={rowCfg.hoverHighlight ? () => setHoveredRow(idx) : undefined}
                  onMouseLeave={rowCfg.hoverHighlight ? () => setHoveredRow(null) : undefined}>
                  {(() => {
                    const rs = getRowDimCellStyle();
                    return (
                      <td style={{
                        ...rs,
                        padding: `${cellPad}px ${cellPad}px ${cellPad}px ${cellPad + depth * 16}px`,
                        whiteSpace: 'nowrap', fontWeight: rs.fontWeight || 600, textAlign: 'left',
                        ...(freeze.freezeFirstColumn ? { position: 'sticky', left: 0, zIndex: 1, backgroundColor: bg, boxShadow: '2px 0 4px rgba(0,0,0,0.06)' } : {}),
                      }}>
                        <span onClick={() => toggleGroup(node.key)}
                          style={{ cursor: 'pointer', marginRight: 6, fontSize: 10, color: 'var(--text-muted)', display: 'inline-block', width: 12 }}>
                          {row.isCollapsed ? '▶' : '▼'}
                        </span>
                        {node.value}
                      </td>
                    );
                  })()}
                  {/* Subtotal values for this group */}
                  {colKeys.map(([ck]) =>
                    measures.map((m, mi) => {
                      const val = showSubTotals ? resolveCell(subTotals[node.key]?.[ck]?.[m], getFn(m)) : null;
                      return (
                        <td key={`${ck}-${mi}`} style={{
                          ...getCellStyle(m),
                          backgroundColor: isGroup ? 'var(--bg-subtle)' : undefined,
                        }}>
                          {val != null ? formatVal(val, m) : ''}
                        </td>
                      );
                    })
                  )}
                  {/* Row total for this group */}
                  {showGrandCol && measures.map((m, mi) => {
                    const val = showSubTotals ? resolveCell(subTotals[node.key]?.__rowTotal__?.[m], getFn(m)) : null;
                    return (
                      <td key={`rt-${mi}`} style={{
                        padding: cellPad, textAlign: 'right', fontWeight: 600, fontSize: 12,
                        backgroundColor: 'var(--bg-panel-alt)', borderBottom: hBorder, borderRight: vBorder,
                      }}>
                        {val != null ? formatVal(val, m) : ''}
                      </td>
                    );
                  })}
                </tr>
              );
            }

            // Leaf row — actual data
            const rk = row.rk;
            const node = row.node;
            return (
              <tr key={`l-${rk}`} style={{ height: rowHeight, backgroundColor: bg }}
                onMouseEnter={rowCfg.hoverHighlight ? () => setHoveredRow(idx) : undefined}
                onMouseLeave={rowCfg.hoverHighlight ? () => setHoveredRow(null) : undefined}>
                {(() => {
                  const rs = getRowDimCellStyle();
                  return (
                    <td style={{
                      ...rs,
                      padding: `${cellPad}px ${cellPad}px ${cellPad}px ${cellPad + depth * 16}px`,
                      whiteSpace: 'nowrap', textAlign: 'left',
                      ...(freeze.freezeFirstColumn ? { position: 'sticky', left: 0, zIndex: 1, backgroundColor: bg, boxShadow: '2px 0 4px rgba(0,0,0,0.06)' } : {}),
                    }}>
                      {rowDims.length <= 1 ? node.value : (
                        <span style={{ marginLeft: 18 }}>{node.value}</span>
                      )}
                    </td>
                  );
                })()}
                {colKeys.map(([ck]) =>
                  measures.map((m, mi) => {
                    const val = resolveCell(cellMap[rk]?.[ck]?.[m], getFn(m));
                    return (
                      <td key={`${ck}-${mi}`} style={{
                        padding: cellPad, textAlign: 'right', fontSize: 12,
                        color: 'var(--text-secondary)', borderBottom: hBorder, borderRight: vBorder,
                      }}>
                        {formatVal(val, m)}
                      </td>
                    );
                  })
                )}
                {showGrandCol && measures.map((m, mi) => {
                  const val = resolveCell(pivot.rowTotals[rk]?.[m], getFn(m));
                  return (
                    <td key={`rt-${mi}`} style={{
                      padding: cellPad, textAlign: 'right', fontWeight: 600, fontSize: 12,
                      backgroundColor: 'var(--bg-subtle)', borderBottom: hBorder, borderRight: vBorder,
                    }}>
                      {formatVal(val, m)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
        {/* Grand total row */}
        {showGrandRow && (
          <tfoot>
            <tr style={{
              backgroundColor: totalsCfg.bgColor,
              position: freeze.stickyHeader ? 'sticky' : 'static',
              bottom: 0, zIndex: 2,
            }}>
              <td style={{ ...totalStyle, textAlign: 'left', fontWeight: 700 }}>Grand Total</td>
              {colKeys.map(([ck]) =>
                measures.map((m, mi) => (
                  <td key={`${ck}-${mi}`} style={totalStyle}>
                    {formatVal(resolveCell(colTotals[ck]?.[m], getFn(m)), m)}
                  </td>
                ))
              )}
              {showGrandCol && measures.map((m, mi) => (
                <td key={`gt-${mi}`} style={{ ...totalStyle, fontWeight: 700, backgroundColor: 'var(--bg-hover)' }}>
                  {formatVal(resolveCell(grandTotal[m], getFn(m)), m)}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
});

const emptyStyle = {
  height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: 'var(--text-disabled)', fontSize: 12, textAlign: 'center', padding: 16,
};
