import { useRef, memo, useMemo } from 'react';
import formatNumber, { abbreviateNumber } from '../../utils/formatNumber';
import { formatDuration, isDurationCol } from '../../utils/formatHuman';
import ChartLegend from './ChartLegend';
import { sortDateLabels, sortDateSeries, formatDateLabel } from '../../utils/dateHelpers';
import { compareAxisValues } from '../../utils/axisSort';
import { calcLabelRotation, calcBottomMargin } from '../../utils/chartHelpers';
import { useStableColorOrder } from '../../hooks/useStableColorOrder';
import { CHART_COLORS as COLORS, OTHERS_COLOR, hexToRgba } from '../../utils/chartPalette';
import { buildDataLabel } from '../../utils/chartLabels';
import { useHiddenSeries } from '../../hooks/useHiddenSeries';
import { useChartFonts } from '../../hooks/useChartFonts';
import { useEchartsInstance } from '../../hooks/useEchartsInstance';
import WidgetEmptyState from './WidgetEmptyState';
import { resolveZoneSorts } from '../../utils/chartSorts';
import { buildValueGradient } from '../../utils/chartGradient';

// Top-N collapse for bar charts. Folds the long tail of categories into a
// single neutral "Others" bar so high-cardinality drill-downs stay readable.
// Operates on the data shape the rest of the component expects: returns a new
// `{ labels, values, series }` triplet (values for single-series; series for
// grouped/stacked). The Others bucket sums per series independently.
function applyBarTopN(rawData, options) {
  if (!rawData || !Array.isArray(rawData.labels)) return rawData;
  const { enabled, n, label = 'Others' } = options;
  if (!enabled) return rawData;
  const limit = Math.max(1, Math.floor(Number(n) || 0));
  if (!Number.isFinite(limit) || limit >= rawData.labels.length) return rawData;

  const hasSeriesIn = Array.isArray(rawData.series) && rawData.series.length > 0;
  // Per-label total to rank (sum across all series, or use values for single-series)
  const totals = rawData.labels.map((_, i) => {
    if (hasSeriesIn) {
      let t = 0;
      for (const s of rawData.series) t += Number(s.values?.[i]) || 0;
      return t;
    }
    return Number(rawData.values?.[i]) || 0;
  });
  const indices = rawData.labels.map((_, i) => i);
  indices.sort((a, b) => totals[b] - totals[a]);
  const topIdx = indices.slice(0, limit);
  const restIdx = indices.slice(limit);
  if (restIdx.length === 0) return rawData;

  // Keep top labels in their original order — the existing sortOrder logic
  // downstream is allowed to reorder them as the user requested.
  const topIdxOrdered = topIdx.slice().sort((a, b) => a - b);

  const newLabels = [...topIdxOrdered.map((i) => rawData.labels[i]), label];
  const othersIdx = newLabels.length - 1;

  let newValues = rawData.values;
  let newSeries = rawData.series;
  if (hasSeriesIn) {
    newSeries = rawData.series.map((s) => {
      const kept = topIdxOrdered.map((i) => Number(s.values?.[i]) || 0);
      const othersSum = restIdx.reduce((sum, i) => sum + (Number(s.values?.[i]) || 0), 0);
      return { ...s, values: [...kept, othersSum] };
    });
  } else if (Array.isArray(rawData.values)) {
    const kept = topIdxOrdered.map((i) => Number(rawData.values[i]) || 0);
    const othersSum = restIdx.reduce((sum, i) => sum + (Number(rawData.values[i]) || 0), 0);
    newValues = [...kept, othersSum];
  }

  return {
    ...rawData,
    labels: newLabels,
    values: newValues,
    series: newSeries,
    _othersIdx: othersIdx,
  };
}

