import { useRef, useEffect, memo, useMemo, useState, useCallback } from 'react';
import * as echarts from 'echarts';
import formatNumber, { abbreviateNumber } from '../../utils/formatNumber';
import ChartLegend from './ChartLegend';
import { useStableColorOrder } from '../../hooks/useStableColorOrder';
import { lerpColor } from '../../utils/tableConfigHelpers';

const COLORS = [
  '#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de',
  '#3ba272', '#fc8452', '#9a60b4', '#ea7ccc', '#5ab1ef',
];

function hexToRgba(hex, opacity) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${opacity / 100})`;
}

export default memo(function PieWidget({ data, config, chartWidth, chartHeight, onDataClick, highlightValue }) {
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
  const sortOrder = config?.sortOrder || 'none';
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
      let gMin = Infinity, gMax = -Infinity;
      for (const it of data.items) if (it?.value != null && !isNaN(it.value)) { if (it.value < gMin) gMin = it.value; if (it.value > gMax) gMax = it.value; }
      const minColor = gradient.minColor || '#dcfce7';
      const maxColor = gradient.maxColor || '#7c3aed';
      getValueColor = (val) => {
        if (val == null || isNaN(val) || gMin === Infinity) return minColor;
        const pct = gMax > gMin ? Math.max(0, Math.min(1, (val - gMin) / (gMax - gMin))) : 0;
        return lerpColor(minColor, maxColor, pct);
      };
    }

    const buildLabel = (params) => {
      const val = abbreviateNumber(params.value, dataLabelAbbr) ?? formatNumber(params.value, fmt);
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
    }

    const opt = {
      tooltip: {
        trigger: 'item',
        appendToBody: true,
        formatter: (params) => `${params.marker} ${params.name}: <b>${formatNumber(params.value, fmt)}</b> (${params.percent}%)`,
      },
      legend: { show: false },
      series: [{
        type: 'pie',
        radius: config?.donut ? ['30%', '65%'] : '65%',
        center: ['50%', '50%'],
        data: visibleItems.map((it) => {
          const colorIdx = data.items.findIndex((orig) => orig.name === it.name);
          return {
            ...it,
            itemStyle: {
              ...it.itemStyle,
              color: useGradient ? getValueColor(it.value) : getColor(it.name, colorIdx >= 0 ? colorIdx : 0),
              opacity: highlightValue ? (it.name === highlightValue ? 1 : 0.3) : 1,
            },
          };
        }),
        emphasis: { disabled: true },
        label: {
          show: showDataLabels,
          position: config?.dataLabelPosition || 'outside',
          fontSize: config?.dataLabelFontSize ?? 12,
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

    const legendItems = data.items.map((item, i) => ({ name: item.name, color: getColor(item.name, i) }));
    return { option: opt, legendItems };
  }, [data, hasData, showLegend, legendPosition, config?.donut, showDataLabels, dataLabelContent,
      dataLabelAbbr, dataLabelRotate, dataLabelColor, dataLabelBgColor, dataLabelBgOpacity, hiddenSeries, sortOrder, highlightValue, config?.legendColors, config?.dataLabelPosition,
      config?.valueGradient?.enabled, config?.valueGradient?.minColor, config?.valueGradient?.maxColor]);

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
          if (params.name && onDataClickRef.current) {
            onDataClickRef.current(dimNameRef.current || 'dimension', params.name);
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
    return <div style={emptyStyle}>Select dimensions & measures to display a pie chart</div>;
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
  color: 'var(--text-disabled)', fontSize: 12, textAlign: 'center', padding: 16,
};
