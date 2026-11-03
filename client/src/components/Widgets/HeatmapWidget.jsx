import { useMemo, useRef, memo } from 'react';
import formatNumber, { abbreviateNumber } from '../../utils/formatNumber';
import { formatDuration, isDurationCol } from '../../utils/formatHuman';
import { paletteOf, CHART_COLORS_BASIC as COLORS, tintOf } from '../../utils/chartPalette';
import { compareAxisValues } from '../../utils/axisSort';
import { useChartFonts } from '../../hooks/useChartFonts';
import { useChartTheme } from '../../hooks/useChartTheme';
import { useEchartsInstance } from '../../hooks/useEchartsInstance';
import WidgetEmptyState from './WidgetEmptyState';

const _chart = { width: '100%', height: '100%' };

// Order of a category axis: by the calendar for a date part, otherwise
// naturally (M9 before M12).
// The ink a cell's label reads in: light on a dark cell, dark on a pale one.
// The cell's color is the scale's, low to high, at the value's place in it.
const inkOn = (low, high, t) => {
  const at = (i) => parseInt(low.slice(i, i + 2), 16) * (1 - t) + parseInt(high.slice(i, i + 2), 16) * t;
  const lum = (0.299 * at(1) + 0.587 * at(3) + 0.114 * at(5)) / 255;
  return lum < 0.55 ? '#ffffff' : '#1f2937';
};

const ordered = (labels, def) => {
  const idx = labels.map((_, i) => i);
  return idx.sort((a, b) => compareAxisValues(labels[a], labels[b], def, 'asc'));
};

// A measure at each crossing of two dimensions (day × hour, store × month):
// one cell per crossing, coloured from a pale tint of the colour to the
// colour itself.
export default memo(function HeatmapWidget({ data, config, onDataClick, highlightValue }) {
  const hasData = data?.cells?.length > 0;
  const showLabels = config?.showDataLabels ?? (hasData && data.cells.length <= 120);
  const showScale = config?.showScale ?? false;
  const gap = config?.cellGap ?? 2;
  const { dataLabel: dataLabelFontFamily, xAxisLabel: xFont, yAxisLabel: yFont } = useChartFonts(config, ['dataLabel', 'xAxisLabel', 'yAxisLabel']);
  // Cells parted by the card's own surface, dark in a dark report.
  const [chartTheme, themeRootRef] = useChartTheme();

  const option = useMemo(() => {
    if (!hasData) return null;
    const fmt = Object.values(data._measureFormats || {})[0];
    const isDur = isDurationCol(data._measureLabel, data._durationColumns);
    const write = (v) => (isDur && typeof v === 'number' ? formatDuration(v) : formatNumber(v, fmt));
    const writeLabel = (v) => abbreviateNumber(v, config?.dataLabelAbbr || 'none', fmt) ?? write(v);
    const high = config?.scaleColor || paletteOf(config, COLORS)[0];
    const low = config?.scaleLowColor || tintOf(high);

    // Axes in their natural order; cells re-indexed to follow.
    const xOrder = ordered(data.xLabels, data._axisDimDef);
    const yOrder = ordered(data.yLabels, data._legendDimDef).reverse(); // first row on top
    const xPos = new Map(xOrder.map((orig, i) => [orig, i]));
    const yPos = new Map(yOrder.map((orig, i) => [orig, i]));
    const values = data.cells.map((c) => c[2]);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const axisLabel = (key, font) => ({
      fontSize: config?.[`${key}FontSize`] ?? 11, color: config?.[`${key}Color`] || '#64748b', fontFamily: font,
    });

    return {
      tooltip: {
        appendToBody: true,
        formatter: (p) => `${data.xLabels[xOrder[p.value[0]]]} · ${data.yLabels[yOrder[p.value[1]]]}<br/><b>${write(p.value[2])}</b>`,
      },
      grid: { left: 8, right: 12, top: 8, bottom: showScale ? 44 : 8, containLabel: true },
      xAxis: { type: 'category', data: xOrder.map((i) => data.xLabels[i]), splitArea: { show: false }, axisTick: { show: false }, axisLine: { show: false }, axisLabel: axisLabel('xAxisLabel', xFont) },
      yAxis: { type: 'category', data: yOrder.map((i) => data.yLabels[i]), splitArea: { show: false }, axisTick: { show: false }, axisLine: { show: false }, axisLabel: axisLabel('yAxisLabel', yFont) },
      visualMap: {
        show: showScale, min, max: max === min ? min + 1 : max, calculable: false,
        orient: 'horizontal', left: 'center', bottom: 0, itemWidth: 10, itemHeight: 90,
        text: [writeLabel(max), writeLabel(min)], inRange: { color: [low, high] }, textStyle: { fontSize: 10, color: '#64748b' },
      },
      series: [{
        type: 'heatmap',
        data: data.cells.map(([x, y, v]) => {
          const dim = highlightValue && data.xLabels[x] !== highlightValue;
          const ink = config?.dataLabelColor ? undefined : { color: inkOn(low, high, max === min ? 1 : (v - min) / (max - min)) };
          return { value: [xPos.get(x), yPos.get(y), v], itemStyle: dim ? { opacity: 0.3 } : undefined, label: ink };
        }),
        itemStyle: { borderColor: config?.cellBorderColor || chartTheme.panel, borderWidth: gap, borderRadius: config?.cellRadius ?? 0 },
        label: {
          show: showLabels,
          fontSize: config?.dataLabelFontSize ?? 10,
          fontFamily: dataLabelFontFamily,
          ...(config?.dataLabelColor ? { color: config.dataLabelColor } : {}),
          formatter: (p) => writeLabel(p.value[2]),
        },
        emphasis: { itemStyle: { borderColor: '#0f172a', borderWidth: 1 } },
      }],
    };
  }, [hasData, data, config, showLabels, showScale, gap, dataLabelFontFamily, xFont, yFont, highlightValue, chartTheme.panel]);

  // Click → cross-filter on the column's value.
  const onDataClickRef = useRef(onDataClick);
  onDataClickRef.current = onDataClick;
  const ref = useRef({});
  ref.current = { dimName: data?._dimName, xLabels: data?.xLabels, order: hasData ? ordered(data.xLabels, data._axisDimDef) : [] };
  const chartRef = useEchartsInstance({
    option,
    onInit: (instance) => {
      instance.on('click', (params) => {
        const { dimName, xLabels, order } = ref.current;
        const value = xLabels?.[order[params.value?.[0]]];
        if (value != null && onDataClickRef.current) onDataClickRef.current(dimName || 'dimension', value);
      });
    },
  });

  if (!hasData) return <WidgetEmptyState data={data} config={config} unboundHint="Put a dimension in Columns, another in Rows and a measure in Value" />;
  return <div ref={(el) => { chartRef.current = el; themeRootRef(el); }} style={_chart} />;
});
