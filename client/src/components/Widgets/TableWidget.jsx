export default function TableWidget({ data, config }) {
  const defaultColumns = ['Name', 'Value', 'Status'];
  const defaultRows = [
    ['Item A', '120', 'Active'],
    ['Item B', '200', 'Active'],
    ['Item C', '150', 'Inactive'],
    ['Item D', '80', 'Active'],
  ];

  const columns = data?.columns || defaultColumns;
  const rows = data?.rows || defaultRows;

  return (
    <div style={{ height: '100%', overflow: 'auto', fontSize: config?.fontSize || 13 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
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
                }}
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ backgroundColor: i % 2 === 0 ? '#fff' : '#f8fafc' }}>
              {row.map((cell, j) => (
                <td
                  key={j}
                  style={{
                    padding: '6px 12px',
                    borderBottom: '1px solid #e2e8f0',
                    color: '#475569',
                  }}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
