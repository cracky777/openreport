import { useEffect, useLayoutEffect, useRef, useState, memo, useMemo } from 'react';
import * as echarts from 'echarts';
import formatNumber from '../../utils/formatNumber';

// Extract numeric value from scorecard-shaped data (handles legacy string values from old saves)
const extractValue = (data) => {
  if (data?.value === undefined || data?.value === null || data?.value === '') return null;
  if (typeof data.value === 'number') return data.value;
  const str = String(data.value);
  const hasDot = str.includes('.');
  const hasComma = str.includes(',');
  let cleaned = str;
  if (hasComma && !hasDot) cleaned = str.replace(',', '.'); // FR-style decimal
  else if (hasComma && hasDot) cleaned = str.replace(/,/g, ''); // EN-style thousand sep
  const parsed = parseFloat(cleaned.replace(/[^\d.-]/g, ''));
  return isNaN(parsed) ? null : parsed;
};

export default memo(function GaugeWidget({ data, config, chartWidth, chartHeight }) {
  const value = extractValue(data);
  const hasData = value !== null;
  const subType = config?.subType || 'arc';
  const min = config?.gaugeMin ?? 0;
  // Max: measure value takes priority, otherwise static config value
  const max = typeof data?.maxValue === 'number'
    ? data.maxValue
    : (config?.gaugeMax ?? 100);
  const baseColor = config?.gaugeColor || '#7c3aed';
  const trackColor = config?.gaugeTrackColor || '#e2e8f0';
  const thresholdColor = config?.gaugeThresholdColor || '#dc2626';
  const showValue = config?.gaugeShowValue ?? true;
  const showLabel = config?.gaugeShowLabel ?? true;
  const showMinMax = config?.gaugeShowMinMax ?? false;
  const fmt = Object.values(data?._measureFormats || {})[0];
  const label = data?.label || '';
  // Threshold: measure value takes priority, otherwise static config value
  const threshold = typeof data?.threshold === 'number'
    ? data.threshold
    : (typeof config?.gaugeThresholdValue === 'number' ? config.gaugeThresholdValue : null);
  // Conditional color: switch when value crosses the threshold
  const useOverColor = config?.gaugeConditionalColor
    && threshold !== null
    && value !== null
    && value > threshold;
  const gaugeColor = useOverColor ? (config?.gaugeOverColor || '#dc2626') : baseColor;

  const displayValue = useMemo(() => {
    if (!hasData) return '';
    return fmt && !isNaN(value) ? formatNumber(value, fmt) : value.toLocaleString();
  }, [value, fmt, hasData]);

  // Clamp progress to [0, 1]
  const progress = useMemo(() => {
    if (!hasData || max === min) return 0;
    return Math.max(0, Math.min(1, (value - min) / (max - min)));
  }, [value, min, max, hasData]);

  // Threshold progress (0..1) clamped for visual marker — must run unconditionally (Rules of Hooks)
  const thresholdProgress = useMemo(() => {
    if (threshold === null || max === min) return null;
    return Math.max(0, Math.min(1, (threshold - min) / (max - min)));
  }, [threshold, min, max]);

  if (!hasData) {
    if (data?._rowCount === 0) {
      if (config?.hideEmptyMessage) return <div style={emptyStyle} />;
      return <div style={emptyStyle}>{config?.emptyMessage || 'No values'}</div>;
    }
    return <div style={emptyStyle}>Select a measure to display a gauge</div>;
  }

  if (subType === 'arc') {
    return <ArcGauge
      value={value} displayValue={displayValue} min={min} max={max} label={label}
      color={gaugeColor} trackColor={trackColor}
      threshold={threshold} thresholdColor={thresholdColor}
      showValue={showValue} showLabel={showLabel} showMinMax={showMinMax}
      width={chartWidth} height={chartHeight} config={config}
    />;
  }

  // Column gauge
  const direction = config?.gaugeDirection || 'up'; // 'up' | 'down' | 'right' | 'left'
  return <ColumnGauge
    progress={progress} thresholdProgress={thresholdProgress} thresholdColor={thresholdColor}
    displayValue={displayValue} label={label} min={min} max={max}
    color={gaugeColor} trackColor={trackColor}
    showValue={showValue} showLabel={showLabel} showMinMax={showMinMax}
    direction={direction} config={config}
  />;
});

