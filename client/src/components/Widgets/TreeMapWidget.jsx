import { useRef, memo, useMemo } from 'react';
import formatNumber, { abbreviateNumber } from '../../utils/formatNumber';
import { formatDuration, isDurationCol } from '../../utils/formatHuman';
import { useStableColorOrder } from '../../hooks/useStableColorOrder';
import { applyTopN } from '../../utils/topNGroup';
import { compareAxisValues } from '../../utils/axisSort';
import { CHART_COLORS_BASIC as COLORS, OTHERS_COLOR } from '../../utils/chartPalette';
import { useChartFonts } from '../../hooks/useChartFonts';
import { useEchartsInstance } from '../../hooks/useEchartsInstance';
import WidgetEmptyState from './WidgetEmptyState';
import { resolveZoneSorts } from '../../utils/chartSorts';
import { buildValueGradient } from '../../utils/chartGradient';

export default memo(function TreeMapWidget({ data, config, chartWidth, chartHeight, onDataClick, highlightValue }) {
  const hasData = data?.items?.length > 0;
  const showDataLabels = config?.showDataLabels ?? true;
  const dataLabelContent = config?.dataLabelContent || 'nameValue';
  const dataLabelAbbr = config?.dataLabelAbbr || 'none';
  const dataLabelColor = config?.dataLabelColor || '#ffffff';
  const dataLabelSize = config?.dataLabelFontSize || 12;
  const { dataLabel: dataLabelFontFamily } = useChartFonts(config, ['dataLabel']);
  // Treemap defaults to descending values when nothing else is configured —
  // a tile sorted by area is the genre's whole point.
  const { sortOrder, axisSort } = resolveZoneSorts(config, { valuesDefault: 'desc' });
  const showBorder = config?.showItemBorder ?? true;
  const borderColor = config?.itemBorderColor || '#ffffff';
  const borderWidth = config?.itemBorderWidth ?? 1;
  const topNEnabled = config?.topNEnabled === true;
  const topN = config?.topN ?? 20;
  const othersLabel = config?.othersLabel || 'Others';

  const allItemNames = useMemo(() => (data?.items || []).map((it) => it?.name).filter((n) => n != null), [data?.items]);
  const { getStableIdx } = useStableColorOrder(allItemNames.join('|'), allItemNames);

  const memoResult = useMemo(() => {
    if (!hasData) return { option: null };
    const fmt = Object.values(data._measureFormats || {})[0];
    const customColors = config?.legendColors || {};
    const getColor = (name) => customColors[name] || COLORS[getStableIdx(name) % COLORS.length];

    const gradient = config?.valueGradient;
    const useGradient = gradient?.enabled === true;
    let getValueColor = null;
    if (useGradient) {
      getValueColor = buildValueGradient(gradient, data.items.map((it) => it?.value));
    }

    let items = [...data.items];
    if (sortOrder === 'desc') items.sort((a, b) => b.value - a.value);
    else if (sortOrder === 'asc') items.sort((a, b) => a.value - b.value);
    else if (axisSort !== 'none') {
      const axisDimDef = data._axisDimDef;
      items.sort((a, b) => compareAxisValues(a.name, b.name, axisDimDef, axisSort));
    }

    // Top N + Others — server-side path uses data._othersTotal (top N already
    // sorted by value DESC server-side); legacy client-side path folds the
    // visible long tail.
    if (topNEnabled && typeof data._othersTotal === 'number') {
      const sumKept = items.reduce((s, it) => s + (Number(it.value) || 0), 0);
      const othersValue = Math.max(0, data._othersTotal - sumKept);
      if (othersValue > 0) {
        items = [...items, { name: othersLabel, value: othersValue, _isOthers: true }];
      }
    } else {
      items = applyTopN(items, { enabled: topNEnabled, n: topN, label: othersLabel });
    }

    const isDur = isDurationCol(data._measureLabel, data._durationColumns);
    const buildLabel = (params) => {
      const val = isDur && typeof params.value === 'number'
        ? formatDuration(params.value)
        : (abbreviateNumber(params.value, dataLabelAbbr) ?? formatNumber(params.value, fmt));
      if (dataLabelContent === 'name') return params.name;
      if (dataLabelContent === 'value') return String(val);
      if (dataLabelContent === 'nameValue') return `${params.name}\n${val}`;
      if (dataLabelContent === 'percent' && params.treePathInfo) {
        const total = items.reduce((s, it) => s + (it.value || 0), 0) || 1;
        const pct = ((params.value / total) * 100).toFixed(1);
        return `${pct}%`;
      }
      return params.name;
    };

    const treeData = items.map((it, i) => ({
      name: it.name,
      value: it.value,
      _isOthers: it._isOthers,
      itemStyle: {
        color: it._isOthers
          ? OTHERS_COLOR
          : (useGradient ? getValueColor(it.value) : getColor(it.name, i)),
        borderColor: showBorder ? borderColor : 'transparent',
        borderWidth: showBorder ? borderWidth : 0,
        opacity: highlightValue && it.name !== highlightValue ? 0.3 : 1,
      },
    }));

    const opt = {
      tooltip: {
        trigger: 'item',
        appendToBody: true,
        formatter: (params) => {
          const v = isDur && typeof params.value === 'number' ? formatDuration(params.value) : formatNumber(params.value, fmt);
          const total = items.reduce((s, it) => s + (it.value || 0), 0) || 1;
          const pct = ((params.value / total) * 100).toFixed(1);
          return `${params.marker} ${params.name}: <b>${v}</b> (${pct}%)`;
        },
      },
      series: [{
        type: 'treemap',
        roam: false,
        nodeClick: false,
        breadcrumb: { show: false },
        label: {
          show: showDataLabels,
          color: dataLabelColor,
          fontSize: dataLabelSize,
          fontFamily: dataLabelFontFamily,
          lineHeight: Math.round(dataLabelSize * 1.5),
          formatter: buildLabel,
          overflow: 'truncate',
        },
        upperLabel: { show: false },
        left: 0, right: 0, top: 0, bottom: 0,
        data: treeData,
        levels: [{
          itemStyle: {
            borderColor: showBorder ? borderColor : 'transparent',
            borderWidth: showBorder ? borderWidth : 0,
            gapWidth: showBorder ? borderWidth : 0,
          },
        }],
      }],
    };

    return { option: opt };
  }, [data, hasData, sortOrder, axisSort, showDataLabels, dataLabelContent, dataLabelAbbr, dataLabelColor, dataLabelSize, showBorder, borderColor, borderWidth, highlightValue, config?.legendColors,
      topNEnabled, topN, othersLabel,
      config?.valueGradient?.enabled, config?.valueGradient?.minColor, config?.valueGradient?.maxColor]);

  const option = memoResult?.option;

  // Click → cross-filter on the dim name. Skip the synthetic Others leaf
  // (no real dim value behind it).
  const onDataClickRef = useRef(onDataClick);
  onDataClickRef.current = onDataClick;
  const dimNameRef = useRef(data?._dimName);
  dimNameRef.current = data?._dimName;
  const chartRef = useEchartsInstance({
    option,
    onInit: (instance) => {
      instance.on('click', (params) => {
        if (params.data?._isOthers) return;
        if (params.data?.name && onDataClickRef.current) {
          onDataClickRef.current(dimNameRef.current || 'dimension', String(params.data.name));
        }
      });
    },
  });

  if (!hasData) return <WidgetEmptyState data={data} config={config} unboundHint="Select a dimension & measure to display a treemap" />;

  return <div ref={chartRef} style={{ width: '100%', height: '100%' }} />;
});
