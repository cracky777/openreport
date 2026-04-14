export default function ScorecardWidget({ data, config }) {
  const value = data?.value ?? '1,234';
  const label = data?.label ?? 'Total';
  const change = data?.change;

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
        {label}
      </div>
      <div
        style={{
          fontSize: config?.valueSize || 36,
          fontWeight: 700,
          color: config?.valueColor || '#0f172a',
        }}
      >
        {value}
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
