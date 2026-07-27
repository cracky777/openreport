// Compact green/red pill that summarises the result of a column-type
// validation run. Tooltip shows sample size + a few invalid examples so
// the user knows where the type mismatches are. Extracted verbatim from
// pages/ModelEditor.jsx (LOT 6.3) — purely presentational (props-in only).
const badge = { padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 };

export default function ValidationBadge({ result }) {
  if (result.error) {
    return (
      <span title={result.error} style={{ ...badge, background: 'var(--state-danger-soft)', color: 'var(--state-danger)' }}>
        error
      </span>
    );
  }
  const ratio = result.validRatio ?? 0;
  const pct = Math.round(ratio * 100);
  const ok = ratio >= 0.95;
  const tooltip = [
    `${result.validCount}/${result.sampleSize} rows match "${result.type}"`,
    result.invalidExamples?.length
      ? `Invalid examples: ${result.invalidExamples.map((v) => v == null ? 'NULL' : `"${v}"`).join(', ')}`
      : null,
    result.note || null,
  ].filter(Boolean).join('\n');
  return (
    <span
      title={tooltip}
      style={{
        ...badge,
        background: ok ? 'var(--state-success-soft, #dcfce7)' : 'var(--state-warning-soft, #fef3c7)',
        color: ok ? 'var(--state-success, #16a34a)' : 'var(--state-warning, #92400e)',
        cursor: 'help',
      }}
    >
      {ok ? '✓' : '!'} {pct}%
    </span>
  );
}
