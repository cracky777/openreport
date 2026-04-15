import { useRef, useEffect, memo, useMemo } from 'react';
import * as echarts from 'echarts';
import formatNumber from '../../utils/formatNumber';

const COLORS = [
  '#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de',
  '#3ba272', '#fc8452', '#9a60b4', '#ea7ccc', '#5ab1ef',
  '#d87a80', '#8d98b3', '#e5cf0d', '#97b552', '#95706d',
];

export default memo(function BarWidget({ data, config, chartWidth, chartHeight }) {
  const chartRef = useRef(null);
  const instanceRef = useRef(null);
  const prevSizeRef = useRef({ w: 0, h: 0 });

  const hasData = data?.labels?.length > 0;
  const subType = config?.subType || 'grouped';
  const showLabels = config?.showColumnNames ?? true;
  const hideZeros = config?.hideZeros ?? false;
  const showLegend = config?.showLegend ?? false;
  const legendPosition = config?.legendPosition || 'top';
  const sortOrder = config?.sortOrder || (subType === 'stacked' || subType === 'stacked100' ? 'desc' : 'none');
  const w = chartWidth || 400;
  const h = chartHeight || 300;

  // Memoize the ECharts option to avoid recalculating on every render
  const option = useMemo(() => {
    if (!hasData) return null;

    let seriesData = data.series && data.series.length > 0 ? [...data.series] : null;
    if (seriesData && hideZeros) {
      seriesData = seriesData.filter((s) => s.values.some((v) => v !== 0 && v != null));
    }
    const hasSeries = seriesData && seriesData.length > 0;
    const isStacked = subType === 'stacked' || subType === 'stacked100';

    let labels = [...data.labels];
    let sortedIndices = labels.map((_, i) => i);

    if (sortOrder !== 'none') {
      const totals = labels.map((_, i) => {
        if (hasSeries) {
          let total = 0;
          for (const s of seriesData) total += s.values[i] || 0;
          return total;
        }
        return data.values?.[i] || 0;
      });
      sortedIndices.sort((a, b) => sortOrder === 'desc' ? totals[b] - totals[a] : totals[a] - totals[b]);
      labels = sortedIndices.map((i) => labels[i]);
    }

    const series = [];
    if (hasSeries) {
      if (isStacked) {
        seriesData.sort((a, b) => {
          const totalA = a.values.reduce((sum, v) => sum + (v || 0), 0);
          const totalB = b.values.reduce((sum, v) => sum + (v || 0), 0);
          return totalB - totalA;
        });
      }
      for (let i = 0; i < seriesData.length; i++) {
        const s = seriesData[i];
        let values = sortedIndices.map((idx) => s.values[idx] || 0);
        if (subType === 'stacked100') {
          values = values.map((val, vi) => {
            let total = 0;
            for (const sr of seriesData) total += sr.values[sortedIndices[vi]] || 0;
            return total > 0 ? Math.round((val / total) * 10000) / 100 : 0;
          });
        }
        series.push({
          type: 'bar', name: s.name, data: values,
          stack: isStacked ? 'total' : undefined,
          itemStyle: { color: COLORS[i % COLORS.length] },
          emphasis: { focus: 'series' },
        });
      }
    } else {
      series.push({
        type: 'bar',
        data: sortedIndices.map((i) => data.values[i] || 0),
        itemStyle: { color: config?.color || '#5470c6' },
      });
    }

    return {
      tooltip: {
        trigger: 'item',
        formatter: (params) => {
          const fmt = data._measureFormats?.[params.seriesName] || null;
          let result = `<b>${params.name}</b><br/>`;
          result += `${params.marker} ${params.seriesName}: <b>${formatNumber(params.value, fmt)}</b>`;
          if (isStacked && hasSeries) {
            let total = 0;
            for (const sr of seriesData) total += sr.values[sortedIndices[params.dataIndex]] || 0;
            const pct = total > 0 ? Math.round((params.value / total) * 10000) / 100 : 0;
            result += ` (${pct}%)<br/>Total: <b>${formatNumber(total, fmt)}</b>`;
          }
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
        type: 'category', data: labels,
        axisLabel: { show: showLabels, rotate: labels.length > 8 ? 30 : 0 },
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
        max: subType === 'stacked100' ? 100 : undefined,
      },
      series,
      grid: {
        top: showLegend && legendPosition === 'top' ? 35 : 15,
        right: showLegend && legendPosition === 'right' ? 120 : 15,
        bottom: showLegend && legendPosition === 'bottom' ? 50 : 35,
        left: showLegend && legendPosition === 'left' ? 120 : 50,
      },
    };
  }, [data, subType, showLabels, hideZeros, showLegend, legendPosition, sortOrder, hasData, config?.color]);

  // Init or update chart
  useEffect(() => {
    if (!chartRef.current || !option || w < 10 || h < 10) return;

    if (!instanceRef.current) {
      instanceRef.current = echarts.init(chartRef.current, null, { width: w, height: h });
    }

    // Resize only if dimensions changed
    if (prevSizeRef.current.w !== w || prevSizeRef.current.h !== h) {
      instanceRef.current.resize({ width: w, height: h });
      prevSizeRef.current = { w, h };
    }

    instanceRef.current.setOption(option, true);
  }, [option, w, h]);

  useEffect(() => () => { instanceRef.current?.dispose(); instanceRef.current = null; }, []);

  if (!hasData) {
    return <div style={emptyStyle}>Select dimensions & measures to display a bar chart</div>;
  }

  return <div ref={chartRef} />;
});

const emptyStyle = {
  height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: '#94a3b8', fontSize: 12, textAlign: 'center', padding: 16,
};
