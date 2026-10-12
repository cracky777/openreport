import { useRef, memo, useMemo } from 'react';
import formatNumber, { abbreviateNumber } from '../../utils/formatNumber';
import { compareAxisValues } from '../../utils/axisSort';
import { calcLabelRotation, categoryLabelRoom, axisLineStyle } from '../../utils/chartHelpers';
import { useChartFonts } from '../../hooks/useChartFonts';
import { useEchartsInstance } from '../../hooks/useEchartsInstance';
import { useChartTheme } from '../../hooks/useChartTheme';
import { resolveZoneSorts } from '../../utils/chartSorts';
import { waterfallSteps, WATERFALL_COLORS } from '../../utils/waterfall';
import WidgetEmptyState from './WidgetEmptyState';

const _hs0 = { width: '100%', height: '100%' };

// A running total, category by category: each bar floats from where the
// previous one ended. Drawn as a custom series so a bar may cross zero (a
// loss after a profit) without the stacking tricks of a bar chart.
export default memo(function WaterfallWidget({ data, config, chartWidth, onDataClick, highlightValue }) {
  const hasData = data?.items?.length > 0;
  const showXAxis = config?.showXAxis ?? true;
  const showYAxis = config?.showYAxis ?? true;
  const valueAbbr = config?.valueAbbreviation || 'none';
  const showDataLabels = config?.showDataLabels ?? false;
  const dataLabelAbbr = config?.dataLabelAbbr || 'none';
  const dataLabelSize = config?.dataLabelFontSize || 10;
  const { sortOrder, axisSort } = resolveZoneSorts(config, { valuesDefault: 'none' });
  const { dataLabel: dataLabelFontFamily, xAxisLabel: xAxisFontFamily, yAxisLabel: yAxisFontFamily } = useChartFonts(config, ['dataLabel', 'xAxisLabel', 'yAxisLabel', 'title']);
  const [chartTheme, rootRef] = useChartTheme();
  const gridLineColor = config?.gridLineColor || chartTheme.grid;
  // Unset, labels take the report theme's text colour: readable on dark too.
  const dataLabelColor = config?.dataLabelColor || chartTheme.text;
  const w = chartWidth || 400;

  const memoResult = useMemo(() => {
    if (!hasData) return { option: null, steps: [] };
    const fmt = Object.values(data._measureFormats || {})[0];
    let items = [...data.items];
    if (sortOrder === 'desc') items.sort((a, b) => b.value - a.value);
    else if (sortOrder === 'asc') items.sort((a, b) => a.value - b.value);
    else if (axisSort !== 'none') items.sort((a, b) => compareAxisValues(a.name, b.name, data._axisDimDef, axisSort));

    // Drilled into one category, the bars are its parts: the subtotals placed
    // among the top-level categories mean nothing there, and the closing bar
    // is that category's own total.
    const drillPath = Array.isArray(data._drillPath) ? data._drillPath : [];
    const drilledInto = drillPath.length ? drillPath[drillPath.length - 1].value : null;
    const steps = waterfallSteps(items, {
      subtotals: drilledInto == null ? config?.subtotals : [],
      showTotal: config?.showTotal ?? true,
      totalLabel: drilledInto != null ? String(drilledInto) : (config?.totalLabel || 'Total'),
      axisDimDef: data._axisDimDef,
    });
    const colors = {
      increase: config?.increaseColor || WATERFALL_COLORS.increase,
      decrease: config?.decreaseColor || WATERFALL_COLORS.decrease,
      total: config?.totalColor || WATERFALL_COLORS.total,
    };
    const labels = steps.map((s) => s.name);
    const fmtVal = (v, abbr) => abbreviateNumber(v, abbr, fmt) ?? formatNumber(v, fmt);

    const renderItem = (params, api) => {
      const i = params.dataIndex;
      const step = steps[i];
      const [x, yStart] = api.coord([i, step.start]);
      const [, yEnd] = api.coord([i, step.end]);
      const band = api.size([1, 0])[0];
      const barW = band * 0.6;
      const top = Math.min(yStart, yEnd);
      const height = Math.max(Math.abs(yEnd - yStart), 1);
      const faded = highlightValue && step.kind !== 'total' && step.name !== highlightValue;
      const children = [{
        type: 'rect',
        shape: { x: x - barW / 2, y: top, width: barW, height },
        style: { fill: colors[step.kind], opacity: faded ? 0.3 : 1 },
      }];
      // The thin step from this bar's end to the next bar: where the next one starts.
      if (i < steps.length - 1) {
        const startNext = steps[i + 1].kind === 'total' ? steps[i + 1].end : steps[i + 1].start;
        if (startNext === step.end) {
          children.push({ type: 'line', shape: { x1: x + barW / 2, y1: yEnd, x2: x + band - barW / 2, y2: yEnd }, style: { stroke: '#94a3b8', lineWidth: 1, lineDash: [3, 3] }, silent: true });
        }
      }
      if (showDataLabels) {
        const above = step.kind === 'total' ? step.end >= 0 : step.value >= 0;
        children.push({
          type: 'text',
          style: {
            text: fmtVal(step.value, dataLabelAbbr),
            x, y: above ? top - 4 : top + height + 4,
            textAlign: 'center', textVerticalAlign: above ? 'bottom' : 'top',
            fill: dataLabelColor, fontSize: dataLabelSize, fontFamily: dataLabelFontFamily,
          },
          silent: true,
        });
      }
      return { type: 'group', children };
    };

    const xRotate = config?.xAxisLabelRotate ?? calcLabelRotation(labels, w);
    // A long category ("06 Other purchases & external charges") would eat
    // the plot: cut short, whole in the tooltip.
    const labelRoom = categoryLabelRoom({ labels, rotate: xRotate, chartWidth: w, overflow: config?.axisLabelOverflow, fontSize: config?.xAxisLabelFontSize ?? 11 });
    const xAxisFont = { fontSize: config?.xAxisLabelFontSize ?? 11, color: config?.xAxisLabelColor || '#64748b', fontFamily: xAxisFontFamily };
    const yAxisFont = { fontSize: config?.yAxisLabelFontSize ?? 11, color: config?.yAxisLabelColor || '#64748b', fontFamily: yAxisFontFamily };
    const option = {
      tooltip: {
        trigger: 'item',
        appendToBody: true,
        formatter: (p) => {
          const s = steps[p.dataIndex];
          if (!s) return '';
          return s.kind === 'total'
            ? `${s.name}: <b>${fmtVal(s.value, 'none')}</b>`
            : `${s.name}: <b>${s.value > 0 ? '+' : ''}${fmtVal(s.value, 'none')}</b><br/>Running total: ${fmtVal(s.end, 'none')}`;
        },
      },
      grid: {
        top: showDataLabels ? 24 : 15, right: 15, left: showYAxis ? 60 : 15,
        bottom: showXAxis ? labelRoom.margin : 15,
      },
      xAxis: {
        type: 'category', data: labels, show: showXAxis, ...axisLineStyle(config?.xAxisLineColor),
        axisLabel: { interval: 0, rotate: xRotate, ...labelRoom.axisLabel, ...xAxisFont },
      },
      yAxis: {
        type: 'value', show: showYAxis, ...axisLineStyle(config?.yAxisLineColor),
        interval: config?.yAxisInterval || undefined,
        axisLabel: { formatter: (v) => abbreviateNumber(v, valueAbbr) ?? (fmt ? formatNumber(v, fmt) : v.toLocaleString()), ...yAxisFont },
        splitLine: { lineStyle: { type: config?.gridLineStyle || 'solid', width: config?.gridLineWidth ?? 1, color: gridLineColor } },
      },
      series: [{
        type: 'custom',
        renderItem,
        // Both ends of every bar: the value axis has to reach them all.
        encode: { x: 0, y: [1, 2] },
        data: steps.map((s, i) => [i, s.start, s.end]),
      }],
    };
    return { option, steps };
  }, [data, hasData, sortOrder, axisSort, showXAxis, showYAxis, valueAbbr, showDataLabels, dataLabelAbbr, dataLabelColor, dataLabelSize,
      dataLabelFontFamily, xAxisFontFamily, yAxisFontFamily, gridLineColor, highlightValue, w,
      config?.subtotals, config?.showTotal, config?.totalLabel, config?.increaseColor, config?.decreaseColor, config?.totalColor,
      config?.xAxisLabelRotate, config?.axisLabelOverflow, config?.xAxisLabelFontSize, config?.xAxisLabelColor, config?.xAxisLineColor,
      config?.yAxisLabelFontSize, config?.yAxisLabelColor, config?.yAxisLineColor, config?.yAxisInterval,
      config?.gridLineStyle, config?.gridLineWidth]);

  // Click → cross-filter on a category; a subtotal or the total stands for
  // no single value of the dimension.
  const onDataClickRef = useRef(onDataClick);
  onDataClickRef.current = onDataClick;
  const stepsRef = useRef(memoResult.steps);
  stepsRef.current = memoResult.steps;
  const dimNameRef = useRef(data?._dimName);
  dimNameRef.current = data?._dimName;
  const chartRef = useEchartsInstance({
    option: memoResult.option,
    onInit: (instance) => {
      instance.on('click', (params) => {
        const step = stepsRef.current[params.dataIndex];
        if (!step || step.kind === 'total' || !onDataClickRef.current) return;
        onDataClickRef.current(dimNameRef.current || 'dimension', step.name);
      });
    },
  });

  if (!hasData) return <WidgetEmptyState data={data} config={config} unboundHint="Select a category & a measure to display a waterfall" />;

  return (
    <div ref={rootRef} style={_hs0}>
      <div ref={chartRef} style={_hs0} />
    </div>
  );
});
