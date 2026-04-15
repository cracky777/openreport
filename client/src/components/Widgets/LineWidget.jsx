import { useRef, useEffect, memo, useMemo } from 'react';
import * as echarts from 'echarts';
import formatNumber from '../../utils/formatNumber';

export default memo(function LineWidget({ data, config, chartWidth, chartHeight }) {
  const chartRef = useRef(null);
  const instanceRef = useRef(null);
  const prevSizeRef = useRef({ w: 0, h: 0 });

  const hasData = data?.labels?.length > 0;
  const showLabels = config?.showColumnNames ?? true;
  const showLegend = config?.showLegend ?? false;
  const legendPosition = config?.legendPosition || 'top';
  const subType = config?.subType || 'line';
  const isArea = subType !== 'line';
  const isStacked = subType === 'stackedArea' || subType === 'stackedArea100';
  const w = chartWidth || 400;
  const h = chartHeight || 300;

  const option = useMemo(() => {
    if (!hasData) return null;

    const series = [];
    const hasSeries = data.series && data.series.length > 0;

    if (hasSeries) {
      data.series.forEach((s, i) => {
        series.push({
          type: 'line', name: s.name || `Series ${i + 1}`, data: s.values,
          smooth: config?.smooth ?? true,
          areaStyle: isArea ? { opacity: isStacked ? 0.7 : 0.15 } : undefined,
          stack: isStacked ? 'total' : undefined,
        });
      });
    } else {
      series.push({
        type: 'line', data: data.values, smooth: config?.smooth ?? true,
        lineStyle: { color: config?.color || '#5470c6' },
        itemStyle: { color: config?.color || '#5470c6' },
        areaStyle: isArea ? { opacity: isStacked ? 0.7 : 0.15 } : undefined,
      });
    }

    return {
      tooltip: {
        trigger: 'axis',
        formatter: (params) => {
          let result = `<b>${params[0]?.axisValue}</b><br/>`;
          params.forEach((p) => {
            const fmt = data._measureFormats?.[p.seriesName] || null;
            result += `${p.marker} ${p.seriesName}: <b>${formatNumber(p.value, fmt)}</b><br/>`;
          });
          return result;
        },
      },
      legend: hasSeries && showLegend ? {
        type: 'scroll',
        ...(legendPosition === 'top' ? { top: 0, left: 'center' } : {}),
        ...(legendPosition === 'bottom' ? { bottom: 0, left: 'center' } : {}),
        ...(legendPosition === 'left' ? { left: 0, top: 'center', orient: 'vertical' } : {}),
        ...(legendPosition === 'right' ? { right: 0, top: 'center', orient: 'vertical' } : {}),
      } : { show: false },
      xAxis: {
        type: 'category', data: data.labels,
        axisLabel: { show: showLabels, rotate: data.labels.length > 10 ? 30 : 0 },
      },
      yAxis: {
        type: 'value',
        axisLabel: {
          show: showLabels,
          formatter: (val) => {
            const firstFmt = Object.values(data._measureFormats || {})[0];
            return firstFmt ? formatNumber(val, firstFmt) : val.toLocaleString();
          },
        },
        max: subType === 'stackedArea100' ? 100 : undefined,
      },
      series,
      grid: {
        top: showLegend && legendPosition === 'top' ? 35 : 15,
        right: showLegend && legendPosition === 'right' ? 120 : 20,
        bottom: showLegend && legendPosition === 'bottom' ? 50 : 40,
        left: showLegend && legendPosition === 'left' ? 120 : 50,
      },
    };
  }, [data, subType, showLabels, showLegend, legendPosition, hasData, config?.smooth, config?.color, isArea, isStacked]);

  useEffect(() => {
    if (!chartRef.current || !option || w < 10 || h < 10) return;
    if (!instanceRef.current) {
      instanceRef.current = echarts.init(chartRef.current, null, { width: w, height: h });
    }
    if (prevSizeRef.current.w !== w || prevSizeRef.current.h !== h) {
      instanceRef.current.resize({ width: w, height: h });
      prevSizeRef.current = { w, h };
    }
    instanceRef.current.setOption(option, true);
  }, [option, w, h]);

  useEffect(() => () => { instanceRef.current?.dispose(); instanceRef.current = null; }, []);

  if (!hasData) {
    return <div style={emptyStyle}>Select dimensions & measures to display a line chart</div>;
  }

  return <div ref={chartRef} />;
});

const emptyStyle = {
  height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: '#94a3b8', fontSize: 12, textAlign: 'center', padding: 16,
};
