import { useRef, memo, useMemo } from 'react';
import formatNumber, { abbreviateNumber } from '../../utils/formatNumber';
import { formatDuration, isDurationCol } from '../../utils/formatHuman';
import ChartLegend from './ChartLegend';
import { sortDateLabels, formatDateLabel } from '../../utils/dateHelpers';
import { compareAxisValues } from '../../utils/axisSort';
import { calcLabelRotation, calcBottomMargin } from '../../utils/chartHelpers';
import { useStableColorOrder } from '../../hooks/useStableColorOrder';
import { CHART_COLORS as COLORS, hexToRgba } from '../../utils/chartPalette';
import { useHiddenSeries } from '../../hooks/useHiddenSeries';
import { useChartFonts } from '../../hooks/useChartFonts';
import { useEchartsInstance } from '../../hooks/useEchartsInstance';
import WidgetEmptyState from './WidgetEmptyState';
import { resolveZoneSorts } from '../../utils/chartSorts';
import { buildValueGradient } from '../../utils/chartGradient';

export default memo(function ComboWidget({ data, config, chartWidth, chartHeight, onDataClick, highlightValue }) {
  const { hiddenSeries, toggleSeries } = useHiddenSeries();

  const w = chartWidth || 400;
  const hasData = data?.labels?.length > 0 && (data?.barSeries?.length > 0 || data?.lineSeries?.length > 0);
  const subType = config?.subType || 'stackedCombo';
  const isStacked = subType === 'stackedCombo';
  const showXAxis = config?.showXAxis ?? true;
  const showYAxis = config?.showYAxis ?? true;
  const showLegend = config?.showLegend ?? false;
  const legendPosition = config?.legendPosition || 'top';
  const showDataLabels = config?.showDataLabels ?? false;
  const dataLabelFontSize = config?.dataLabelFontSize ?? 10;
  const dataLabelColor = config?.dataLabelColor || '#475569';
  const {
    dataLabel: dataLabelFontFamily,
    xAxisLabel: xAxisFontFamily,
    yAxisLabel: yAxisFontFamily,
    secondaryYAxisLabel: secYAxisFontFamily,
  } = useChartFonts(config, ['dataLabel', 'xAxisLabel', 'yAxisLabel', 'secondaryYAxisLabel']);
  const valueAbbr = config?.valueAbbreviation || 'none';
  const hideZeros = config?.hideZeros ?? false;
  const gridLineStyle = config?.gridLineStyle || 'solid';
  const gridLineWidth = config?.gridLineWidth ?? 1;
  const showSecondaryAxis = config?.showSecondaryAxis ?? true;
  const smoothLine = config?.smooth ?? true;
  const { sortOrder, axisSort, groupBySort } = resolveZoneSorts(config);

  // Stable color ordering across filters: combine bar + line series into one seen-order list
  const allComboNames = useMemo(() => {
    const names = [];
    for (const s of (data?.barSeries || [])) if (s?.name) names.push(s.name);
    for (const s of (data?.lineSeries || [])) if (s?.name) names.push(s.name);
    return names;
  }, [data?.barSeries, data?.lineSeries]);
  const { getStableIdx } = useStableColorOrder(allComboNames.join('|'), allComboNames);

  const memoResult = useMemo(() => {
    if (!hasData) return { option: null, legendItems: [] };

    const customColors = config?.legendColors || {};
    const allBarNames = (data.barSeries || []).map((s) => s.name);
    const allLineNames = (data.lineSeries || []).map((s) => s.name);

    // Value-driven gradient — applies to bar segments only (lines keep their series color).
    // Skipped on stacked combo since stacked segments coloured by value mislead the eye.
    const gradient = config?.valueGradient;
    const useGradient = gradient?.enabled === true && !isStacked;
    let getValueColor = null;
    if (useGradient) {
      const flatValues = (data.barSeries || []).flatMap((s) => s.values || []);
      getValueColor = buildValueGradient(gradient, flatValues);
    }

    const colorMap = {};
    allBarNames.forEach((n) => { colorMap[n] = customColors[n] || COLORS[getStableIdx(n) % COLORS.length]; });
    allLineNames.forEach((n) => { colorMap[n] = customColors[n] || COLORS[getStableIdx(n) % COLORS.length]; });
    const getColor = (name) => colorMap[name] || customColors[name] || COLORS[getStableIdx(name) % COLORS.length];

    let labels = [...data.labels];
    let sortedIndices = labels.map((_, i) => i);
    const datePart = data._datePart;
    const axisDimDef = data._axisDimDef;

    // Values sort: rank by total bar value per category. Axis sort: chrono /
    // alpha by dim value. Auto chrono fallback for date dims.
    if (sortOrder === 'desc' || sortOrder === 'asc') {
      const totals = labels.map((_, i) => {
        let total = 0;
        for (const s of (data.barSeries || [])) total += s.values[i] || 0;
        return total;
      });
      sortedIndices.sort((a, b) => sortOrder === 'desc' ? totals[b] - totals[a] : totals[a] - totals[b]);
      labels = sortedIndices.map((i) => labels[i]);
    } else if (axisSort !== 'none') {
      sortedIndices.sort((a, b) => compareAxisValues(labels[a], labels[b], axisDimDef, axisSort));
      labels = sortedIndices.map((i) => labels[i]);
    } else if (datePart) {
      const { labels: sorted, indices } = sortDateLabels(labels, null, datePart);
      sortedIndices = indices.map((i) => sortedIndices[i]);
      labels = sorted;
    }

    const rawLabels = [...labels];

    if (datePart) {
      labels = labels.map((l) => formatDateLabel(l, datePart));
    }

    const series = [];
    const allLegendItems = [];
    let customYMax = undefined;
    const earlyBarDir = config?.barDirection || 'vertical';
    const earlyIsHoriz = earlyBarDir === 'horizontal' || earlyBarDir === 'horizontalInverse';

    // Bar series — Legend sort orders the cluster bars. Explicit sort
    // ranks by total volume; default falls back to chrono when the
    // legend is a date / date-table dim.
    let barSeries = (data.barSeries || []).filter((s) => !hiddenSeries.has(s.name));
    if (barSeries.length > 1) {
      const legendDimDef = data._legendDimDef;
      const totalOf = (s) => s.values.reduce((sum, v) => sum + (v || 0), 0);
      if (groupBySort !== 'none') {
        barSeries = [...barSeries].sort((a, b) => groupBySort === 'desc' ? totalOf(b) - totalOf(a) : totalOf(a) - totalOf(b));
      } else if (legendDimDef?.datePart || legendDimDef?.type === 'date') {
        barSeries = [...barSeries].sort((a, b) => compareAxisValues(a.name, b.name, legendDimDef, 'asc'));
      }
    }

    if (!isStacked && barSeries.length > 1) {
      // Clustered combo: use custom renderItem for dynamic bar widths (like BarWidget)
      customYMax = 0;
      for (const s of barSeries) for (const v of s.values) if (v > customYMax) customYMax = v;

      const nonZeroCounts = labels.map((_, li) => {
        let count = 0;
        for (const s of barSeries) if ((s.values[sortedIndices[li]] || 0) !== 0) count++;
        return Math.max(count, 1);
      });
      const seriesNonZeroIndex = barSeries.map((s, si) => {
        return labels.map((_, li) => {
          if ((s.values[sortedIndices[li]] || 0) === 0) return -1;
          let idx = 0;
          for (let j = 0; j < si; j++) if ((barSeries[j].values[sortedIndices[li]] || 0) !== 0) idx++;
          return idx;
        });
      });

      barSeries.forEach((s, i) => {
        const color = getColor(s.name);
        allLegendItems.push({ name: s.name, color });
        const nzCounts = nonZeroCounts;
        const nzIndices = seriesNonZeroIndex[i];
        const sortedValues = sortedIndices.map((idx) => s.values[idx] || 0);

        series.push({
          type: 'custom',
          name: s.name,
          // Swap data order so axes match (xAxis=value in horizontal, xAxis=category in vertical)
          data: earlyIsHoriz ? sortedValues.map((v, ci) => [v, ci]) : sortedValues.map((v, ci) => [ci, v]),
          itemStyle: { color },
          emphasis: { disabled: true },
          renderItem: (params, api) => {
            const v0 = api.value(0);
            const v1 = api.value(1);
            const catIdx = earlyIsHoriz ? v1 : v0;
            const value = earlyIsHoriz ? v0 : v1;
            if (value === 0) return null;
            const nzCount = nzCounts[catIdx];
            const nzIdx = nzIndices[catIdx];
            if (nzIdx < 0) return null;
            const groupPad = 0.15;
            const barGap = nzCount > 1 ? 0.08 : 0;
            const dimmed = highlightValue && rawLabels[catIdx] !== highlightValue;

            if (earlyIsHoriz) {
              const bandHeight = api.size([0, 1])[1];
              const groupHeight = bandHeight * (1 - groupPad * 2);
              const slotHeight = groupHeight / nzCount;
              const barHeight = slotHeight * (1 - barGap);
              const base = api.coord([0, catIdx]);
              const top = api.coord([value, catIdx]);
              const y = base[1] - bandHeight / 2 + bandHeight * groupPad + slotHeight * nzIdx + (slotHeight - barHeight) / 2;
              const x = Math.min(base[0], top[0]);
              const width = Math.abs(top[0] - base[0]);
              return {
                type: 'rect',
                shape: { x, y, width, height: barHeight },
                style: { ...api.style(), fill: useGradient ? getValueColor(value) : color, opacity: dimmed ? 0.3 : 1 },
              };
            }

            const bandWidth = api.size([1, 0])[0];
            const groupWidth = bandWidth * (1 - groupPad * 2);
            const slotWidth = groupWidth / nzCount;
            const barWidth = slotWidth * (1 - barGap);
            const base = api.coord([catIdx, 0]);
            const top = api.coord([catIdx, value]);
            const x = base[0] - bandWidth / 2 + bandWidth * groupPad + slotWidth * nzIdx + (slotWidth - barWidth) / 2;
            return {
              type: 'rect',
              shape: { x, y: top[1], width: barWidth, height: base[1] - top[1] },
              style: { ...api.style(), fill: useGradient ? getValueColor(value) : color, opacity: dimmed ? 0.3 : 1 },
            };
          },
        });
      });
    } else {
      // Stacked or single bar: standard ECharts bar series
      barSeries.forEach((s) => {
        const color = getColor(s.name);
        allLegendItems.push({ name: s.name, color });
        series.push({
          type: 'bar',
          name: s.name,
          data: useGradient
            ? sortedIndices.map((idx) => { const v = s.values[idx] || 0; return { value: v, itemStyle: { color: getValueColor(v) } }; })
            : sortedIndices.map((idx) => s.values[idx] || 0),
          stack: isStacked ? 'bar' : undefined,
          itemStyle: { color },
          emphasis: { disabled: true },
          label: {
            show: showDataLabels, position: 'top', fontSize: dataLabelFontSize, fontFamily: dataLabelFontFamily, color: dataLabelColor,
            formatter: (p) => {
              if (hideZeros && (p.value === 0 || p.value == null)) return '';
              if (isDurationCol(p.seriesName, data._durationColumns) && typeof p.value === 'number') return formatDuration(p.value);
              return abbreviateNumber(p.value, valueAbbr) ?? formatNumber(p.value);
            },
          },
        });
      });
    }

    // Line series
    // In horizontal / horizontalInverse mode the value axes become
    // xAxes (see the swap below), so the line must reference
    // `xAxisIndex` instead of `yAxisIndex` — otherwise it tries to
    // plot against the category axis and either renders nothing or
    // draws garbage at category[0]. Same `1` (secondary) / `0`
    // (primary, when showSecondaryAxis is off) semantics, just on the
    // axis dimension that actually holds the value scale.
    const lineSeries = (data.lineSeries || []).filter((s) => !hiddenSeries.has(s.name));
    const lineValueAxisProp = earlyIsHoriz ? 'xAxisIndex' : 'yAxisIndex';
    lineSeries.forEach((s) => {
      const color = getColor(s.name);
      allLegendItems.push({ name: s.name, color });
      series.push({
        type: 'line',
        name: s.name,
        data: sortedIndices.map((idx) => s.values[idx] || 0),
        [lineValueAxisProp]: showSecondaryAxis ? 1 : 0,
        smooth: smoothLine,
        lineStyle: { color, width: 2 },
        itemStyle: { color },
        symbol: 'circle',
        symbolSize: 6,
        emphasis: { disabled: true },
        label: {
          show: showDataLabels, position: 'top', fontSize: dataLabelFontSize, fontFamily: dataLabelFontFamily, color: dataLabelColor,
          formatter: (p) => {
            if (hideZeros && (p.value === 0 || p.value == null)) return '';
            if (isDurationCol(p.seriesName, data._durationColumns) && typeof p.value === 'number') return formatDuration(p.value);
            return abbreviateNumber(p.value, valueAbbr) ?? formatNumber(p.value);
          },
        },
      });
    });

    // Highlight
    const hl = highlightValue;
    if (hl) {
      series.forEach((s) => {
        if (s.type === 'custom') return; // custom bars handle highlight in renderItem
        if (s.data) {
          s.data = s.data.map((val, i) => {
            const isObj = typeof val === 'object' && val !== null;
            const v = isObj ? val.value ?? val : val;
            const prevStyle = isObj ? val.itemStyle || {} : {};
            const o = rawLabels[i] === hl ? 1 : 0.3;
            return { value: v, itemStyle: { ...prevStyle, opacity: o } };
          });
        }
      });
    }

    const yAxisInterval = config?.yAxisInterval;
    const secondaryYAxisInterval = config?.secondaryYAxisInterval;
    // Compute max for both bars and lines. Apply 10% headroom so nothing gets clipped at the top.
    let barMax = customYMax || 0;
    if (!customYMax) {
      for (const s of (data.barSeries || [])) for (const v of s.values) if (v > barMax) barMax = v;
    }
    let lineMax = 0;
    for (const s of (data.lineSeries || [])) for (const v of s.values) if (v > lineMax) lineMax = v;
    // When secondary axis is on, each axis has its own scale.
    // When off, both bars and lines share the primary axis — use the larger max so nothing gets clipped.
    const leftRaw = showSecondaryAxis ? barMax : Math.max(barMax, lineMax);
    const leftMax = leftRaw > 0 ? Math.ceil(leftRaw * 1.1) : undefined;
    const rightMax = lineMax > 0 ? Math.ceil(lineMax * 1.1) : undefined;
    const yAxisFontSize = config?.yAxisLabelFontSize ?? 11;
    const yAxisColor = config?.yAxisLabelColor || '#64748b';
    const secYAxisFontSize = config?.secondaryYAxisLabelFontSize ?? 11;
    const secYAxisColor = config?.secondaryYAxisLabelColor || '#64748b';

    // Axis title derivation: x = dim label, primary y = Bar values bucket, secondary y = Line values bucket
    const showXTitle = config?.showXAxisTitle ?? true;
    const showYTitle = config?.showYAxisTitle ?? true;
    const showSecYTitle = config?.showSecondaryYAxisTitle ?? true;
    const barBucketLabel = data._barMeasureLabel || '';
    const lineBucketLabel = data._lineMeasureLabel || '';
    // If no secondary axis, lines share the primary axis — fall back to line label when no bars
    const defaultPrimaryTitle = barBucketLabel || (!showSecondaryAxis ? lineBucketLabel : '');
    const xTitleVal = showXTitle ? ((config?.xAxisTitle ?? '') || (data._dimLabel || '')) : '';
    const yTitleVal = showYTitle ? ((config?.yAxisTitle ?? '') || defaultPrimaryTitle) : '';
    const secYTitleVal = showSecYTitle ? ((config?.secondaryYAxisTitle ?? '') || lineBucketLabel) : '';
    const yNameCfg = yTitleVal ? { name: yTitleVal, nameLocation: 'center', nameGap: 40, nameTextStyle: { fontSize: yAxisFontSize + 1, color: yAxisColor, fontWeight: 500, fontFamily: yAxisFontFamily } } : {};
    const secYNameCfg = secYTitleVal ? { name: secYTitleVal, nameLocation: 'center', nameGap: 40, nameTextStyle: { fontSize: secYAxisFontSize + 1, color: secYAxisColor, fontWeight: 500, fontFamily: secYAxisFontFamily } } : {};

    // Combo has two Y axes — primary holds the bars, secondary holds the
    // lines. Check whether the corresponding measure-label group is an
    // interval so each axis can switch independently to duration format.
    const barLabelsArr = (data._barMeasureLabel || '').split(',').map((s) => s.trim()).filter(Boolean);
    const lineLabelsArr = (data._lineMeasureLabel || '').split(',').map((s) => s.trim()).filter(Boolean);
    const isBarAxisDur = barLabelsArr.some((l) => isDurationCol(l, data._durationColumns));
    const isLineAxisDur = lineLabelsArr.some((l) => isDurationCol(l, data._durationColumns));
    const yAxes = [{
      type: 'value', show: showYAxis,
      max: leftMax,
      interval: yAxisInterval || undefined,
      ...yNameCfg,
      axisLabel: { fontSize: yAxisFontSize, color: yAxisColor, fontFamily: yAxisFontFamily, formatter: (v) => isBarAxisDur ? formatDuration(v) : (abbreviateNumber(v, valueAbbr) ?? formatNumber(v)) },
      splitLine: { lineStyle: { type: gridLineStyle, width: gridLineWidth } },
    }];
    if (showSecondaryAxis) {
      yAxes.push({
        type: 'value', show: showYAxis, position: 'right',
        max: rightMax,
        interval: secondaryYAxisInterval || undefined,
        ...secYNameCfg,
        axisLabel: { fontSize: secYAxisFontSize, color: secYAxisColor, fontFamily: secYAxisFontFamily, formatter: (v) => isLineAxisDur ? formatDuration(v) : (abbreviateNumber(v, valueAbbr) ?? formatNumber(v)) },
        splitLine: { show: false },
      });
    }

    const opt = {
      tooltip: {
        trigger: customYMax ? 'item' : 'axis',
        appendToBody: true,
        formatter: (params) => {
          // 'item' trigger: params is a single object; 'axis' trigger: params is an array
          const items = Array.isArray(params) ? params : [params];
          const axisLabel = items[0]?.name || items[0]?.axisValue || '';
          let result = `<b>${axisLabel}</b><br/>`;
          items.forEach((p) => {
            const val = Array.isArray(p.value) ? p.value[1] : p.value;
            if (hideZeros && (val === 0 || val == null)) return;
            const v = isDurationCol(p.seriesName, data._durationColumns) && typeof val === 'number'
              ? formatDuration(val)
              : formatNumber(val);
            result += `${p.marker} ${p.seriesName}: <b>${v}</b><br/>`;
          });
          return result;
        },
      },
      legend: { show: false },
    };

    const barDir = config?.barDirection || 'vertical';
    const isHoriz = barDir === 'horizontal' || barDir === 'horizontalInverse';
    const isInverse = barDir === 'verticalInverse' || barDir === 'horizontalInverse';

    const xAxisFontSize = config?.xAxisLabelFontSize ?? 11;
    const xAxisColor = config?.xAxisLabelColor || '#64748b';
    const xNameCfg = xTitleVal ? { name: xTitleVal, nameLocation: 'center', nameGap: 28, nameTextStyle: { fontSize: xAxisFontSize + 1, color: xAxisColor, fontWeight: 500, fontFamily: xAxisFontFamily } } : {};
    const categoryAxis = {
      type: 'category', data: labels, show: showXAxis,
      ...xNameCfg,
      axisLabel: { show: true, rotate: isHoriz ? 0 : calcLabelRotation(labels, w), fontSize: xAxisFontSize, color: xAxisColor, fontFamily: xAxisFontFamily },
      position: barDir === 'verticalInverse' ? 'top' : barDir === 'horizontalInverse' ? 'right' : undefined,
      inverse: barDir === 'horizontalInverse',
    };

    if (isHoriz) {
      // Value axes become xAxes — and an xAxis only accepts 'top'/
      // 'bottom' (the previous code kept the original `position:'right'`
      // copied from the yAxis spec, which is invalid for an xAxis and
      // would silently fall back to bottom, overlapping the primary).
      // Primary stays at the default bottom, secondary goes to top —
      // standard combo layout. `inverse` flips the value DIRECTION, not
      // the side the axis labels sit on, so both horizontal and
      // horizontalInverse share the same axis-positioning rule.
      yAxes.forEach((a, idx) => {
        a.inverse = barDir === 'horizontalInverse';
        a.position = idx === 0 ? undefined : 'top';
      });
      opt.xAxis = yAxes;
      opt.yAxis = categoryAxis;
    } else {
      yAxes.forEach((a) => { a.inverse = barDir === 'verticalInverse'; });
      opt.xAxis = categoryAxis;
      opt.yAxis = yAxes;
    }

    opt.series = series;
    // In isHoriz mode the secondary value axis lives on TOP (xAxis,
    // position 'top'), not on the right — so the +30px reservation
    // moves from baseRight to baseTop. Vertical mode unchanged.
    const baseTop = barDir === 'verticalInverse' ? 40
      : (isHoriz && showSecondaryAxis ? 40 : 20);
    const baseRight = barDir === 'horizontalInverse' ? 80
      : (!isHoriz && showSecondaryAxis ? 50 : 20);
    const baseBottom = barDir === 'verticalInverse' ? 15 : (showXAxis ? 40 : 15);
    const baseLeft = barDir === 'horizontalInverse' ? 15 : (isHoriz ? 80 : (showYAxis ? 50 : 15));
    const catExtra = xTitleVal ? 18 : 0;
    const valExtra = yTitleVal ? 20 : 0;
    const secValExtra = (showSecondaryAxis && secYTitleVal) ? 20 : 0;
    let extraTop = 0, extraRight = 0, extraBottom = 0, extraLeft = 0;
    if (!isHoriz) {
      // Vertical: category on X, values on Y
      if (barDir === 'verticalInverse') extraTop += catExtra; else extraBottom += catExtra;
      extraLeft += valExtra;
      extraRight += secValExtra;
    } else {
      // Horizontal: values on X, category on Y
      if (barDir === 'horizontalInverse') extraRight += catExtra; else extraLeft += catExtra;
      extraBottom += valExtra;
      extraTop += secValExtra;
    }
    opt.grid = {
      top: baseTop + extraTop,
      right: baseRight + extraRight,
      bottom: baseBottom + extraBottom,
      left: baseLeft + extraLeft,
    };

    // Build legend items using stable color map
    const legendItems = [...allBarNames, ...allLineNames].map((name) => ({ name, color: colorMap[name] }));

    return { option: opt, legendItems, rawLabels };
  }, [data, hasData, isStacked, showXAxis, showYAxis, showDataLabels, dataLabelFontSize, dataLabelColor,
      valueAbbr, hideZeros, showLegend, legendPosition, gridLineStyle, gridLineWidth,
      showSecondaryAxis, smoothLine, sortOrder, axisSort, groupBySort, hiddenSeries, highlightValue,
      config?.legendColors, config?.barDirection, config?.yAxisInterval, config?.secondaryYAxisInterval,
      config?.xAxisLabelFontSize, config?.xAxisLabelColor, config?.yAxisLabelFontSize, config?.yAxisLabelColor,
      config?.secondaryYAxisLabelFontSize, config?.secondaryYAxisLabelColor,
      config?.xAxisTitle, config?.yAxisTitle, config?.secondaryYAxisTitle,
      config?.showXAxisTitle, config?.showYAxisTitle, config?.showSecondaryYAxisTitle,
      config?.valueGradient?.enabled, config?.valueGradient?.minColor, config?.valueGradient?.maxColor]);

  const option = memoResult?.option;
  const legendItems = memoResult?.legendItems || [];

  // Click → cross-filter via dataIndex → raw label lookup.
  const onDataClickRef = useRef(onDataClick);
  onDataClickRef.current = onDataClick;
  const dimNameRef = useRef(data?._dimName);
  dimNameRef.current = data?._dimName;
  const rawLabelsRef = useRef(memoResult?.rawLabels);
  rawLabelsRef.current = memoResult?.rawLabels;
  const chartRef = useEchartsInstance({
    option,
    onInit: (instance) => {
      instance.on('click', (params) => {
        const rawLabels = rawLabelsRef.current;
        const rawValue = (params.dataIndex != null && rawLabels) ? rawLabels[params.dataIndex] : params.name;
        if (rawValue != null && onDataClickRef.current) {
          onDataClickRef.current(dimNameRef.current || 'dimension', String(rawValue));
        }
      });
    },
    recreateDeps: [showLegend, legendPosition],
  });

  if (!hasData) return <WidgetEmptyState data={data} config={config} unboundHint="Drop measures in Bar Values and Line Values" />;

  const isLR = legendPosition === 'left' || legendPosition === 'right';

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: isLR ? 'row' : 'column' }}>
      {showLegend && legendItems.length > 0 && (legendPosition === 'top' || legendPosition === 'left') && (
        <ChartLegend items={legendItems} position={legendPosition} hiddenSeries={hiddenSeries} onToggle={toggleSeries} fontFamily={config?.legendFontFamily} />
      )}
      <div ref={chartRef} style={{ flex: 1, minHeight: 0, minWidth: 0 }} />
      {showLegend && legendItems.length > 0 && (legendPosition === 'bottom' || legendPosition === 'right') && (
        <ChartLegend items={legendItems} position={legendPosition} hiddenSeries={hiddenSeries} onToggle={toggleSeries} fontFamily={config?.legendFontFamily} />
      )}
    </div>
  );
});