// ─── Arc gauge (ECharts) ───
const ArcGauge = memo(function ArcGauge({ value, displayValue, min, max, label, color, trackColor, threshold, thresholdColor, showValue, showLabel, showMinMax, width, height, config }) {
  const chartRef = useRef(null);
  const instanceRef = useRef(null);

  const arcWidth = config?.gaugeArcWidth ?? 18;
  // Arc has no rounded caps by default (user preference)
  // Arc span in degrees (how open the arc is). 240 = default (opening at the bottom).
  // 360 = full circle, 180 = half circle, <180 = narrower top-only arc.
  const arcSpan = config?.gaugeArcSpan ?? 240;
  // Center the arc around top (90°): startAngle and endAngle are symmetrical
  const halfSpan = arcSpan / 2;
  const startAngle = 90 + halfSpan;
  const endAngle = 90 - halfSpan;
  const option = useMemo(() => {
    const series = [{
      type: 'gauge',
      min, max,
      startAngle, endAngle,
      radius: '95%',
      center: ['50%', '65%'],
      progress: { show: true, width: arcWidth, itemStyle: { color } },
      axisLine: { lineStyle: { width: arcWidth, color: [[1, trackColor]] } },
      pointer: { show: false },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { show: false }, // rendered as HTML overlay for fine positioning
      anchor: { show: false },
      detail: showValue ? {
        valueAnimation: true,
        offsetCenter: [0, '0%'],
        fontSize: config?.gaugeValueSize || 24,
        fontWeight: 700,
        color: config?.gaugeValueColor || '#0f172a',
        formatter: () => displayValue,
      } : { show: false },
      title: showLabel && label ? {
        offsetCenter: [0, '30%'],
        fontSize: config?.gaugeLabelSize || 12,
        color: config?.gaugeLabelColor || '#64748b',
      } : { show: false },
      data: [{ value, name: label }],
    }];
    // Threshold marker: a second gauge series drawing a thin line at the threshold position
    if (threshold !== null && threshold !== undefined && threshold >= min && threshold <= max) {
      series.push({
        type: 'gauge',
        min, max,
        startAngle, endAngle,
        radius: '95%',
        center: ['50%', '65%'],
        progress: { show: false },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        pointer: {
          show: true,
          icon: 'rect',
          length: '15%',
          width: 4,
          offsetCenter: [0, '-75%'],
          itemStyle: { color: thresholdColor },
        },
        anchor: { show: false },
        detail: { show: false },
        title: { show: false },
        data: [{ value: threshold }],
      });
    }
    return { series };
  }, [value, min, max, label, color, trackColor, threshold, thresholdColor, showValue, showLabel, showMinMax, displayValue, config?.gaugeValueSize, config?.gaugeValueColor, config?.gaugeLabelSize, config?.gaugeLabelColor, config?.gaugeAxisSize, config?.gaugeAxisColor, arcWidth, startAngle, endAngle]);

  useEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    if (instanceRef.current && instanceRef.current.getDom() !== el) {
      instanceRef.current.dispose();
      instanceRef.current = null;
    }
    if (!instanceRef.current) {
      instanceRef.current = echarts.init(el, null, { width: el.clientWidth, height: el.clientHeight });
    } else {
      instanceRef.current.resize({ width: el.clientWidth, height: el.clientHeight });
    }
    instanceRef.current.setOption(option, true);
  }, [option, width, height]);

  useEffect(() => () => { instanceRef.current?.dispose(); instanceRef.current = null; }, []);

  const axisFontSize = config?.gaugeAxisSize || 11;
  const axisColor = config?.gaugeAxisColor || '#94a3b8';
  // Additional distance outside the arc tip (px)
  const outset = config?.gaugeAxisOutset ?? 25;
  // Horizontal pull toward widget center (px). Positive = closer to center.
  const centerPull = config?.gaugeAxisCenterPull ?? 15;

  // Track container size so label positions follow the actual ECharts radius
  const containerRef = useRef(null);
  const [size, setSize] = useState({ w: 300, h: 200 });
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setSize({ w: el.offsetWidth, h: el.offsetHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Compute label positions from the arc tips.
  // ECharts gauge: center is ['50%', '65%'] of widget, radius is 95% of min(w,h)/2.
  const { w, h } = size;
  const centerXpx = w * 0.5;
  const centerYpx = h * 0.65;
  const arcRadiusPx = Math.min(w, h) / 2 * 0.95;
  const totalRadius = arcRadiusPx + outset;
  // ECharts angles: 0° = right (3 o'clock), 90° = up, 180° = left, -90° = down.
  // startAngle = minTip (left side for default), endAngle = maxTip (right side).
  const minRad = startAngle * Math.PI / 180;
  const maxRad = endAngle * Math.PI / 180;
  let xMinPx = centerXpx + totalRadius * Math.cos(minRad);
  const yMinPx = centerYpx - totalRadius * Math.sin(minRad); // screen Y inverted
  let xMaxPx = centerXpx + totalRadius * Math.cos(maxRad);
  const yMaxPx = centerYpx - totalRadius * Math.sin(maxRad);
  // Pull each label toward the horizontal center
  if (xMinPx < centerXpx) xMinPx = Math.min(xMinPx + centerPull, centerXpx);
  else xMinPx = Math.max(xMinPx - centerPull, centerXpx);
  if (xMaxPx < centerXpx) xMaxPx = Math.min(xMaxPx + centerPull, centerXpx);
  else xMaxPx = Math.max(xMaxPx - centerPull, centerXpx);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
      <div ref={chartRef} style={{ width: '100%', height: '100%' }} />
      {showMinMax && (
        <>
          <span style={{
            position: 'absolute', left: xMinPx, top: yMinPx,
            transform: 'translate(-50%, -50%)',
            fontSize: axisFontSize, color: axisColor, lineHeight: 1,
            whiteSpace: 'nowrap', pointerEvents: 'none',
          }}>{min}</span>
          <span style={{
            position: 'absolute', left: xMaxPx, top: yMaxPx,
            transform: 'translate(-50%, -50%)',
            fontSize: axisFontSize, color: axisColor, lineHeight: 1,
            whiteSpace: 'nowrap', pointerEvents: 'none',
          }}>{max}</span>
        </>
      )}
    </div>
  );
});

