import formatNumber from '../../utils/formatNumber';

export default function ScorecardWidget({ data, config }) {
  const hasData = data?.value !== undefined && data?.value !== '';

  if (!hasData) {
    if (data?._rowCount === 0) {
      if (config?.hideEmptyMessage) return <div style={emptyStyle} />;
      return <div style={emptyStyle}>{config?.emptyMessage || 'No values'}</div>;
    }
    return <div style={emptyStyle}>Select a measure to display a scorecard</div>;
  }

  const change = data?.change;
  const fmt = Object.values(data?._measureFormats || {})[0];
  const rawValue = typeof data.value === 'string' ? parseFloat(data.value.replace(/[^\d.-]/g, '')) : data.value;
  const displayValue = fmt && !isNaN(rawValue) ? formatNumber(rawValue, fmt) : data.value;

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        style={{
          fontSize: config?.labelSize || 14,
          color: config?.labelColor || '#64748b',
          marginBottom: 4,
          fontWeight: 500,
        }}
      >
        {data?.label || ''}
      </div>
      <div
        style={{
          fontSize: config?.valueSize || 36,
          fontWeight: 700,
          color: config?.valueColor || '#0f172a',
        }}
      >
        {displayValue}
      </div>
      {change !== undefined && (
        <div
          style={{
            fontSize: 14,
            marginTop: 4,
            color: change >= 0 ? '#16a34a' : '#dc2626',
            fontWeight: 500,
          }}
        >
          {change >= 0 ? '+' : ''}{change}%
        </div>
      )}
    </div>
  );
}

const emptyStyle = {
  height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: '#94a3b8', fontSize: 12, textAlign: 'center', padding: 16,
};
