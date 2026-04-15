import { useRef, useEffect, memo, useMemo } from 'react';
import * as echarts from 'echarts';
import formatNumber from '../../utils/formatNumber';

export default memo(function PieWidget({ data, config, chartWidth, chartHeight }) {
  const chartRef = useRef(null);
  const instanceRef = useRef(null);
  const prevSizeRef = useRef({ w: 0, h: 0 });

  const hasData = data?.items?.length > 0;
  const showLegend = config?.showLegend ?? false;
  const legendPosition = config?.legendPosition || 'top';
  const w = chartWidth || 400;
  const h = chartHeight || 300;

  const option = useMemo(() => {
    if (!hasData) return null;
    return {
      tooltip: {
        trigger: 'item',
        formatter: (params) => {
          const fmt = Object.values(data._measureFormats || {})[0];
          return `${params.marker} ${params.name}: <b>${formatNumber(params.value, fmt)}</b> (${params.percent}%)`;
        },
      },
      legend: showLegend ? {
        type: 'scroll',
        ...(legendPosition === 'top' ? { top: 0, left: 'center' } : {}),
        ...(legendPosition === 'bottom' ? { bottom: 0, left: 'center' } : {}),
        ...(legendPosition === 'left' ? { left: 0, top: 'center', orient: 'vertical' } : {}),
        ...(legendPosition === 'right' ? { right: 0, top: 'center', orient: 'vertical' } : {}),
      } : { show: false },
      series: [{
        type: 'pie',
        radius: config?.donut ? ['40%', '70%'] : '70%',
        data: data.items,
        emphasis: { itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0,0,0,0.5)' } },
        label: {
          show: config?.showLabels ?? true,
          formatter: (config?.showColumnNames ?? true) ? '{b}: {d}%' : '{d}%',
        },
      }],
    };
  }, [data, hasData, showLegend, legendPosition, config?.donut, config?.showLabels, config?.showColumnNames]);

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
    return <div style={emptyStyle}>Select dimensions & measures to display a pie chart</div>;
  }

  return <div ref={chartRef} />;
});

const emptyStyle = {
  height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: '#94a3b8', fontSize: 12, textAlign: 'center', padding: 16,
};