// ─── Column gauge (CSS) ───
const ColumnGauge = memo(function ColumnGauge({ progress, thresholdProgress, thresholdColor, displayValue, label, min, max, color, trackColor, showValue, showLabel, showMinMax, direction, config }) {
  const labelStyle = { fontSize: config?.gaugeLabelSize || 12, color: config?.gaugeLabelColor || '#64748b', fontWeight: 500 };
  const valueStyle = { fontSize: config?.gaugeValueSize || 20, fontWeight: 700, color: config?.gaugeValueColor || '#0f172a' };
  const axisStyle = { fontSize: config?.gaugeAxisSize || 10, color: config?.gaugeAxisColor || '#94a3b8' };
  const isVertical = direction === 'up' || direction === 'down';
  const pct = `${progress * 100}%`;
  const thPct = thresholdProgress !== null && thresholdProgress !== undefined ? `${thresholdProgress * 100}%` : null;

  // Fill placement inside the track based on direction
  const fillStyle = {
    position: 'absolute', backgroundColor: color, transition: 'all 0.3s ease',
    ...(direction === 'up' && { bottom: 0, left: 0, right: 0, height: pct }),
    ...(direction === 'down' && { top: 0, left: 0, right: 0, height: pct }),
    ...(direction === 'right' && { top: 0, bottom: 0, left: 0, width: pct }),
    ...(direction === 'left' && { top: 0, bottom: 0, right: 0, width: pct }),
  };

  // Threshold marker line
  const thresholdLineStyle = thPct ? {
    position: 'absolute', backgroundColor: thresholdColor, zIndex: 2,
    ...(direction === 'up' && { bottom: thPct, left: -2, right: -2, height: 2 }),
    ...(direction === 'down' && { top: thPct, left: -2, right: -2, height: 2 }),
    ...(direction === 'right' && { left: thPct, top: -2, bottom: -2, width: 2 }),
    ...(direction === 'left' && { right: thPct, top: -2, bottom: -2, width: 2 }),
  } : null;

  const barThickness = config?.gaugeArcWidth ?? 40;
  const radius = (config?.gaugeArcRounded ?? false) ? Math.round(barThickness / 2) : 4;
  const trackStyle = {
    position: 'relative', backgroundColor: trackColor, borderRadius: radius, overflow: 'visible',
    ...(isVertical ? { width: barThickness, height: '100%' } : { width: '100%', height: barThickness }),
  };

  const innerClip = {
    position: 'absolute', inset: 0, borderRadius: radius, overflow: 'hidden',
  };

  return (
    <div style={{
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', padding: 12, gap: 8,
    }}>
      {showLabel && label && (
        <div style={labelStyle}>{label}</div>
      )}
      <div style={{
        flex: 1, minHeight: 0, minWidth: 0, width: isVertical ? 'auto' : '90%',
        display: 'flex', flexDirection: isVertical ? 'row' : 'column',
        alignItems: 'center', justifyContent: 'center', gap: 6,
      }}>
        {showMinMax && isVertical && (
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: '100%', ...axisStyle }}>
            <span>{max}</span>
            <span>{min}</span>
          </div>
        )}
        <div style={trackStyle}>
          <div style={innerClip}>
            <div style={fillStyle} />
          </div>
          {thresholdLineStyle && <div style={thresholdLineStyle} />}
        </div>
        {showMinMax && !isVertical && (
          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', ...axisStyle }}>
            <span>{direction === 'right' ? min : max}</span>
            <span>{direction === 'right' ? max : min}</span>
          </div>
        )}
      </div>
      {showValue && (
        <div style={valueStyle}>{displayValue}</div>
      )}
    </div>
  );
});

const emptyStyle = {
  height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: '#94a3b8', fontSize: 12, textAlign: 'center', padding: 16,
};
