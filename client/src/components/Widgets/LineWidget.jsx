import ReactECharts from 'echarts-for-react';

export default function LineWidget({ data, config }) {
  const option = {
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: data?.labels || ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
    },
    yAxis: { type: 'value' },
    series: [{
      type: 'line',
      data: data?.values || [150, 230, 224, 218, 135, 147],
      smooth: config?.smooth ?? true,
      lineStyle: { color: config?.color || '#5470c6' },
      itemStyle: { color: config?.color || '#5470c6' },
      areaStyle: config?.showArea ? { opacity: 0.15 } : undefined,
    }],
    grid: { top: 20, right: 20, bottom: 30, left: 50 },
  };

  return <ReactECharts option={option} style={{ height: '100%', width: '100%' }} />;
}
