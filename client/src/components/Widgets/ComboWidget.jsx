import { useRef, useEffect, memo, useMemo, useState, useCallback } from 'react';
import * as echarts from 'echarts';
import formatNumber, { abbreviateNumber } from '../../utils/formatNumber';
import ChartLegend from './ChartLegend';
import { sortDateLabels, formatDateLabel } from '../../utils/dateHelpers';

const COLORS = [
  '#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de',
  '#3ba272', '#fc8452', '#9a60b4', '#ea7ccc', '#5ab1ef',
  '#d87a80', '#8d98b3', '#e5cf0d', '#97b552', '#95706d',
];

function hexToRgba(hex, opacity) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${opacity / 100})`;
}

export default memo(function ComboWidget({ data, config, chartWidth, chartHeight, onDataClick, highlightValue }) {
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
  const valueAbbr = config?.valueAbbreviation || 'none';
  const hideZeros = config?.hideZeros ?? false;
  const gridLineStyle = config?.gridLineStyle || 'solid';
  const gridLineWidth = config?.gridLineWidth ?? 1;
  const showSecondaryAxis = config?.showSecondaryAxis ?? false;
  const smoothLine = config?.smooth ?? true;

  const memoResult = useMemo(() => {
    if (!hasData) return { option: null, legendItems: [] };

    const customColors = config?.legendColors || {};
    // Assign stable colors: bars get indices 0..N, lines get indices from N onward
    const allBarNames = (data.barSeries || []).map((s) => s.name);
    const allLineNames = (data.lineSeries || []).map((s) => s.name);
    const colorMap = {};
    allBarNames.forEach((n, i) => { colorMap[n] = customColors[n] || COLORS[i % COLORS.length]; });
    allLineNames.forEach((n, i) => { colorMap[n] = customColors[n] || COLORS[(allBarNames.length + i) % COLORS.length]; });
    const getColor = (name) => colorMap[name] || COLORS[0];

    let labels = [...data.labels];
    const datePart = data._datePart;
    const rawLabels = [...labels];

    if (datePart) {
      labels = labels.map((l) => formatDateLabel(l, datePart));
    }

    const series = [];
    const allLegendItems = [];
    let customYMax = undefined;

    // Bar series
    const barSeries = (data.barSeries || []).filter((s) => !hiddenSeries.has(s.name));

    if (!isStacked && barSeries.length > 1) {
      // Clustered combo: use custom renderItem for dynamic bar widths (like BarWidget)
      customYMax = 0;
      for (const s of barSeries) for (const v of s.values) if (v > customYMax) customYMax = v;

      const nonZeroCounts = labels.map((_, li) => {
        let count = 0;
        for (const s of barSeries) if ((s.values[li] || 0) !== 0) count++;
        return Math.max(count, 1);
      });
      const seriesNonZeroIndex = barSeries.map((s, si) => {
        return labels.map((_, li) => {
          if ((s.values[li] || 0) === 0) return -1;
          let idx = 0;
          for (let j = 0; j < si; j++) if ((barSeries[j].values[li] || 0) !== 0) idx++;
          return idx;
        });
      });

      barSeries.forEach((s, i) => {
        const color = getColor(s.name);
        allLegendItems.push({ name: s.name, color });
        const nzCounts = nonZeroCounts;
        const nzIndices = seriesNonZeroIndex[i];

        series.push({
          type: 'custom',
          name: s.name,
          data: s.values.map((v, ci) => [ci, v]),
          itemStyle: { color },
          emphasis: { disabled: true },
          renderItem: (params, api) => {
            const catIdx = api.value(0);
            const value = api.value(1);
            if (value === 0) return null;
            const nzCount = nzCounts[catIdx];
            const nzIdx = nzIndices[catIdx];
            if (nzIdx < 0) return null;
            const bandWidth = api.size([1, 0])[0];
            const groupPad = 0.15;
            const barGap = nzCount > 1 ? 0.08 : 0;
            const groupWidth = bandWidth * (1 - groupPad * 2);
            const slotWidth = groupWidth / nzCount;
            const barWidth = slotWidth * (1 - barGap);
            const base = api.coord([catIdx, 0]);
            const top = api.coord([catIdx, value]);
            const x = base[0] - bandWidth / 2 + bandWidth * groupPad + slotWidth * nzIdx + (slotWidth - barWidth) / 2;
            const dimmed = highlightValue && rawLabels[catIdx] !== highlightValue;
            return {
              type: 'rect',
              shape: { x, y: top[1], width: barWidth, height: base[1] - top[1] },
              style: { ...api.style(), fill: color, opacity: dimmed ? 0.3 : 1 },
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
          data: s.values,
          stack: isStacked ? 'bar' : undefined,
          itemStyle: { color },
          emphasis: { disabled: true },
          label: {
            show: showDataLabels, position: 'top', fontSize: dataLabelFontSize, color: dataLabelColor,
            formatter: (p) => {
              if (hideZeros && (p.value === 0 || p.value == null)) return '';
              return abbreviateNumber(p.value, valueAbbr) ?? formatNumber(p.value);
            },
          },
        });
      });
    }

    // Line series
    const lineSeries = (data.lineSeries || []).filter((s) => !hiddenSeries.has(s.name));
    lineSeries.forEach((s) => {
      const color = getColor(s.name);
      allLegendItems.push({ name: s.name, color });
      series.push({
        type: 'line',
        name: s.name,
        data: s.values,
        yAxisIndex: showSecondaryAxis ? 1 : 0,
        smooth: smoothLine,
        lineStyle: { color, width: 2 },
        itemStyle: { color },
        symbol: 'circle',
        symbolSize: 6,
        emphasis: { disabled: true },
        label: {
          show: showDataLabels, position: 'top', fontSize: dataLabelFontSize, color: dataLabelColor,
          formatter: (p) => {
            if (hideZeros && (p.value === 0 || p.value == null)) return '';
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
            const v = typeof val === 'object' ? val?.value ?? val : val;
            const o = rawLabels[i] === hl ? 1 : 0.3;
            return { value: v, itemStyle: { opacity: o } };
          });
        }
      });
    }

    const yAxes = [{
      type: 'value', show: showYAxis,
      max: customYMax ? Math.ceil(customYMax * 1.1) : undefined,
      axisLabel: { formatter: (v) => abbreviateNumber(v, valueAbbr) ?? formatNumber(v) },
      splitLine: { lineStyle: { type: gridLineStyle, width: gridLineWidth } },
    }];
    if (showSecondaryAxis) {
      yAxes.push({
        type: 'value', show: showYAxis, position: 'right',
        axisLabel: { formatter: (v) => abbreviateNumber(v, valueAbbr) ?? formatNumber(v) },
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
            result += `${p.marker} ${p.seriesName}: <b>${formatNumber(val)}</b><br/>`;
          });
          return result;
        },
      },
      legend: { show: false },
    };

    const barDir = config?.barDirection || 'vertical';
    const isHoriz = barDir === 'horizontal' || barDir === 'horizontalInverse';
    const isInverse = barDir === 'verticalInverse' || barDir === 'horizontalInverse';

    const categoryAxis = {
      type: 'category', data: labels, show: showXAxis,
      axisLabel: { show: true, rotate: !isHoriz && labels.length > 8 ? 30 : 0 },
      position: barDir === 'verticalInverse' ? 'top' : barDir === 'horizontalInverse' ? 'right' : undefined,
      inverse: barDir === 'horizontalInverse',
    };

    if (isHoriz) {
      yAxes.forEach((a) => { a.inverse = barDir === 'horizontalInverse'; a.position = barDir === 'horizontalInverse' ? 'right' : undefined; });
      opt.xAxis = yAxes;
      opt.yAxis = categoryAxis;
    } else {
      yAxes.forEach((a) => { a.inverse = barDir === 'verticalInverse'; });
      opt.xAxis = categoryAxis;
      opt.yAxis = yAxes;
    }

    opt.series = series;
    const topPad = barDir === 'verticalInverse' ? 40 : 20;
    opt.grid = { top: topPad, right: barDir === 'horizontalInverse' ? 80 : (showSecondaryAxis ? 50 : 20), bottom: barDir === 'verticalInverse' ? 15 : (showXAxis ? 40 : 15), left: barDir === 'horizontalInverse' ? 15 : (isHoriz ? 80 : (showYAxis ? 50 : 15)) };

    // Build legend items using stable color map
    const legendItems = [...allBarNames, ...allLineNames].map((name) => ({ name, color: colorMap[name] }));

    return { option: opt, legendItems, rawLabels };
  }, [data, hasData, isStacked, showXAxis, showYAxis, showDataLabels, dataLabelFontSize, dataLabelColor,
      valueAbbr, hideZeros, showLegend, legendPosition, gridLineStyle, gridLineWidth,
      showSecondaryAxis, smoothLine, hiddenSeries, highlightValue, config?.legendColors, config?.barDirection]);

  const option = memoResult?.option;
  const legendItems = memoResult?.legendItems || [];

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
    return <div style={emptyStyle}>Drop measures in Bar Values and Line Values</div>;
  }

  const isLR = legendPosition === 'left' || legendPosition === 'right';

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: isLR ? 'row' : 'column' }}>
      {showLegend && legendItems.length > 0 && (legendPosition === 'top' || legendPosition === 'left') && (
        <ChartLegend items={legendItems} position={legendPosition} hiddenSeries={hiddenSeries} onToggle={toggleSeries} />
      )}
      <div ref={chartRef} style={{ flex: 1, minHeight: 0, minWidth: 0 }} />
      {showLegend && legendItems.length > 0 && (legendPosition === 'bottom' || legendPosition === 'right') && (
        <ChartLegend items={legendItems} position={legendPosition} hiddenSeries={hiddenSeries} onToggle={toggleSeries} />
      )}
    </div>
  );
});

const emptyStyle = {
  height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: '#94a3b8', fontSize: 12, textAlign: 'center', padding: 16,
};
