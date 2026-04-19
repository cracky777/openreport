import { useRef, useEffect, memo, useMemo, useState, useCallback } from 'react';
import * as echarts from 'echarts';
import formatNumber from '../../utils/formatNumber';
import ChartLegend from './ChartLegend';

const COLORS = [
  '#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de',
  '#3ba272', '#fc8452', '#9a60b4', '#ea7ccc', '#5ab1ef',
  '#d87a80', '#8d98b3', '#e5cf0d', '#97b552', '#95706d',
];

export default memo(function ScatterWidget({ data, config, chartWidth, chartHeight, onDataClick, highlightValue }) {
  const chartRef = useRef(null);
  const instanceRef = useRef(null);
  const prevSizeRef = useRef({ w: 0, h: 0 });
  const [hiddenSeries, setHiddenSeries] = useState(new Set());
  const toggleSeries = useCallback((name) => {
    setHiddenSeries((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }, []);

  const hasData = data?.points?.length > 0;
  const showLegend = config?.showLegend ?? false;
  const legendPosition = config?.legendPosition || 'top';
  const showXAxis = config?.showXAxis ?? true;
  const showYAxis = config?.showYAxis ?? true;
  const symbolSize = config?.symbolSize ?? 10;
  const showDataLabels = config?.showDataLabels ?? false;

  const memoResult = useMemo(() => {
    if (!hasData) return { option: null, legendItems: [] };
    try {

    const customColors = config?.legendColors || {};
    const customSymbols = config?.legendSymbols || {};
    const customImages = config?.legendImages || {};
    const getColor = (name, idx) => customColors[name] || COLORS[idx % COLORS.length];
    const getSymbol = (name) => {
      if (customImages[name]) return `image://${customImages[name]}`;
      return customSymbols[name] || 'circle';
    };

    const points = data.points;
    const hasSeries = data.seriesGroups && data.seriesGroups.length > 0;
    const hasSize = data._hasSize;

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
    }));

    let seriesList;
    if (hasSeries) {
      seriesList = data.seriesGroups
        .filter((g) => !hiddenSeries.has(g.name))
        .map((g, i) => {
          const origIdx = data.seriesGroups.findIndex((o) => o.name === g.name);
          return {
            type: 'scatter',
            name: g.name,
            symbol: getSymbol(g.name),
            data: buildData(g.points),
            symbolSize: hasSize ? (val, params) => params.data?.symbolSize || symbolSize : symbolSize,
            itemStyle: { color: getColor(g.name, origIdx >= 0 ? origIdx : i) },
            emphasis: { disabled: true },
            label: { show: showDataLabels, formatter: (p) => p.data._label || '', fontSize: config?.dataLabelFontSize ?? 10, position: 'top', color: '#475569' },
          };
        });
    } else {
      seriesList = [{
        type: 'scatter',
        data: buildData(points),
        symbolSize: (val, params) => params.data?.symbolSize ?? symbolSize,
        itemStyle: { color: config?.color || '#5470c6' },
        emphasis: { disabled: true },
        label: { show: showDataLabels, formatter: (p) => p.data._label || '', fontSize: 10, position: 'top', color: '#475569' },
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
          let result = label ? `<b>${label}</b><br/>` : '';
          if (params.seriesName) result += `${params.marker} ${params.seriesName}<br/>`;
          result += `${xLabel}: <b>${formatNumber(params.value[0])}</b><br/>`;
          result += `${yLabel}: <b>${formatNumber(params.value[1])}</b>`;
          if (params.data._size != null && data._sizeLabel) {
            result += `<br/>${data._sizeLabel}: <b>${formatNumber(params.data._size)}</b>`;
          }
          return result;
        },
      },
      legend: { show: false },
      xAxis: {
        type: 'value', show: showXAxis,
        name: (config?.showXHeader ?? true) ? (config?.xAxisTitle ?? data._xLabel ?? '') : '', nameLocation: 'center', nameGap: 25,
        nameTextStyle: { fontSize: config?.headerFontSize ?? 12, color: config?.headerColor || '#475569', fontWeight: config?.headerBold ? 'bold' : 'normal' },
        axisLabel: { show: true },
        splitLine: { lineStyle: { type: 'dashed', color: '#f0f0f0' } },
      },
      yAxis: {
        type: 'value', show: showYAxis,
        name: (config?.showYHeader ?? true) ? (config?.yAxisTitle ?? data._yLabel ?? '') : '', nameLocation: 'center', nameGap: 35,
        nameTextStyle: { fontSize: config?.headerFontSize ?? 12, color: config?.headerColor || '#475569', fontWeight: config?.headerBold ? 'bold' : 'normal' },
        axisLabel: { show: true },
        splitLine: { lineStyle: { type: 'dashed', color: '#f0f0f0' } },
      },
      series: seriesList,
      grid: { top: 20, right: 20, bottom: showXAxis ? 40 : 15, left: showYAxis ? 50 : 15 },
    };

    const legendItems = hasSeries
      ? data.seriesGroups.map((g, i) => ({ name: g.name, color: getColor(g.name, i) }))
      : [];

    return { option: opt, legendItems };
    } catch (e) { console.error('ScatterWidget error:', e); return { option: null, legendItems: [] }; }
  }, [data, hasData, config?.color, showXAxis, showYAxis, symbolSize, showDataLabels, showLegend, legendPosition, hiddenSeries, highlightValue, config?.legendColors, config?.legendSymbols, config?.legendImages, config?.xAxisTitle, config?.yAxisTitle, config?.headerFontSize, config?.headerColor, config?.headerBold, config?.showXHeader, config?.showYHeader]);

  const option = memoResult?.option;
  const legendItems = memoResult?.legendItems || [];

  useEffect(() => {
    instanceRef.current?.dispose();
    instanceRef.current = null;
    prevSizeRef.current = { w: 0, h: 0 };
  }, [showLegend, legendPosition]);

  const onDataClickRef = useRef(onDataClick);
  onDataClickRef.current = onDataClick;
  const dimNameRef = useRef(data?._dimName);
  dimNameRef.current = data?._dimName;

  useEffect(() => {
    const el = chartRef.current;
    if (!el || !option) return;

    // If the DOM element changed (e.g. after empty→data transition), recreate instance
    if (instanceRef.current && instanceRef.current.getDom() !== el) {
      instanceRef.current.dispose();
      instanceRef.current = null;
      prevSizeRef.current = { w: 0, h: 0 };
    }

    const render = () => {
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      if (cw < 10 || ch < 10) return;

      if (!instanceRef.current) {
        instanceRef.current = echarts.init(el, null, { width: cw, height: ch });
        instanceRef.current.on('click', (params) => {
          const label = params.data?._rawLabel;
          if (label && onDataClickRef.current) {
            onDataClickRef.current(dimNameRef.current || 'dimension', String(label));
          }
        });
      } else if (prevSizeRef.current.w !== cw || prevSizeRef.current.h !== ch) {
        instanceRef.current.resize({ width: cw, height: ch });
      }
      prevSizeRef.current = { w: cw, h: ch };
      instanceRef.current.setOption(option, true);
    };

    const timer = requestAnimationFrame(render);
    const ro = new ResizeObserver(render);
    ro.observe(el);
    return () => { cancelAnimationFrame(timer); ro.disconnect(); };
  }, [option, showLegend, legendPosition]);

  useEffect(() => () => { instanceRef.current?.dispose(); instanceRef.current = null; }, []);

  if (!hasData) {
    return <div style={emptyStyle}>Drop measures on X and Y axes to create a scatter chart</div>;
  }

  const legendH = showLegend && legendItems.length > 0 ? 28 : 0;
  const isLR = legendPosition === 'left' || legendPosition === 'right';

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: isLR ? 'row' : 'column' }}>
      {showLegend && legendItems.length > 0 && (legendPosition === 'top' || legendPosition === 'left') && (
        <ChartLegend items={legendItems} position={legendPosition} hiddenSeries={hiddenSeries} onToggle={toggleSeries} />
      )}
      <div ref={chartRef} style={{ flex: 1, minHeight: 0, minWidth: 0 }} />
      {showLegend && legendItems.length > 0 && (legendPosition === 'bottom' || legendPosition === 'right') && (
        <ChartLegend items={legendItems} position={legendPosition} hiddenSeries={hiddenSeries} onToggle={toggleSeries} />
      )}
    </div>
  );
});

const emptyStyle = {
  height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: '#94a3b8', fontSize: 12, textAlign: 'center', padding: 16,
};
