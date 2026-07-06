import { useRef, memo, useMemo } from 'react';
import formatNumber from '../../utils/formatNumber';
import { formatDuration, isDurationCol } from '../../utils/formatHuman';
import ChartLegend from './ChartLegend';
import { useStableColorOrder } from '../../hooks/useStableColorOrder';
import { lerpColor } from '../../utils/tableConfigHelpers';
import { CHART_COLORS as COLORS } from '../../utils/chartPalette';
import { useHiddenSeries } from '../../hooks/useHiddenSeries';
import { useChartFonts } from '../../hooks/useChartFonts';
import { useEchartsInstance } from '../../hooks/useEchartsInstance';
import WidgetEmptyState from './WidgetEmptyState';

export default memo(function ScatterWidget({ data, config, onDataClick, highlightValue }) {
  const { hiddenSeries, toggleSeries } = useHiddenSeries();

  const hasData = data?.points?.length > 0;
  const showLegend = config?.showLegend ?? false;
  const legendPosition = config?.legendPosition || 'top';
  const showXAxis = config?.showXAxis ?? true;
  const showYAxis = config?.showYAxis ?? true;
  const symbolSize = config?.symbolSize ?? 10;
  const showDataLabels = config?.showDataLabels ?? false;
  const {
    dataLabel: dataLabelFontFamily,
    xAxisLabel: xAxisFontFamily,
    yAxisLabel: yAxisFontFamily,
    header: headerFontFamily,
  } = useChartFonts(config, ['dataLabel', 'xAxisLabel', 'yAxisLabel', 'header']);

  const allGroupNames = useMemo(() => (data?.seriesGroups || []).map((g) => g?.name).filter((n) => n != null), [data?.seriesGroups]);
  const { getStableIdx } = useStableColorOrder(allGroupNames.join('|'), allGroupNames);

  const memoResult = useMemo(() => {
    if (!hasData) return { option: null, legendItems: [] };
    try {

    const customColors = config?.legendColors || {};
    const customSymbols = config?.legendSymbols || {};
    const customImages = config?.legendImages || {};
    const getColor = (name) => customColors[name] || COLORS[getStableIdx(name) % COLORS.length];
    const getSymbol = (name) => {
      if (customImages[name]) return `image://${customImages[name]}`;
      return customSymbols[name] || 'circle';
    };

    const points = data.points;
    const hasSeries = data.seriesGroups && data.seriesGroups.length > 0;
    const hasSize = data._hasSize;

    // Value-driven gradient — colour by `size` when a size measure is bound, otherwise fall back to y.
    const gradient = config?.valueGradient;
    const useGradient = gradient?.enabled === true;
    let getValueColor = null;
    if (useGradient) {
      const allPoints = hasSeries ? data.seriesGroups.flatMap((g) => g.points) : points;
      const valueOf = (p) => hasSize && p.size != null ? p.size : p.y;
      let gMin = Infinity, gMax = -Infinity;
      for (const p of allPoints) { const v = valueOf(p); if (v != null && !isNaN(v)) { if (v < gMin) gMin = v; if (v > gMax) gMax = v; } }
      const minColor = gradient.minColor || '#dcfce7';
      const maxColor = gradient.maxColor || '#7c3aed';
      getValueColor = (p) => {
        const v = valueOf(p);
        if (v == null || isNaN(v) || gMin === Infinity) return minColor;
        const pct = gMax > gMin ? Math.max(0, Math.min(1, (v - gMin) / (gMax - gMin))) : 0;
        return lerpColor(minColor, maxColor, pct);
      };
    }

    // Compute min/max size values for scaling
    let sizeMin = Infinity, sizeMax = -Infinity;
    if (hasSize) {
      points.forEach((p) => {
        if (p.size != null) { sizeMin = Math.min(sizeMin, p.size); sizeMax = Math.max(sizeMax, p.size); }
      });
      if (sizeMin === sizeMax) { sizeMin = 0; sizeMax = sizeMax || 1; }
    }
    const scaleSize = (v) => {
      if (!hasSize || v == null) return symbolSize;
      const ratio = (v - sizeMin) / (sizeMax - sizeMin);
      return Math.max(4, Math.round(4 + ratio * (symbolSize * 3 - 4)));
    };

    const buildData = (pts) => pts.map((p) => ({
      value: [p.x, p.y],
      _label: p.label,
      _rawLabel: p.label,
      _size: p.size,
      symbolSize: scaleSize(p.size),
      ...(useGradient ? { itemStyle: { color: getValueColor(p) } } : {}),
    }));

    let seriesList;
    if (hasSeries) {
      seriesList = data.seriesGroups
        .filter((g) => !hiddenSeries.has(g.name))
        .map((g) => ({
          type: 'scatter',
          name: g.name,
          symbol: getSymbol(g.name),
          data: buildData(g.points),
          symbolSize: hasSize ? (val, params) => params.data?.symbolSize || symbolSize : symbolSize,
          itemStyle: { color: getColor(g.name) },
          emphasis: { disabled: true },
          label: { show: showDataLabels, formatter: (p) => p.data._label || '', fontSize: config?.dataLabelFontSize ?? 10, fontFamily: dataLabelFontFamily, position: 'top', color: 'var(--text-secondary)' },
        }));
    } else {
      seriesList = [{
        type: 'scatter',
        data: buildData(points),
        symbolSize: (val, params) => params.data?.symbolSize ?? symbolSize,
        itemStyle: { color: config?.color || '#5470c6' },
        emphasis: { disabled: true },
        label: { show: showDataLabels, formatter: (p) => p.data._label || '', fontSize: 10, fontFamily: dataLabelFontFamily, position: 'top', color: 'var(--text-secondary)' },
      }];
    }

    // Apply highlight
    const hl = highlightValue;
    if (hl) {
      seriesList.forEach((s) => {
        s.data = s.data.map((d) => ({
          ...d,
          itemStyle: { ...d.itemStyle, opacity: d._rawLabel === hl ? 1 : 0.3 },
        }));
      });
    }

    const opt = {
      tooltip: {
        trigger: 'item',
        appendToBody: true,
        formatter: (params) => {
          const label = params.data._label;
          const xLabel = data._xLabel || 'X';
          const yLabel = data._yLabel || 'Y';
          // Scatter has 3 axes (x, y, size) — each could be an interval.
          const fmtAxis = (v, axisLabel) => isDurationCol(axisLabel, data._durationColumns) && typeof v === 'number'
            ? formatDuration(v)
            : formatNumber(v);
          let result = label ? `<b>${label}</b><br/>` : '';
          if (params.seriesName) result += `${params.marker} ${params.seriesName}<br/>`;
          result += `${xLabel}: <b>${fmtAxis(params.value[0], xLabel)}</b><br/>`;
          result += `${yLabel}: <b>${fmtAxis(params.value[1], yLabel)}</b>`;
          if (params.data._size != null && data._sizeLabel) {
            result += `<br/>${data._sizeLabel}: <b>${fmtAxis(params.data._size, data._sizeLabel)}</b>`;
          }
          return result;
        },
      },
      legend: { show: false },
      xAxis: {
        type: 'value', show: showXAxis,
        name: (config?.showXAxisTitle ?? config?.showXHeader ?? true) ? (config?.xAxisTitle ?? data._xLabel ?? '') : '', nameLocation: 'center', nameGap: 25,
        nameTextStyle: { fontSize: config?.headerFontSize ?? 12, color: config?.headerColor || '#475569', fontWeight: config?.headerBold ? 'bold' : 'normal', fontFamily: headerFontFamily },
        axisLabel: { show: true, fontSize: config?.xAxisLabelFontSize ?? 11, color: config?.xAxisLabelColor || '#64748b', fontFamily: xAxisFontFamily },
        splitLine: { lineStyle: { type: 'dashed', color: '#f0f0f0' } },
      },
      yAxis: {
        type: 'value', show: showYAxis,
        name: (config?.showYAxisTitle ?? config?.showYHeader ?? true) ? (config?.yAxisTitle ?? data._yLabel ?? '') : '', nameLocation: 'center', nameGap: 35,
        nameTextStyle: { fontSize: config?.headerFontSize ?? 12, color: config?.headerColor || '#475569', fontWeight: config?.headerBold ? 'bold' : 'normal', fontFamily: headerFontFamily },
        axisLabel: { show: true, fontSize: config?.yAxisLabelFontSize ?? 11, color: config?.yAxisLabelColor || '#64748b', fontFamily: yAxisFontFamily },
        splitLine: { lineStyle: { type: 'dashed', color: '#f0f0f0' } },
      },
      series: seriesList,
      grid: { top: 20, right: 20, bottom: showXAxis ? 40 : 15, left: showYAxis ? 50 : 15 },
    };

    const legendItems = hasSeries
      ? data.seriesGroups.map((g) => ({ name: g.name, color: getColor(g.name) }))
      : [];

    return { option: opt, legendItems };
    } catch (e) { console.error('ScatterWidget error:', e); return { option: null, legendItems: [] }; }
  }, [data, hasData, config?.color, showXAxis, showYAxis, symbolSize, showDataLabels, showLegend, legendPosition, hiddenSeries, highlightValue, config?.legendColors, config?.legendSymbols, config?.legendImages, config?.xAxisTitle, config?.yAxisTitle, config?.headerFontSize, config?.headerColor, config?.headerBold, config?.showXHeader, config?.showYHeader, config?.showXAxisTitle, config?.showYAxisTitle, config?.xAxisLabelFontSize, config?.xAxisLabelColor, config?.yAxisLabelFontSize, config?.yAxisLabelColor,
      config?.valueGradient?.enabled, config?.valueGradient?.minColor, config?.valueGradient?.maxColor]);

  const option = memoResult?.option;
  const legendItems = memoResult?.legendItems || [];

  // Click → cross-filter via the `_rawLabel` ECharts itemStyle property
  // we set on each point at build time (scatter points carry their own
  // label, no dataIndex-to-rawLabels mapping needed).
  const onDataClickRef = useRef(onDataClick);
  onDataClickRef.current = onDataClick;
  const dimNameRef = useRef(data?._dimName);
  dimNameRef.current = data?._dimName;
  const chartRef = useEchartsInstance({
    option,
    onInit: (instance) => {
      instance.on('click', (params) => {
        const label = params.data?._rawLabel;
        if (label && onDataClickRef.current) {
          onDataClickRef.current(dimNameRef.current || 'dimension', String(label));
        }
      });
    },
    recreateDeps: [showLegend, legendPosition],
  });

  if (!hasData) return <WidgetEmptyState data={data} config={config} unboundHint="Drop measures on X and Y axes to create a scatter chart" />;

  const isLR = legendPosition === 'left' || legendPosition === 'right';

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: isLR ? 'row' : 'column' }}>
      {showLegend && legendItems.length > 0 && (legendPosition === 'top' || legendPosition === 'left') && (
        <ChartLegend items={legendItems} position={legendPosition} hiddenSeries={hiddenSeries} onToggle={toggleSeries} fontFamily={config?.legendFontFamily} />
      )}
      <div ref={chartRef} style={{ flex: 1, minHeight: 0, minWidth: 0 }} />
      {showLegend && legendItems.length > 0 && (legendPosition === 'bottom' || legendPosition === 'right') && (
        <ChartLegend items={legendItems} position={legendPosition} hiddenSeries={hiddenSeries} onToggle={toggleSeries} fontFamily={config?.legendFontFamily} />
      )}
    </div>
  );
});
