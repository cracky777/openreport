import { useRef, memo, useMemo } from 'react';
import formatNumber, { abbreviateNumber } from '../../utils/formatNumber';
import { formatDuration, isDurationCol } from '../../utils/formatHuman';
import ChartLegend from './ChartLegend';
import { useStableColorOrder } from '../../hooks/useStableColorOrder';
import { applyTopN } from '../../utils/topNGroup';
import { compareAxisValues } from '../../utils/axisSort';
import { CHART_COLORS_BASIC as COLORS, OTHERS_COLOR, hexToRgba } from '../../utils/chartPalette';
import { useHiddenSeries } from '../../hooks/useHiddenSeries';
import { useChartFonts } from '../../hooks/useChartFonts';
import { useEchartsInstance } from '../../hooks/useEchartsInstance';
import WidgetEmptyState from './WidgetEmptyState';
import { resolveZoneSorts } from '../../utils/chartSorts';
import { buildValueGradient } from '../../utils/chartGradient';

export default memo(function PieWidget({ data, config, chartWidth, chartHeight, onDataClick, highlightValue }) {
  const { hiddenSeries, toggleSeries } = useHiddenSeries();

  const hasData = data?.items?.length > 0;
  const showLegend = config?.showLegend ?? false;
  const legendPosition = config?.legendPosition || 'top';
  const showDataLabels = config?.showDataLabels ?? (config?.showLabels ?? true);
  const dataLabelContent = config?.dataLabelContent || 'value';
  const dataLabelAbbr = config?.dataLabelAbbr || 'none';
  const dataLabelRotate = config?.dataLabelRotate ?? 0;
  const dataLabelColor = config?.dataLabelColor || '#475569';
  const dataLabelBgColor = config?.dataLabelBgColor || '#ffffff';
  const dataLabelBgOpacity = config?.dataLabelBgOpacity ?? 0;
  const { dataLabel: dataLabelFontFamily } = useChartFonts(config, ['dataLabel']);
  const { sortOrder, axisSort } = resolveZoneSorts(config);
  const topNEnabled = config?.topNEnabled === true;
  const topN = config?.topN ?? 20;
  const othersLabel = config?.othersLabel || 'Others';
  const w = chartWidth || 400;
  const h = chartHeight || 300;

  const allItemNames = useMemo(() => (data?.items || []).map((it) => it?.name).filter((n) => n != null), [data?.items]);
  const { getStableIdx } = useStableColorOrder(allItemNames.join('|'), allItemNames);

  const memoResult = useMemo(() => {
    if (!hasData) return { option: null, legendItems: [] };
    const fmt = Object.values(data._measureFormats || {})[0];
    const customColors = config?.legendColors || {};
    const getColor = (name) => customColors[name] || COLORS[getStableIdx(name) % COLORS.length];

    const gradient = config?.valueGradient;
    const useGradient = gradient?.enabled === true;
    let getValueColor = null;
    if (useGradient) {
      getValueColor = buildValueGradient(gradient, data.items.map((it) => it?.value));
    }

    // Pie's value comes from one measure (`_measureLabel`). If it's an
    // interval the slice values are EPOCH seconds → render as duration.
    const isDur = isDurationCol(data._measureLabel, data._durationColumns);
    const buildLabel = (params) => {
      const val = isDur && typeof params.value === 'number'
        ? formatDuration(params.value)
        : (abbreviateNumber(params.value, dataLabelAbbr) ?? formatNumber(params.value, fmt));
      if (dataLabelContent === 'name') return params.name;
      if (dataLabelContent === 'nameValue') return `${params.name}: ${val}`;
      if (dataLabelContent === 'percent') return `${params.percent}%`;
      return val;
    };

    let visibleItems = hiddenSeries.size > 0
      ? data.items.filter((item) => !hiddenSeries.has(item.name))
      : [...data.items];

    if (sortOrder === 'desc') {
      visibleItems = [...visibleItems].sort((a, b) => b.value - a.value);
    } else if (sortOrder === 'asc') {
      visibleItems = [...visibleItems].sort((a, b) => a.value - b.value);
    } else if (axisSort !== 'none') {
      const axisDimDef = data._axisDimDef;
      visibleItems = [...visibleItems].sort((a, b) => compareAxisValues(a.name, b.name, axisDimDef, axisSort));
    }

    // Top N + Others. Two paths:
    //   1. Server-side Top N — `data._othersTotal` is set: items already are
    //      the actual top N (sorted by value DESC by the SQL query); Others
    //      is total − Σ(top N), computed by a parallel total query.
    //   2. Legacy client-side fallback — applyTopN folds the visible long tail.
    if (topNEnabled && typeof data._othersTotal === 'number') {
      const sumKept = visibleItems.reduce((s, it) => s + (Number(it.value) || 0), 0);
      const othersValue = Math.max(0, data._othersTotal - sumKept);
      if (othersValue > 0) {
        visibleItems = [...visibleItems, { name: othersLabel, value: othersValue, _isOthers: true }];
      }
    } else {
      visibleItems = applyTopN(visibleItems, { enabled: topNEnabled, n: topN, label: othersLabel });
    }

    const opt = {
      tooltip: {
        trigger: 'item',
        appendToBody: true,
        formatter: (params) => {
          const v = isDur && typeof params.value === 'number' ? formatDuration(params.value) : formatNumber(params.value, fmt);
          return `${params.marker} ${params.name}: <b>${v}</b> (${params.percent}%)`;
        },
      },
      legend: { show: false },
      series: [{
        type: 'pie',
        radius: config?.donut ? ['30%', '65%'] : '65%',
        center: ['50%', '50%'],
        data: visibleItems.map((it) => {
          const color = it._isOthers
            ? OTHERS_COLOR
            : (useGradient ? getValueColor(it.value) : getColor(it.name));
          return {
            ...it,
            itemStyle: {
              ...it.itemStyle,
              color,
              opacity: highlightValue ? (it.name === highlightValue ? 1 : 0.3) : 1,
            },
          };
        }),
        emphasis: { disabled: true },
        label: {
          show: showDataLabels,
          position: config?.dataLabelPosition || 'outside',
          fontSize: config?.dataLabelFontSize ?? 12,
          fontFamily: dataLabelFontFamily,
          formatter: buildLabel,
          rotate: dataLabelRotate,
          color: dataLabelColor,
          backgroundColor: dataLabelBgOpacity > 0 ? hexToRgba(dataLabelBgColor, dataLabelBgOpacity) : 'transparent',
          padding: dataLabelBgOpacity > 0 ? [2, 4] : 0,
          borderRadius: 2,
        },
        labelLine: {
          show: showDataLabels && (config?.dataLabelPosition || 'outside') === 'outside',
          length: 15,
          length2: 10,
          smooth: true,
        },
      }],
    };

    // Mirror the slice list for the legend: same Top-N folding so the legend
    // doesn't list categories that were rolled into Others.
    const legendItems = visibleItems.map((it, i) => ({
      name: it.name,
      color: it._isOthers ? OTHERS_COLOR : getColor(it.name, i),
    }));
    return { option: opt, legendItems };
  }, [data, hasData, showLegend, legendPosition, config?.donut, showDataLabels, dataLabelContent,
      dataLabelAbbr, dataLabelRotate, dataLabelColor, dataLabelBgColor, dataLabelBgOpacity, hiddenSeries, sortOrder, axisSort, highlightValue, config?.legendColors, config?.dataLabelPosition,
      topNEnabled, topN, othersLabel,
      config?.valueGradient?.enabled, config?.valueGradient?.minColor, config?.valueGradient?.maxColor]);

  const option = memoResult?.option;
  const legendItems = memoResult?.legendItems || [];

  // Click → cross-filter on the dim name. Skip the synthetic "Others"
  // slice — it has no real dim value behind it.
  const onDataClickRef = useRef(onDataClick);
  onDataClickRef.current = onDataClick;
  const dimNameRef = useRef(data?._dimName);
  dimNameRef.current = data?._dimName;
  const chartRef = useEchartsInstance({
    option,
    onInit: (instance) => {
      instance.on('click', (params) => {
        if (params.data?._isOthers) return;
        if (params.name && onDataClickRef.current) {
          onDataClickRef.current(dimNameRef.current || 'dimension', params.name);
        }
      });
    },
    recreateDeps: [showLegend, legendPosition],
  });

  if (!hasData) return <WidgetEmptyState data={data} config={config} unboundHint="Select dimensions & measures to display a pie chart" />;

  const showHtmlLegend = showLegend && legendItems.length > 0;
  const flexDir = legendPosition === 'left' || legendPosition === 'right' ? 'row' : 'column';

  return (
    <div style={{ display: 'flex', flexDirection: flexDir, width: '100%', height: '100%' }}>
      {showHtmlLegend && (legendPosition === 'top' || legendPosition === 'left') && (
        <ChartLegend items={legendItems} position={legendPosition} onToggle={toggleSeries} hiddenSeries={hiddenSeries} fontFamily={config?.legendFontFamily} />
      )}
      <div ref={chartRef} style={{ flex: 1, minWidth: 0, minHeight: 0 }} />
      {showHtmlLegend && (legendPosition === 'bottom' || legendPosition === 'right') && (
        <ChartLegend items={legendItems} position={legendPosition} onToggle={toggleSeries} hiddenSeries={hiddenSeries} fontFamily={config?.legendFontFamily} />
      )}
    </div>
  );
});
