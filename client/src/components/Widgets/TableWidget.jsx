import { useRef, useCallback } from 'react';
import formatNumber from '../../utils/formatNumber';

export default function TableWidget({ data, config, onLoadMore }) {
  const columns = data?.columns;
  const rows = data?.rows;
  const hasData = columns?.length > 0 && rows?.length > 0;
  const scrollRef = useRef(null);
  const loadingMore = data?._loadingMore || false;
  const hasMore = data?._hasMore !== false; // true by default unless explicitly set to false

  const handleScroll = useCallback(() => {
    if (!scrollRef.current || !onLoadMore || loadingMore || !hasMore) return;
    const el = scrollRef.current;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    if (nearBottom) {
      onLoadMore();
    }
  }, [onLoadMore, loadingMore, hasMore]);

  if (!hasData) {
    return <div style={emptyStyle}>Select dimensions & measures to display a table</div>;
  }

  const showHeaders = config?.showColumnNames ?? true;

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      style={{ height: '100%', overflow: 'auto', fontSize: config?.fontSize || 13 }}
    >
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        {showHeaders && (
          <thead>
            <tr>
              {columns.map((col, i) => (
                <th
                  key={i}
                  style={{
                    padding: '8px 12px',
                    textAlign: 'left',
                    borderBottom: '2px solid #e2e8f0',
                    backgroundColor: config?.headerBg || '#f8fafc',
                    color: config?.headerColor || '#334155',
                    fontWeight: 600,
                    position: 'sticky',
                    top: 0,
                    zIndex: 1,
                  }}
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ backgroundColor: i % 2 === 0 ? '#fff' : '#f8fafc' }}>
              {row.map((cell, j) => {
                const colName = columns[j];
                const fmt = data._measureFormats?.[colName];
                const numVal = parseFloat(cell);
                const display = fmt && !isNaN(numVal) ? formatNumber(numVal, fmt) : cell;
                return (
                  <td
                    key={j}
                    style={{
                      padding: '6px 12px',
                      borderBottom: '1px solid #e2e8f0',
                      color: '#475569',
                    }}
                  >
                    {display}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {loadingMore && (
        <div style={{ padding: 12, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>
          Loading more rows...
        </div>
      )}
      {!hasMore && rows.length > 0 && (
        <div style={{ padding: 8, textAlign: 'center', color: '#cbd5e1', fontSize: 11 }}>
          All {rows.length} rows loaded
        </div>
      )}
    </div>
  );
}

const emptyStyle = {
  height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: '#94a3b8', fontSize: 12, textAlign: 'center', padding: 16,
};
