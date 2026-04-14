import ReactECharts from 'echarts-for-react';

export default function PieWidget({ data, config }) {
  const defaultData = [
    { value: 335, name: 'Category A' },
    { value: 310, name: 'Category B' },
    { value: 234, name: 'Category C' },
    { value: 135, name: 'Category D' },
    { value: 148, name: 'Category E' },
  ];

  const option = {
    tooltip: { trigger: 'item' },
    series: [{
      type: 'pie',
      radius: config?.donut ? ['40%', '70%'] : '70%',
      data: data?.items || defaultData,
      emphasis: {
        itemStyle: {
          shadowBlur: 10,
          shadowOffsetX: 0,
          shadowColor: 'rgba(0, 0, 0, 0.5)',
        },
      },
      label: { show: config?.showLabels ?? true },
    }],
  };

  return <ReactECharts option={option} style={{ height: '100%', width: '100%' }} />;
}
