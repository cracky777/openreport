import { useRef, useEffect, memo, useMemo } from 'react';
import * as echarts from 'echarts';
import formatNumber, { abbreviateNumber } from '../../utils/formatNumber';
import { useStableColorOrder } from '../../hooks/useStableColorOrder';

const COLORS = [
  '#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de',
  '#3ba272', '#fc8452', '#9a60b4', '#ea7ccc', '#5ab1ef',
];

export default memo(function TreeMapWidget({ data, config, chartWidth, chartHeight, onDataClick, highlightValue }) {
  const chartRef = useRef(null);
  const instanceRef = useRef(null);
  const prevSizeRef = useRef({ w: 0, h: 0 });

  const hasData = data?.items?.length > 0;
  const showDataLabels = config?.showDataLabels ?? true;
  const dataLabelContent = config?.dataLabelContent || 'nameValue';
  const dataLabelAbbr = config?.dataLabelAbbr || 'none';
  const dataLabelColor = config?.dataLabelColor || '#ffffff';
  const dataLabelSize = config?.dataLabelFontSize || 12;
  const sortOrder = config?.sortOrder || 'desc';
  const showBorder = config?.showItemBorder ?? true;
  const borderColor = config?.itemBorderColor || '#ffffff';
  const borderWidth = config?.itemBorderWidth ?? 1;

  const allItemNames = useMemo(() => (data?.items || []).map((it) => it?.name).filter((n) => n != null), [data?.items]);
  const { getStableIdx } = useStableColorOrder(allItemNames.join('|'), allItemNames);

  const memoResult = useMemo(() => {
    if (!hasData) return { option: null };
    const fmt = Object.values(data._measureFormats || {})[0];
    const customColors = config?.legendColors || {};
    const getColor = (name) => customColors[name] || COLORS[getStableIdx(name) % COLORS.length];

    let items = [...data.items];
    if (sortOrder === 'desc') items.sort((a, b) => b.value - a.value);
    else if (sortOrder === 'asc') items.sort((a, b) => a.value - b.value);

    const buildLabel = (params) => {
      const val = abbreviateNumber(params.value, dataLabelAbbr) ?? formatNumber(params.value, fmt);
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
      itemStyle: {
        color: getColor(it.name, i),
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
          const v = formatNumber(params.value, fmt);
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
  }, [data, hasData, sortOrder, showDataLabels, dataLabelContent, dataLabelAbbr, dataLabelColor, dataLabelSize, showBorder, borderColor, borderWidth, highlightValue, config?.legendColors]);

  const option = memoResult?.option;

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
          if (params.data?.name && onDataClickRef.current) {
            onDataClickRef.current(dimNameRef.current || 'dimension', String(params.data.name));
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
  }, [option]);

  useEffect(() => () => { instanceRef.current?.dispose(); instanceRef.current = null; }, []);

  if (!hasData) {
    if (data?._rowCount === 0) {
      if (config?.hideEmptyMessage) return <div style={emptyStyle} />;
      return <div style={emptyStyle}>{config?.emptyMessage || 'No values'}</div>;
    }
    return <div style={emptyStyle}>Select a dimension & measure to display a treemap</div>;
  }

  return <div ref={chartRef} style={{ width: '100%', height: '100%' }} />;
});

const emptyStyle = {
  height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: '#94a3b8', fontSize: 12, textAlign: 'center', padding: 16,
};
