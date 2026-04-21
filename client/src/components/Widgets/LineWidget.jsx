import { useRef, useEffect, memo, useMemo, useState, useCallback } from 'react';
import * as echarts from 'echarts';
import formatNumber, { abbreviateNumber } from '../../utils/formatNumber';
import ChartLegend from './ChartLegend';
import { sortDateLabels, formatDateLabel } from '../../utils/dateHelpers';
import { calcLabelRotation, calcBottomMargin } from '../../utils/chartHelpers';

const COLORS = [
  '#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de',
  '#3ba272', '#fc8452', '#9a60b4', '#ea7ccc', '#5ab1ef',
];

function buildDataLabel(params, content, abbrMode, fmt) {
  const val = abbreviateNumber(params.value, abbrMode) ?? formatNumber(params.value, fmt);
  if (content === 'name') return params.name || params.seriesName || '';
  if (content === 'nameValue') return `${params.name || params.seriesName || ''}: ${val}`;
  if (content === 'percent') return params.percent != null ? params.percent + '%' : val;
  return String(val);
}

function hexToRgba(hex, opacity) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${opacity / 100})`;
}

export default memo(function LineWidget({ data, config, chartWidth, chartHeight, onDataClick, highlightValue }) {
  const chartRef = useRef(null);
  const instanceRef = useRef(null);
  const prevSizeRef = useRef({ w: 0, h: 0 });
  const [hiddenSeries, setHiddenSeries] = useState(new Set());
  const toggleSeries = useCallback((name) => {
    setHiddenSeries((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }, []);

  const hasData = data?.labels?.length > 0;
  const showLabels = config?.showColumnNames ?? true;
  const showLegend = config?.showLegend ?? false;
  const legendPosition = config?.legendPosition || 'top';
  const subType = config?.subType || 'line';
  const isArea = subType !== 'line';
  const isStacked = subType === 'stackedArea' || subType === 'stackedArea100';
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
  const hideZeros = config?.hideZeros ?? false;
  const sortOrder = config?.sortOrder || 'none';
  const w = chartWidth || 400;
  const h = chartHeight || 300;

  const memoResult = useMemo(() => {
    if (!hasData) return { option: null, legendItems: [] };

    const customColors = config?.legendColors || {};
    const getColor = (name, idx) => customColors[name] || COLORS[idx % COLORS.length];

    const series = [];
    let labels = [...data.labels];
    let sortedIndices = labels.map((_, i) => i);
    const datePart = data._datePart;

    // Sort labels by total values
    if (sortOrder !== 'none') {
      const rawS = data.series && data.series.length > 0 ? data.series : null;
      const totals = labels.map((_, i) => {
        if (rawS) {
          let total = 0;
          for (const s of rawS) total += (s.values[i] || 0);
          return total;
        }
        return data.values?.[i] || 0;
      });
      sortedIndices.sort((a, b) => sortOrder === 'desc' ? totals[b] - totals[a] : totals[a] - totals[b]);
      labels = sortedIndices.map((i) => labels[i]);
    } else if (datePart) {
      // Auto-sort chronologically for date dimensions
      const { labels: sorted, indices } = sortDateLabels(labels, null, datePart);
      sortedIndices = indices.map((i) => sortedIndices[i]);
      labels = sorted;
    }

    // Keep raw labels for cross-filter, format display labels separately
    const rawLabels = [...labels];
    if (datePart) {
      labels = labels.map((l) => formatDateLabel(l, datePart));
    }

    let rawSeries = data.series && data.series.length > 0 ? [...data.series] : null;
    if (rawSeries && hideZeros) {
      rawSeries = rawSeries.filter((s) => s.values.some((v) => v !== 0 && v != null));
    }
    const hasSeries = rawSeries && rawSeries.length > 0;
    const allSeriesForLegend = hasSeries ? rawSeries : null;
    const visibleSeries = hasSeries ? rawSeries.filter((s) => !hiddenSeries.has(s.name)) : null;

    const labelOpts = {
      show: showDataLabels, position: dataLabelPosition, fontSize: config?.dataLabelFontSize ?? 10,
      rotate: dataLabelRotate, color: dataLabelColor,
      align: dataLabelRotate > 0 ? 'left' : dataLabelRotate < 0 ? 'right' : 'center',
      verticalAlign: Math.abs(dataLabelRotate) === 90 ? 'middle' : dataLabelPosition === 'top' ? 'bottom' : 'middle',
      backgroundColor: dataLabelBgOpacity > 0 ? hexToRgba(dataLabelBgColor, dataLabelBgOpacity) : 'transparent',
      padding: dataLabelBgOpacity > 0 ? [2, 4] : 0, borderRadius: 2,
    };

    if (visibleSeries && visibleSeries.length > 0) {
      visibleSeries.forEach((s, i) => {
        const origIdx = allSeriesForLegend ? allSeriesForLegend.findIndex((o) => o.name === s.name) : i;
        const colorIdx = origIdx >= 0 ? origIdx : i;
        let values = sortedIndices.map((idx) => s.values[idx] || 0);
        if (subType === 'stackedArea100') {
          values = values.map((val, vi) => {
            let total = 0;
            for (const sr of visibleSeries) total += (sr.values[vi] || 0);
            return total > 0 ? Math.round(((val || 0) / total) * 10000) / 100 : 0;
          });
        }
        series.push({
          type: 'line', name: s.name || `Series ${i + 1}`, data: values,
          smooth: config?.smooth ?? true,
          symbol: config?.lineSymbol ?? 'circle',
          symbolSize: config?.lineSymbolSize ?? 6,
          showSymbol: (config?.lineSymbol ?? 'circle') !== 'none',
          lineStyle: { color: getColor(s.name, colorIdx) },
          itemStyle: { color: getColor(s.name, colorIdx) },
          areaStyle: isArea ? { opacity: isStacked ? 0.7 : 0.15, color: getColor(s.name, colorIdx) } : undefined,
          stack: isStacked ? 'total' : undefined,
          label: { ...labelOpts, formatter: (p) => {
            if (hideZeros && (p.value == null || p.value === 0)) return '';
            return buildDataLabel(p, dataLabelContent, dataLabelAbbr, data._measureFormats?.[p.seriesName]);
          }},
        });
      });
    } else if (!hasSeries) {
      series.push({
        type: 'line', data: sortedIndices.map((i) => data.values[i] || 0), smooth: config?.smooth ?? true,
        symbol: config?.lineSymbol ?? 'circle',
        symbolSize: config?.lineSymbolSize ?? 6,
        showSymbol: (config?.lineSymbol ?? 'circle') !== 'none',
        lineStyle: { color: config?.color || '#5470c6' },
        itemStyle: { color: config?.color || '#5470c6' },
        areaStyle: isArea ? { opacity: isStacked ? 0.7 : 0.15 } : undefined,
        label: { ...labelOpts, formatter: (p) => {
          if (hideZeros && (p.value == null || p.value === 0)) return '';
          return buildDataLabel(p, dataLabelContent, dataLabelAbbr, Object.values(data._measureFormats || {})[0]);
        }},
      });
    }

    const showXTitle = config?.showXAxisTitle ?? true;
    const showYTitle = config?.showYAxisTitle ?? true;
    const xTitle = showXTitle ? ((config?.xAxisTitle ?? '') || (data._dimLabel || '')) : '';
    const yTitle = showYTitle ? ((config?.yAxisTitle ?? '') || (data._measureLabel || '')) : '';
    const xNameCfg = xTitle ? { name: xTitle, nameLocation: 'center', nameGap: 28, nameTextStyle: { fontSize: (config?.xAxisLabelFontSize ?? 11) + 1, color: config?.xAxisLabelColor || '#64748b', fontWeight: 500 } } : {};
    const yNameCfg = yTitle ? { name: yTitle, nameLocation: 'center', nameGap: 40, nameTextStyle: { fontSize: (config?.yAxisLabelFontSize ?? 11) + 1, color: config?.yAxisLabelColor || '#64748b', fontWeight: 500 } } : {};
    const xTitleExtra = xTitle ? 18 : 0;
    const yTitleExtra = yTitle ? 20 : 0;

    const opt = {
      tooltip: {
        trigger: 'axis',
        appendToBody: true,
        formatter: (params) => {
          let result = `<b>${params[0]?.axisValue}</b><br/>`;
          params.forEach((p) => {
            if (hideZeros && (p.value === 0 || p.value == null)) return;
            const fmt = data._measureFormats?.[p.seriesName] || null;
            result += `${p.marker} ${p.seriesName}: <b>${formatNumber(p.value, fmt)}</b><br/>`;
          });
          return result;
        },
      },
      legend: { show: false },
      xAxis: {
        type: 'category', data: labels, show: showXAxis,
        ...xNameCfg,
        axisLabel: {
          show: showLabels, rotate: calcLabelRotation(labels, w),
          fontSize: config?.xAxisLabelFontSize ?? 11,
          color: config?.xAxisLabelColor || '#64748b',
        },
      },
      yAxis: {
        type: 'value', show: showYAxis,
        ...yNameCfg,
        axisLabel: {
          show: showLabels,
          fontSize: config?.yAxisLabelFontSize ?? 11,
          color: config?.yAxisLabelColor || '#64748b',
          formatter: (val) => {
            const abbr = abbreviateNumber(val, valueAbbr);
            if (abbr != null) return abbr;
            const firstFmt = Object.values(data._measureFormats || {})[0];
            return firstFmt ? formatNumber(val, firstFmt) : val.toLocaleString();
          },
        },
        max: subType === 'stackedArea100' ? 100 : undefined,
        interval: yAxisInterval || undefined,
        splitLine: { lineStyle: { type: gridLineStyle, width: gridLineWidth } },
      },
      series,
      grid: {
        top: 15,
        right: 20,
        bottom: (showXAxis ? calcBottomMargin(calcLabelRotation(labels, w), labels) : 15) + xTitleExtra,
        left: (showYAxis ? 50 : 15) + yTitleExtra,
      },
    };

    const hl = highlightValue;
    opt.series.forEach((s) => {
      s.emphasis = { disabled: true };
      if (s.data) {
        s.data = s.data.map((val, i) => {
          const v = typeof val === 'object' && val !== null ? val.value ?? val : val;
          const o = hl && rawLabels ? (rawLabels[i] === hl ? 1 : 0.3) : 1;
          return { value: v, itemStyle: { opacity: o } };
        });
      }
    });

    const legendItems = (allSeriesForLegend || []).map((s, i) => ({ name: s.name, color: getColor(s.name, i) }));
    return { option: opt, legendItems, rawLabels };
  }, [data, subType, showLabels, showLegend, legendPosition, hasData, config?.smooth, config?.color, isArea, isStacked, hideZeros, sortOrder,
      showXAxis, showYAxis, gridLineStyle, gridLineWidth, yAxisInterval, valueAbbr, showDataLabels, dataLabelContent,
      dataLabelAbbr, dataLabelPosition, dataLabelRotate, dataLabelColor, dataLabelBgColor, dataLabelBgOpacity, hiddenSeries, highlightValue, config?.legendColors,
      config?.lineSymbol, config?.lineSymbolSize,
      config?.xAxisLabelFontSize, config?.xAxisLabelColor, config?.yAxisLabelFontSize, config?.yAxisLabelColor,
      config?.xAxisTitle, config?.yAxisTitle, config?.showXAxisTitle, config?.showYAxisTitle]);

  const option = memoResult?.option;
  const legendItems = memoResult?.legendItems || [];

  // Dispose and recreate when legend layout changes
  useEffect(() => {
    instanceRef.current?.dispose();
    instanceRef.current = null;
    prevSizeRef.current = { w: 0, h: 0 };
  }, [showLegend, legendPosition]);

  const onDataClickRef = useRef(onDataClick);
  onDataClickRef.current = onDataClick;
  const dimNameRef = useRef(data?._dimName);
  dimNameRef.current = data?._dimName;
  const rawLabelsRef = useRef(memoResult?.rawLabels);
  rawLabelsRef.current = memoResult?.rawLabels;

  useEffect(() => {
    const el = chartRef.current;
    if (!el || !option) return;

    if (instanceRef.current && instanceRef.current.getDom() !== el) {
      instanceRef.current.dispose();
      instanceRef.current = null;
      prevSizeRef.current = { w: 0, h: 0 };
    }

    const render = () => {
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      if (cw < 10 || ch < 10) return;

      if (!instanceRef.current) {
        instanceRef.current = echarts.init(el, null, { width: cw, height: ch });
        instanceRef.current.on('click', (params) => {
          const rawLabels = rawLabelsRef.current;
          const rawValue = (params.dataIndex != null && rawLabels) ? rawLabels[params.dataIndex] : params.name;
          if (rawValue != null && onDataClickRef.current) {
            onDataClickRef.current(dimNameRef.current || 'dimension', String(rawValue));
          }
        });
      } else if (prevSizeRef.current.w !== cw || prevSizeRef.current.h !== ch) {
        instanceRef.current.resize({ width: cw, height: ch });
      }
      prevSizeRef.current = { w: cw, h: ch };
      instanceRef.current.setOption(option, true);
    };

    const timer = requestAnimationFrame(render);
    const ro = new ResizeObserver(render);
    ro.observe(el);
    return () => { cancelAnimationFrame(timer); ro.disconnect(); };
  }, [option, showLegend, legendPosition]);

  useEffect(() => () => { instanceRef.current?.dispose(); instanceRef.current = null; }, []);

  if (!hasData) {
    if (data?._rowCount === 0) {
      if (config?.hideEmptyMessage) return <div style={emptyStyle} />;
      return <div style={emptyStyle}>{config?.emptyMessage || 'No values'}</div>;
    }
    return <div style={emptyStyle}>Select dimensions & measures to display a line chart</div>;
  }

  const showHtmlLegend = showLegend && legendItems.length > 0;
  const flexDir = legendPosition === 'left' || legendPosition === 'right' ? 'row' : 'column';

  return (
    <div style={{ display: 'flex', flexDirection: flexDir, width: '100%', height: '100%' }}>
      {showHtmlLegend && (legendPosition === 'top' || legendPosition === 'left') && (
        <ChartLegend items={legendItems} position={legendPosition} onToggle={toggleSeries} hiddenSeries={hiddenSeries} />
      )}
      <div ref={chartRef} style={{ flex: 1, minWidth: 0, minHeight: 0 }} />
      {showHtmlLegend && (legendPosition === 'bottom' || legendPosition === 'right') && (
        <ChartLegend items={legendItems} position={legendPosition} onToggle={toggleSeries} hiddenSeries={hiddenSeries} />
      )}
    </div>
  );
});

const emptyStyle = {
  height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: '#94a3b8', fontSize: 12, textAlign: 'center', padding: 16,
};
