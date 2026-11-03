import { useEffect, useMemo, useRef, useState, memo } from 'react';
import formatNumber, { abbreviateNumber } from '../../utils/formatNumber';
import { formatDuration, isDurationCol } from '../../utils/formatHuman';
import { paletteOf, CHART_COLORS_BASIC as COLORS, tintOf, hexToRgba } from '../../utils/chartPalette';
import { useChartFonts } from '../../hooks/useChartFonts';
import { useChartTheme } from '../../hooks/useChartTheme';
import { useEchartsInstance } from '../../hooks/useEchartsInstance';
import { resolveArea, mapNameOf, normalizePlace, MAP_AREAS } from '../../utils/geo';
import WidgetEmptyState from './WidgetEmptyState';

const _box = { display: 'flex', flexDirection: 'column', width: '100%', height: '100%' };
const _chart = { flex: 1, minWidth: 0, minHeight: 0 };
const _note = { fontSize: 11, color: 'var(--text-secondary)', padding: '2px 8px 4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
const _wait = { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: 12, color: 'var(--text-secondary)' };

// A measure by place: regions, départements or countries coloured by value,
// or towns drawn as bubbles. The place column is matched by name against the
// map the author chose (`mapArea`), or the one that knows its values best.
export default memo(function MapWidget({ data, config, onDataClick, highlightValue }) {
  const items = useMemo(() => data?.items || [], [data?.items]);
  const hasData = items.length > 0;
  const [loaded, setLoaded] = useState(null); // { area, index } | { error }
  const placeKey = items.map((it) => it.name).join('|');

  useEffect(() => {
    if (!hasData) return undefined;
    let live = true;
    resolveArea(config?.mapArea, items.map((it) => it.name))
      .then((l) => { if (live) setLoaded(l); })
      .catch((err) => { if (live) setLoaded({ error: err.message }); });
    return () => { live = false; };
    // The places, not the values, decide the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasData, placeKey, config?.mapArea]);

  const showLabels = config?.showDataLabels ?? false;
  const showScale = config?.showScale ?? true;
  const roam = config?.mapRoam ?? false;
  const { dataLabel: dataLabelFontFamily } = useChartFonts(config, ['dataLabel']);
  // Land without a value and borders on the card's own surface: pale on a
  // light report, dark on a dark one.
  const [chartTheme, themeRootRef] = useChartTheme();

  const built = useMemo(() => {
    if (!hasData || !loaded?.index) return null;
    const { area, index } = loaded;
    const kind = MAP_AREAS.find((a) => a.value === area)?.kind;
    const fmt = Object.values(data._measureFormats || {})[0];
    const isDur = isDurationCol(data._measureLabel, data._durationColumns);
    const write = (v) => (isDur && typeof v === 'number' ? formatDuration(v) : formatNumber(v, fmt));
    const writeLabel = (v) => abbreviateNumber(v, config?.dataLabelAbbr || 'none', fmt) ?? write(v);
    const high = config?.scaleColor || paletteOf(config, COLORS)[0];
    const low = config?.scaleLowColor || tintOf(high);
    const empty = config?.mapEmptyColor || chartTheme.track;
    const border = config?.mapBorderColor || chartTheme.panel;
    const dim = (name) => (highlightValue && name !== highlightValue ? 0.35 : 1);

    const placed = [];
    const missing = [];
    for (const it of items) {
      const hit = index.get(normalizePlace(it.name));
      if (hit) placed.push({ it, hit });
      else missing.push(it.name);
    }
    const values = placed.map((p) => Number(p.it.value) || 0);
    const min = values.length ? Math.min(...values) : 0;
    const max = values.length ? Math.max(...values) : 1;
    const label = {
      show: showLabels,
      fontSize: config?.dataLabelFontSize ?? 10,
      fontFamily: dataLabelFontFamily,
      color: config?.dataLabelColor || '#334155',
    };
    const tooltip = {
      trigger: 'item',
      appendToBody: true,
      formatter: (p) => (p.data ? `${p.data.place}: <b>${write(p.data.raw)}</b>` : p.name),
    };
    const visualMap = {
      show: showScale && values.length > 1, min, max: max === min ? min + 1 : max, calculable: false,
      orient: 'vertical', left: 6, bottom: 6, itemWidth: 10, itemHeight: 70,
      text: [writeLabel(max), writeLabel(min)], inRange: { color: [low, high] },
      textStyle: { fontSize: 10, color: '#64748b' },
    };

    if (kind === 'points') {
      const biggest = config?.mapBubbleMax ?? 28;
      const size = (v) => (max > 0 ? 4 + Math.sqrt(Math.max(0, v) / max) * (biggest - 4) : 6);
      return {
        missing,
        option: {
          tooltip,
          geo: { map: mapNameOf('fr-departements'), roam, silent: true, layoutCenter: ['50%', '50%'], layoutSize: '95%', itemStyle: { areaColor: empty, borderColor: border, borderWidth: 0.6 } },
          series: [{
            type: 'scatter', coordinateSystem: 'geo',
            data: placed.map(({ it, hit }) => ({
              name: hit.name, place: it.name, raw: it.value,
              value: [...hit.coord, Number(it.value) || 0],
              itemStyle: { color: hexToRgba(high, 75), opacity: dim(it.name), borderColor: border, borderWidth: 1 },
            })),
            symbolSize: (v) => size(v[2]),
            label: { ...label, position: 'right', formatter: (p) => `${p.data.place} ${writeLabel(p.data.raw)}` },
            emphasis: { scale: 1.15 },
          }],
        },
      };
    }
    return {
      missing,
      option: {
        tooltip,
        visualMap,
        series: [{
          type: 'map', map: mapNameOf(area), roam, layoutCenter: ['50%', '50%'], layoutSize: '100%',
          itemStyle: { areaColor: empty, borderColor: border, borderWidth: 0.8 },
          emphasis: { label: { show: true }, itemStyle: { areaColor: high, opacity: 0.85 } },
          select: { disabled: true },
          label: { ...label, formatter: (p) => (p.data ? writeLabel(p.data.raw) : '') },
          data: placed.map(({ it, hit }) => ({ name: hit, place: it.name, raw: it.value, value: Number(it.value) || 0, itemStyle: { opacity: dim(it.name) } })),
        }],
      },
    };
  }, [hasData, loaded, items, data, config, showLabels, showScale, roam, dataLabelFontFamily, highlightValue, chartTheme]);

  const onDataClickRef = useRef(onDataClick);
  onDataClickRef.current = onDataClick;
  const dimNameRef = useRef(data?._dimName);
  dimNameRef.current = data?._dimName;
  const chartRef = useEchartsInstance({
    option: built?.option || null,
    onInit: (instance) => {
      instance.on('click', (params) => {
        const place = params.data?.place;
        if (place && onDataClickRef.current) onDataClickRef.current(dimNameRef.current || 'dimension', place);
      });
    },
    recreateDeps: [loaded?.area],
  });

  if (!hasData) return <WidgetEmptyState data={data} config={config} unboundHint="Put a place (country, region, département or town) in Location and a measure in Value" />;
  // The theme is read while the map loads, so it is drawn in the right colors at once.
  if (loaded?.error) return <div ref={themeRootRef} style={_wait}>{loaded.error}</div>;
  if (!built) return <div ref={themeRootRef} style={_wait}>Loading the map…</div>;
  const { missing } = built;
  return (
    <div ref={themeRootRef} style={_box}>
      <div ref={chartRef} style={_chart} />
      {missing.length > 0 && (
        <div style={_note} title={missing.join(', ')}>
          Not on the map: {missing.slice(0, 4).join(', ')}{missing.length > 4 ? ` +${missing.length - 4}` : ''}
        </div>
      )}
    </div>
  );
});
