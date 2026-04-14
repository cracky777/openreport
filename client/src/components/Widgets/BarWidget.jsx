import ReactECharts from 'echarts-for-react';

export default function BarWidget({ data, config }) {
  const option = {
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: data?.labels || ['A', 'B', 'C', 'D', 'E'],
    },
    yAxis: { type: 'value' },
    series: [{
      type: 'bar',
      data: data?.values || [120, 200, 150, 80, 70],
      itemStyle: {
        color: config?.color || '#5470c6',
        borderRadius: [4, 4, 0, 0],
      },
    }],
    grid: { top: 20, right: 20, bottom: 30, left: 50 },
  };

  return <ReactECharts option={option} style={{ height: '100%', width: '100%' }} />;
}