export default memo(function BarWidget({ data, config, chartWidth, chartHeight, onDataClick, highlightValue }) {
  const { hiddenSeries, toggleSeries } = useHiddenSeries();

  const hasData = data?.labels?.length > 0;
  const subType = config?.subType || 'grouped';
  const showLabels = config?.showColumnNames ?? true;
  const showXAxis = config?.showXAxis ?? true;
  const showYAxis = config?.showYAxis ?? true;
  const gridLineStyle = config?.gridLineStyle || 'solid';
  const gridLineWidth = config?.gridLineWidth ?? 1;
  const yAxisInterval = config?.yAxisInterval;
  const valueAbbr = config?.valueAbbreviation || 'none';
  const showDataLabels = config?.showDataLabels ?? false;
  const dataLabelContent = config?.dataLabelContent || 'value';
  const dataLabelAbbr = config?.dataLabelAbbr || 'none';
  const dataLabelPosition = config?.dataLabelPosition || 'top';
  const dataLabelRotate = config?.dataLabelRotate ?? 0;
  const dataLabelColor = config?.dataLabelColor || '#475569';
  const dataLabelBgColor = config?.dataLabelBgColor || '#ffffff';
  const dataLabelBgOpacity = config?.dataLabelBgOpacity ?? 0;
  // Font family lookups — declared up here (before the series construction
  // below) so the renderItem / label object literals don't hit a TDZ error
  // when JS evaluates them eagerly. The hook triggers the matching Fontsource
  // chunk + returns a CSS family list with a sensible fallback so the chart
  // paints something while the woff2 lands. `title` is preloaded as a courtesy
  // (the canvas-level title rendered by ReportCanvas uses the same config).
  const { dataLabel: dataLabelFontFamily, xAxisLabel: xAxisFontFamily, yAxisLabel: yAxisFontFamily } = useChartFonts(config, ['dataLabel', 'xAxisLabel', 'yAxisLabel', 'title']);
  const hideZeros = config?.hideZeros ?? false;
  const showLegend = config?.showLegend ?? false;
  const legendPosition = config?.legendPosition || 'top';
  // Stacked subtypes default to descending values when nothing is set so the
  // largest segment ends up on top.
  const isStackedSubType = subType === 'stacked' || subType === 'stacked100';
  const { sortOrder, axisSort, groupBySort } = resolveZoneSorts(config, {
    valuesDefault: isStackedSubType ? 'desc' : 'none',
  });
  const topNEnabled = config?.topNEnabled === true;
  const topN = config?.topN ?? 20;
  const othersLabel = config?.othersLabel || 'Others';
  const w = chartWidth || 400;
  const h = chartHeight || 300;

  // Track all series names ever seen so colors stay stable across filters
  const allSeriesNames = useMemo(() => {
    const names = [];
    if (data?.series) for (const s of data.series) if (s?.name) names.push(s.name);
    return names;
  }, [data?.series]);
  const { getStableIdx } = useStableColorOrder(allSeriesNames.join('|'), allSeriesNames);

  // Memoize the ECharts option to avoid recalculating on every render
  const memoResult = useMemo(() => {
    if (!hasData) return { option: null, legendItems: [] };

    // Top-N pre-pass. Two paths:
    //   1. Server-side — `data._othersTotal` is set: data.labels/values are
    //      already the actual top N (sorted DESC by the SQL query). Append a
    //      single Others bar for (total − Σ(top N)). Single-series only;
    //      multi-series bars don't get this path because the total query
    //      doesn't carry the series breakdown.
    //   2. Legacy client-side — applyBarTopN folds the visible long tail,
    //      operating on whatever the server happened to return (capped 1000).
    let othersLabelIdx = -1;
    const hasSeriesData = Array.isArray(data?.series) && data.series.length > 0;
    if (topNEnabled && typeof data._othersTotal === 'number' && !hasSeriesData && Array.isArray(data.values)) {
      const sumKept = data.values.reduce((s, v) => s + (Number(v) || 0), 0);
      const othersValue = Math.max(0, data._othersTotal - sumKept);
      if (othersValue > 0) {
        const newLabels = [...data.labels, othersLabel];
        const newValues = [...data.values, othersValue];
        othersLabelIdx = data.labels.length; // index of the appended Others bar
        data = { ...data, labels: newLabels, values: newValues, _othersIdx: othersLabelIdx };
      }
    } else {
      data = applyBarTopN(data, { enabled: topNEnabled, n: topN, label: othersLabel });
      othersLabelIdx = data._othersIdx ?? -1;
    }

    const customColors = config?.legendColors || {};
    const getColor = (name) => customColors[name] || COLORS[getStableIdx(name) % COLORS.length];

    // Value-driven gradient (overrides per-series colors when enabled).
    // Skipped on stacked subtypes — segments coloured by value would mislead the eye.
    const gradient = config?.valueGradient;
    const useGradient = gradient?.enabled === true && subType !== 'stacked' && subType !== 'stacked100';
    let getValueColor = null;
    if (useGradient) {
      const flatValues = data?.series?.length
        ? data.series.flatMap((s) => s.values || [])
        : (data?.values || []);
      getValueColor = buildValueGradient(gradient, flatValues);
    }

    let seriesData = data.series && data.series.length > 0 ? [...data.series] : null;
    if (seriesData && hideZeros) {
      seriesData = seriesData.filter((s) => s.values.some((v) => v !== 0 && v != null));
    }
    // Filter out hidden series (legend toggle)
    let allSeriesForLegend = seriesData;
    if (seriesData && hiddenSeries.size > 0) {
      seriesData = seriesData.filter((s) => !hiddenSeries.has(s.name));
    }
    const hasSeries = seriesData && seriesData.length > 0;
    const isStacked = subType === 'stacked' || subType === 'stacked100';

    let labels = [...data.labels];
    let sortedIndices = labels.map((_, i) => i);
    const datePart = data._datePart;
    const axisDimDef = data._axisDimDef;

    // Sort priority: values sort wins (current behavior), then axis sort
    // (chrono-aware for date-part dims), then auto-chrono fallback for any
    // date dimension when nothing is set.
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
    } else if (axisSort !== 'none') {
      sortedIndices.sort((a, b) => compareAxisValues(labels[a], labels[b], axisDimDef, axisSort));
      labels = sortedIndices.map((i) => labels[i]);
    } else if (datePart) {
      const { labels: sorted, indices } = sortDateLabels(labels, null, datePart);
      sortedIndices = indices.map((i) => sortedIndices[i]);
      labels = sorted;
    }

    // Keep raw labels for cross-filter, format display labels separately
    const rawLabels = [...labels];
    if (datePart) {
      labels = labels.map((l) => formatDateLabel(l, datePart));
    }

    const series = [];
    let customYMax = undefined;
    const earlyBarDir = config?.barDirection || 'vertical';
    const earlyIsHoriz = earlyBarDir === 'horizontal' || earlyBarDir === 'horizontalInverse';
    if (hasSeries) {
      const legendDimDef = data._legendDimDef;
      const totalOf = (s) => s.values.reduce((sum, v) => sum + (v || 0), 0);
      if (groupBySort !== 'none') {
        // Per-zone Legend sort = order series by total VOLUME so a
        // clustered bar reads naturally from smallest to biggest (asc) or
        // the inverse (desc).
        seriesData.sort((a, b) => groupBySort === 'desc' ? totalOf(b) - totalOf(a) : totalOf(a) - totalOf(b));
      } else if (isStacked) {
        seriesData.sort((a, b) => totalOf(b) - totalOf(a));
      } else if (sortOrder !== 'none') {
        seriesData.sort((a, b) => sortOrder === 'desc' ? totalOf(b) - totalOf(a) : totalOf(a) - totalOf(b));
      } else if (legendDimDef?.datePart || legendDimDef?.type === 'date') {
        // Auto-chrono for date / date-table legend dims when no explicit
        // sort was chosen — months / years naturally read in calendar
        // order rather than the SQL row order.
        seriesData.sort((a, b) => compareAxisValues(a.name, b.name, legendDimDef, 'asc'));
      }

      if (!isStacked) {
        // Grouped bars: dynamic width per category
        // Calculate Y axis max for custom series (ECharts doesn't auto-compute for custom type)
        customYMax = 0;
        for (const s of seriesData) {
          for (const v of s.values) {
            if (v > customYMax) customYMax = v;
          }
        }

        // Pre-calculate non-zero count and index per category for each series
        const nonZeroCounts = labels.map((_, li) => {
          let count = 0;
          for (const s of seriesData) {
            if ((s.values[sortedIndices[li]] || 0) !== 0) count++;
          }
          return Math.max(count, 1);
        });
        const seriesNonZeroIndex = seriesData.map((s, si) => {
          return labels.map((_, li) => {
            const val = s.values[sortedIndices[li]] || 0;
            if (val === 0) return -1;
            let idx = 0;
            for (let j = 0; j < si; j++) {
              if ((seriesData[j].values[sortedIndices[li]] || 0) !== 0) idx++;
            }
            return idx;
          });
        });

        for (let i = 0; i < seriesData.length; i++) {
          const s = seriesData[i];
          const origIdx = allSeriesForLegend ? allSeriesForLegend.findIndex((o) => o.name === s.name) : i;
          const colorIdx = origIdx >= 0 ? origIdx : i;
          const values = sortedIndices.map((idx) => s.values[idx] || 0);
          const nzCounts = nonZeroCounts;
          const nzIndices = seriesNonZeroIndex[i];

          series.push({
            type: 'custom',
            name: s.name,
            // In horizontal mode, swap data so xAxis (value) gets the value and yAxis (category) gets catIdx
            data: earlyIsHoriz ? values.map((v, ci) => [v, ci]) : values.map((v, ci) => [ci, v]),
            itemStyle: { color: getColor(s.name, colorIdx) },
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
              const fmt = data._measureFormats?.[s.name] || null;
              const labelText = showDataLabels
                ? buildDataLabel({ value, name: labels[catIdx], seriesName: s.name }, dataLabelContent, dataLabelAbbr, fmt, { hideZeros })
                : '';
              const dimmed = highlightValue && rawLabels[catIdx] !== highlightValue;

              let rect, lx, ly, lAlign = 'center', lVAlign = 'middle';

              if (earlyIsHoriz) {
                // Horizontal: bars grow along X (value) axis, band runs along Y (category) axis
                const bandHeight = api.size([0, 1])[1];
                const groupHeight = bandHeight * (1 - groupPad * 2);
                const slotHeight = groupHeight / nzCount;
                const barHeight = slotHeight * (1 - barGap);

                const base = api.coord([0, catIdx]);
                const top = api.coord([value, catIdx]);
                const y = base[1] - bandHeight / 2 + bandHeight * groupPad + slotHeight * nzIdx + (slotHeight - barHeight) / 2;
                const x = Math.min(base[0], top[0]);
                const width = Math.abs(top[0] - base[0]);

                rect = {
                  type: 'rect',
                  shape: { x, y, width, height: barHeight },
                  style: { ...api.style(), fill: useGradient ? getValueColor(value) : getColor(s.name, colorIdx), opacity: dimmed ? 0.3 : 1 },
                };

                // Label positioning (horizontal: value runs along X)
                // Determine which end is the "top" of the bar (furthest from base)
                const isPositiveDir = top[0] >= base[0];
                if (dataLabelPosition === 'top' || !dataLabelPosition) {
                  // outside end
                  lx = isPositiveDir ? top[0] + 4 : top[0] - 4;
                  lAlign = isPositiveDir ? 'left' : 'right';
                } else if (dataLabelPosition === 'insideTop') {
                  lx = isPositiveDir ? top[0] - 4 : top[0] + 4;
                  lAlign = isPositiveDir ? 'right' : 'left';
                } else if (dataLabelPosition === 'insideBottom') {
                  lx = isPositiveDir ? base[0] + 4 : base[0] - 4;
                  lAlign = isPositiveDir ? 'left' : 'right';
                } else {
                  lx = (base[0] + top[0]) / 2;
                  lAlign = 'center';
                }
                ly = y + barHeight / 2;
              } else {
                // Vertical: bars grow along Y (value) axis, band runs along X (category) axis
                const bandWidth = api.size([1, 0])[0];
                const groupWidth = bandWidth * (1 - groupPad * 2);
                const slotWidth = groupWidth / nzCount;
                const barWidth = slotWidth * (1 - barGap);

                const base = api.coord([catIdx, 0]);
                const top = api.coord([catIdx, value]);
                const x = base[0] - bandWidth / 2 + bandWidth * groupPad + slotWidth * nzIdx + (slotWidth - barWidth) / 2;

                rect = {
                  type: 'rect',
                  shape: { x, y: top[1], width: barWidth, height: base[1] - top[1] },
                  style: { ...api.style(), fill: useGradient ? getValueColor(value) : getColor(s.name, colorIdx), opacity: dimmed ? 0.3 : 1 },
                };

                const barHeight = base[1] - top[1];
                lx = x + barWidth / 2;
                lAlign = dataLabelRotate > 0 ? 'left' : dataLabelRotate < 0 ? 'right' : 'center';
                lVAlign = 'bottom';
                if (Math.abs(dataLabelRotate) === 90) {
                  ly = top[1] + barHeight / 2;
                  lVAlign = 'middle';
                } else if (dataLabelPosition === 'top') { ly = top[1] - 4; }
                else if (dataLabelPosition === 'insideTop') { ly = top[1] + 4; lVAlign = 'top'; }
                else if (dataLabelPosition === 'insideBottom') { ly = base[1] - 4; lVAlign = 'bottom'; }
                else { ly = top[1] + barHeight / 2; lVAlign = 'middle'; }
              }

              if (!showDataLabels || !labelText) return rect;

              const rotRad = (!earlyIsHoriz && dataLabelRotate) ? (dataLabelRotate * Math.PI / 180) : 0;

              return {
                type: 'group',
                children: [
                  rect,
                  {
                    type: 'text',
                    x: lx, y: ly,
                    rotation: rotRad,
                    originX: lx,
                    originY: ly,
                    style: {
                      text: labelText,
                      fill: dataLabelColor,
                      fontSize: config?.dataLabelFontSize ?? 10,
                      fontFamily: dataLabelFontFamily,
                      align: lAlign,
                      verticalAlign: lVAlign,
                      backgroundColor: dataLabelBgOpacity > 0 ? hexToRgba(dataLabelBgColor, dataLabelBgOpacity) : undefined,
                      padding: dataLabelBgOpacity > 0 ? [2, 4] : undefined,
                      borderRadius: 2,
                    },
                  },
                ],
              };
            },
          });
        }
      } else {
        // Stacked bars: standard ECharts series
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
          const origIdx2 = allSeriesForLegend ? allSeriesForLegend.findIndex((o) => o.name === s.name) : i;
          series.push({
            type: 'bar', name: s.name, data: values,
            stack: 'total',
            itemStyle: { color: getColor(s.name, origIdx2 >= 0 ? origIdx2 : i) },
            emphasis: { focus: 'series' },
            label: { show: showDataLabels, position: dataLabelPosition, fontSize: config?.dataLabelFontSize ?? 10,
              fontFamily: dataLabelFontFamily,
              rotate: dataLabelRotate, color: dataLabelColor,
              align: dataLabelRotate > 0 ? 'left' : dataLabelRotate < 0 ? 'right' : 'center',
              verticalAlign: Math.abs(dataLabelRotate) === 90 ? 'middle' : dataLabelPosition === 'top' ? 'bottom' : 'middle',
              backgroundColor: dataLabelBgOpacity > 0 ? hexToRgba(dataLabelBgColor, dataLabelBgOpacity) : 'transparent',
              padding: dataLabelBgOpacity > 0 ? [2, 4] : 0, borderRadius: 2,
              formatter: (p) => buildDataLabel(p, dataLabelContent, dataLabelAbbr, data._measureFormats?.[p.seriesName], { hideZeros, isDuration: isDurationCol(p.seriesName, data._durationColumns) || isDurationCol(data._measureLabel, data._durationColumns) }) },
          });
        }
      }
    } else {
      series.push({
        type: 'bar',
        data: useGradient
          ? sortedIndices.map((i) => { const v = data.values[i] || 0; return { value: v, itemStyle: { color: getValueColor(v) } }; })
          : sortedIndices.map((i) => data.values[i] || 0),
        itemStyle: { color: config?.color || '#5470c6' },
        label: { show: showDataLabels, position: dataLabelPosition, fontSize: 10,
          fontFamily: dataLabelFontFamily,
          rotate: dataLabelRotate, color: dataLabelColor,
          align: Math.abs(dataLabelRotate) === 90 ? 'center' : dataLabelRotate > 0 ? 'left' : dataLabelRotate < 0 ? 'right' : 'center',
          verticalAlign: dataLabelPosition === 'top' ? 'bottom' : 'middle',
          backgroundColor: dataLabelBgOpacity > 0 ? hexToRgba(dataLabelBgColor, dataLabelBgOpacity) : 'transparent',
          padding: dataLabelBgOpacity > 0 ? [2, 4] : 0, borderRadius: 2,
          formatter: (p) => buildDataLabel(p, dataLabelContent, dataLabelAbbr, Object.values(data._measureFormats || {})[0], { hideZeros, isDuration: isDurationCol(data._measureLabel, data._durationColumns) }) },
      });
    }

    const opt = {
      tooltip: {
        trigger: 'item',
        appendToBody: true,
        formatter: (params) => {
          const fmt = data._measureFormats?.[params.seriesName] || null;
          // For custom series, params.value is [categoryIndex, value] — extract the actual value
          const val = Array.isArray(params.value) ? params.value[1] : params.value;
          const isDur = isDurationCol(params.seriesName, data._durationColumns) || isDurationCol(data._measureLabel, data._durationColumns);
          const fmtVal = (v) => isDur && typeof v === 'number' ? formatDuration(v) : formatNumber(v, fmt);
          let result = `<b>${params.name}</b><br/>`;
          result += `${params.marker} ${params.seriesName}: <b>${fmtVal(val)}</b>`;
          if (isStacked && hasSeries) {
            let total = 0;
            for (const sr of seriesData) total += sr.values[sortedIndices[params.dataIndex]] || 0;
            const pct = total > 0 ? Math.round((params.value / total) * 10000) / 100 : 0;
            result += ` (${pct}%)<br/>Total: <b>${fmtVal(total)}</b>`;
          }
          return result;
        },
      },
      legend: { show: false },
    };

    const barDir = config?.barDirection || 'vertical';
    const isHoriz = barDir === 'horizontal' || barDir === 'horizontalInverse';
    const isInverse = barDir === 'verticalInverse' || barDir === 'horizontalInverse';

    const xAxisFont = { fontSize: config?.xAxisLabelFontSize ?? 11, color: config?.xAxisLabelColor || '#64748b', fontFamily: xAxisFontFamily };
    const yAxisFont = { fontSize: config?.yAxisLabelFontSize ?? 11, color: config?.yAxisLabelColor || '#64748b', fontFamily: yAxisFontFamily };
    const showXTitle = config?.showXAxisTitle ?? true;
    const showYTitle = config?.showYAxisTitle ?? true;
    const xTitle = showXTitle ? ((config?.xAxisTitle ?? '') || (isHoriz ? (data._measureLabel || '') : (data._dimLabel || ''))) : '';
    const yTitle = showYTitle ? ((config?.yAxisTitle ?? '') || (isHoriz ? (data._dimLabel || '') : (data._measureLabel || ''))) : '';
    const categoryAxis = {
      type: 'category', data: labels, show: showXAxis,
      axisLabel: { show: showLabels, rotate: isHoriz ? 0 : calcLabelRotation(labels, w) },
      position: barDir === 'verticalInverse' ? 'top' : barDir === 'horizontalInverse' ? 'right' : undefined,
      inverse: barDir === 'horizontalInverse',
    };
    const valueAxis = {
      type: 'value', show: showYAxis,
      axisLabel: {
        show: showLabels,
        formatter: (val) => {
          // Bar/Line axes are shared across all measures plotted; if ANY of
          // them is an interval, format the whole axis as duration so the
          // ticks read consistently. Mixing 3600 with "1h" on the same
          // axis would be jarring.
          if (isDurationCol(data._measureLabel, data._durationColumns)
              || (Array.isArray(data._durationColumns) && data._durationColumns.length > 0)) {
            return formatDuration(val);
          }
          const abbr = abbreviateNumber(val, valueAbbr);
          if (abbr != null) return abbr;
          const firstFmt = Object.values(data._measureFormats || {})[0];
          return firstFmt ? formatNumber(val, firstFmt) : val.toLocaleString();
        },
      },
      max: subType === 'stacked100' ? 100 : customYMax ? Math.ceil(customYMax * 1.1) : undefined,
      interval: yAxisInterval || undefined,
      splitLine: { lineStyle: { type: gridLineStyle, width: gridLineWidth } },
      inverse: barDir === 'verticalInverse' || barDir === 'horizontalInverse',
      position: barDir === 'horizontalInverse' ? 'right' : undefined,
    };

    const xNameCfg = xTitle ? { name: xTitle, nameLocation: 'center', nameGap: 28, nameTextStyle: { fontSize: (config?.xAxisLabelFontSize ?? 11) + 1, color: config?.xAxisLabelColor || '#64748b', fontWeight: 500, fontFamily: xAxisFontFamily } } : {};
    const yNameCfg = yTitle ? { name: yTitle, nameLocation: 'center', nameGap: 40, nameTextStyle: { fontSize: (config?.yAxisLabelFontSize ?? 11) + 1, color: config?.yAxisLabelColor || '#64748b', fontWeight: 500, fontFamily: yAxisFontFamily } } : {};
    if (isHoriz) {
      opt.xAxis = { ...valueAxis, ...xNameCfg, axisLabel: { ...valueAxis.axisLabel, ...xAxisFont } };
      opt.yAxis = { ...categoryAxis, ...yNameCfg, axisLabel: { ...categoryAxis.axisLabel, ...yAxisFont } };
    } else {
      opt.xAxis = { ...categoryAxis, ...xNameCfg, axisLabel: { ...categoryAxis.axisLabel, ...xAxisFont } };
      opt.yAxis = { ...valueAxis, ...yNameCfg, axisLabel: { ...valueAxis.axisLabel, ...yAxisFont } };
    }

    opt.series = series;
    // Adjust grid margins to accommodate axis titles
    const baseTop = barDir === 'verticalInverse' ? 35 : 15;
    const baseRight = barDir === 'horizontalInverse' ? 80 : 15;
    const baseBottom = barDir === 'verticalInverse' ? 15 : (showXAxis ? calcBottomMargin(isHoriz ? 0 : calcLabelRotation(labels, w), labels) : 15);
    const baseLeft = barDir === 'horizontalInverse' ? 15 : (isHoriz ? 80 : (showYAxis ? 50 : 15));
    const xTitleExtra = xTitle ? 18 : 0;
    const yTitleExtra = yTitle ? 20 : 0;
    opt.grid = {
      top: baseTop + (barDir === 'verticalInverse' && xTitle ? xTitleExtra : 0),
      right: baseRight + (barDir === 'horizontalInverse' && yTitle ? yTitleExtra : 0),
      bottom: baseBottom + (barDir !== 'verticalInverse' && xTitle ? xTitleExtra : 0),
      left: baseLeft + (barDir !== 'horizontalInverse' && yTitle ? yTitleExtra : 0),
      containLabel: false,
    };

    // Power BI style: clicked bar = full color, all others = faded
    const hl = highlightValue;
    opt.series.forEach((s) => {
      s.emphasis = { disabled: true };
      if (s.type === 'bar' && s.data) {
        s.data = s.data.map((val, i) => {
          const isObj = typeof val === 'object' && val !== null;
          const v = isObj ? val.value ?? val : val;
          const prevStyle = isObj ? val.itemStyle || {} : {};
          // Compare highlight against raw labels (not formatted)
          const o = hl && rawLabels ? (rawLabels[i] === hl ? 1 : 0.3) : 1;
          return { value: v, itemStyle: { ...prevStyle, opacity: o } };
        });
      }
    });

    // Legend items for HTML legend
    const legendItems = (allSeriesForLegend || []).map((s, i) => ({ name: s.name, color: getColor(s.name, i) }));

    return { option: opt, legendItems, rawLabels, othersLabelIdx };
  }, [data, subType, showLabels, hideZeros, showLegend, legendPosition, sortOrder, axisSort, groupBySort, hasData, config?.color,
      showXAxis, showYAxis, gridLineStyle, gridLineWidth, yAxisInterval, valueAbbr, showDataLabels, dataLabelContent,
      dataLabelAbbr, dataLabelPosition, dataLabelRotate, dataLabelColor, dataLabelBgColor, dataLabelBgOpacity, hiddenSeries, highlightValue, config?.legendColors, config?.barDirection,
      config?.xAxisLabelFontSize, config?.xAxisLabelColor, config?.yAxisLabelFontSize, config?.yAxisLabelColor,
      config?.xAxisTitle, config?.yAxisTitle, config?.showXAxisTitle, config?.showYAxisTitle,
      topNEnabled, topN, othersLabel,
      config?.valueGradient?.enabled, config?.valueGradient?.minColor, config?.valueGradient?.maxColor]);

  const option = memoResult?.option;
  const legendItems = memoResult?.legendItems || [];

  // Click → cross-filter on the dim name. Bar's click resolution is the
  // richest of any widget: scatter-style bars carry `params.data[0]` as
  // the index, regular bars use `params.dataIndex` — both map back to
  // `rawLabels[idx]` (the unformatted dim value that drove the SQL).
  // Skip the synthetic Others bar (no real dim value behind it).
  const onDataClickRef = useRef(onDataClick);
  onDataClickRef.current = onDataClick;
  const dimNameRef = useRef(data?._dimName);
  dimNameRef.current = data?._dimName;
  const rawLabelsRef = useRef(memoResult?.rawLabels);
  rawLabelsRef.current = memoResult?.rawLabels;
  const othersIdxRef = useRef(memoResult?.othersLabelIdx ?? -1);
  othersIdxRef.current = memoResult?.othersLabelIdx ?? -1;
  const chartRef = useEchartsInstance({
    option,
    onInit: (instance) => {
      instance.on('click', (params) => {
        const rawLabels = rawLabelsRef.current;
        const idx = params.dataIndex != null
          ? params.dataIndex
          : (Array.isArray(params.data) ? params.data[0] : -1);
        if (idx === othersIdxRef.current && othersIdxRef.current >= 0) return;
        let rawValue;
        if (params.dataIndex != null && rawLabels) {
          rawValue = rawLabels[params.dataIndex];
        } else if (Array.isArray(params.data) && rawLabels) {
          rawValue = rawLabels[params.data[0]];
        } else {
          rawValue = params.name;
        }
        if (rawValue != null && onDataClickRef.current) {
          onDataClickRef.current(dimNameRef.current || 'dimension', String(rawValue));
        }
      });
    },
    recreateDeps: [showLegend, legendPosition],
  });

  if (!hasData) return <WidgetEmptyState data={data} config={config} unboundHint="Select dimensions & measures to display a bar chart" />;

  const isVertical = legendPosition === 'left' || legendPosition === 'right';
  const showHtmlLegend = showLegend && legendItems.length > 0;
  const flexDir = legendPosition === 'left' ? 'row' : legendPosition === 'right' ? 'row' : legendPosition === 'top' ? 'column' : 'column';

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
