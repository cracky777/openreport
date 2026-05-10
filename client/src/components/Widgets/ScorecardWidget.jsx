import formatNumber from '../../utils/formatNumber';
import { fontStack, loadGoogleFont } from '../../utils/googleFonts';

export default function ScorecardWidget({ data, config }) {
  const hasData = data?.value !== undefined && data?.value !== '';
  // Trigger Google Fonts loading for whichever family the user picked. This
  // is a side-effect inside render — fine here because `loadGoogleFont` is
  // idempotent (Set-guarded) and re-running it on every paint costs nothing
  // after the first injection.
  if (config?.valueFontFamily) loadGoogleFont(config.valueFontFamily);
  if (config?.labelFontFamily) loadGoogleFont(config.labelFontFamily);

  if (!hasData) {
    if (data?._rowCount === 0) {
      if (config?.hideEmptyMessage) return <div style={emptyStyle} />;
      return <div style={emptyStyle}>{config?.emptyMessage || 'No values'}</div>;
    }
    return <div style={emptyStyle}>Select a measure to display a scorecard</div>;
  }

  const change = data?.change;
  const fmt = Object.values(data?._measureFormats || {})[0];
  const rawValue = typeof data.value === 'number'
    ? data.value
    : parseFloat(String(data.value).replace(',', '.').replace(/[^\d.-]/g, ''));
  const displayValue = !isNaN(rawValue)
    ? (fmt ? formatNumber(rawValue, fmt) : rawValue.toLocaleString())
    : String(data.value ?? '');

  const fmtNum = (v) => (fmt ? formatNumber(v, fmt) : v.toLocaleString());

  // ─── N-1 comparison lines ─────────────────────────────────────────
  // Each toggle that's on contributes a "line" with its own styling
  // (position, label, font size, spacing, sign-aware color and icon).
  // Lines are grouped by position so left/right sit on either side of
  // the main value and bottom stacks below.
  const n1 = typeof data._n1Value === 'number' ? data._n1Value : null;
  const lines = [];
  const buildLine = (kind, signedNumber, displayText, style) => {
    const s = style || {};
    const textColorEnabled = s.textColorEnabled !== undefined
      ? s.textColorEnabled
      : (s.colorEnabled !== false);
    const iconColorEnabled = s.iconColorEnabled !== false;
    // Value-kind icon is opt-in (defaults off); delta kinds default on.
    const iconEnabled = kind === 'value' ? (s.iconEnabled === true) : (s.iconEnabled !== false);
    const labelText = s.label !== undefined ? s.label : (kind === 'value' ? 'N-1' : 'vs N-1');
    const iconPosition = s.iconPosition === 'right' ? 'right' : 'left';
    let color = 'var(--text-secondary)';
    let iconColor = null;
    let icon = null;
    // Text color (sign-aware): only for delta kinds — the N-1 value itself
    // shouldn't be tinted based on the implicit comparison.
    if (kind !== 'value' && textColorEnabled && Number.isFinite(signedNumber)) {
      const positiveText = s.positiveColor || '#16a34a';
      const negativeText = s.negativeColor || '#dc2626';
      if (signedNumber > 0) color = positiveText;
      else if (signedNumber < 0) color = negativeText;
      else color = 'var(--text-muted)';
    }
    // Sign-aware icon + icon color: applies to every kind so the N-1 value
    // line can show the same up/down indicator as the % evolution line,
    // driven by the sign of the difference passed in `signedNumber`.
    if (iconEnabled && Number.isFinite(signedNumber) && signedNumber !== 0) {
      icon = signedNumber > 0 ? (s.positiveIcon ?? '▲') : (s.negativeIcon ?? '▼');
      if (iconColorEnabled) {
        const positiveIconColor = s.iconPositiveColor || '#16a34a';
        const negativeIconColor = s.iconNegativeColor || '#dc2626';
        iconColor = signedNumber > 0 ? positiveIconColor : negativeIconColor;
      }
    }
    return {
      kind,
      position: s.position || 'bottom',
      fontSize: s.fontSize ?? 12,
      spacing: s.spacing ?? 6,
      color,
      iconColor,
      icon,
      iconPosition,
      label: labelText,
      display: displayText,
    };
  };

  if (config?.showN1Value && n1 !== null) {
    const valueSign = !isNaN(rawValue) ? (rawValue - n1) : null;
    lines.push(buildLine('value', valueSign, fmtNum(n1), config.n1ValueStyle));
  }
  if (config?.showN1Difference && n1 !== null && !isNaN(rawValue)) {
    const diff = rawValue - n1;
    const txt = (diff > 0 ? '+' : '') + fmtNum(diff);
    lines.push(buildLine('difference', diff, txt, config.n1DifferenceStyle));
  }
  if (config?.showN1Percent && n1 !== null && !isNaN(rawValue) && n1 !== 0) {
    const diff = rawValue - n1;
    const pct = (diff / Math.abs(n1)) * 100;
    const txt = (pct > 0 ? '+' : '') + pct.toFixed(1) + '%';
    lines.push(buildLine('percent', pct, txt, config.n1PercentStyle));
  }

  const leftLines = lines.filter((l) => l.position === 'left');
  const rightLines = lines.filter((l) => l.position === 'right');
  const bottomLines = lines.filter((l) => l.position === 'bottom');

  const renderLine = (l, key) => {
    const iconEl = l.icon
      ? <span style={{ fontSize: Math.max(8, l.fontSize - 1), color: l.iconColor || 'inherit' }}>{l.icon}</span>
      : null;
    return (
      <div key={key} style={{
        fontSize: l.fontSize, color: l.color, fontWeight: 500,
        display: 'inline-flex', alignItems: 'baseline', gap: 4,
        whiteSpace: 'nowrap',
      }}>
        {iconEl && l.iconPosition === 'left' && iconEl}
        <span>{l.display}</span>
        {l.label && <span style={{ opacity: 0.75, fontSize: Math.max(8, l.fontSize - 2) }}>{l.label}</span>}
        {iconEl && l.iconPosition === 'right' && iconEl}
      </div>
    );
  };

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
          color: config?.labelColor || 'var(--text-muted)',
          fontFamily: config?.labelFontFamily ? fontStack(config.labelFontFamily) : undefined,
          marginBottom: 4,
          fontWeight: 500,
        }}
      >
        {data?.label || ''}
      </div>
      {/* Main row: optional left lines + value + optional right lines.
          Each side picks up the per-line spacing as a horizontal gap so
          the user can fine-tune how far the comparison sits from the
          main figure. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
        {leftLines.length > 0 && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2,
            marginRight: Math.max(...leftLines.map((l) => l.spacing), 0),
          }}>
            {leftLines.map((l, i) => renderLine(l, `l${i}`))}
          </div>
        )}
        <div
          style={{
            fontSize: config?.valueSize || 36,
            fontWeight: 700,
            color: config?.valueColor || 'var(--text-primary)',
            fontFamily: config?.valueFontFamily ? fontStack(config.valueFontFamily) : undefined,
          }}
        >
          {displayValue}
        </div>
        {rightLines.length > 0 && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
            marginLeft: Math.max(...rightLines.map((l) => l.spacing), 0),
          }}>
            {rightLines.map((l, i) => renderLine(l, `r${i}`))}
          </div>
        )}
      </div>
      {bottomLines.length > 0 && (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
          marginTop: Math.max(...bottomLines.map((l) => l.spacing), 0),
        }}>
          {bottomLines.map((l, i) => renderLine(l, `b${i}`))}
        </div>
      )}
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
  color: 'var(--text-disabled)', fontSize: 12, textAlign: 'center', padding: 16,
};
