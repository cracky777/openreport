import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';

// Shared ECharts lifecycle for every chart widget. Six widgets used to
// repeat ~50 lines of identical plumbing — refs (chart container,
// instance, last-known size), a dispose-on-X useEffect (X = the widget's
// legend layout for most, no-op for TreeMap which has no legend), the
// main render useEffect (init or resize, setOption, ResizeObserver
// loop), and a final dispose-on-unmount useEffect. The only per-widget
// variation was the click handler attached after init — Bar resolves
// raw labels through a ref, Pie/TreeMap skip the synthetic "Others"
// slice, Scatter pulls the label off `params.data._rawLabel`, etc.
//
// API:
//   const chartRef = useEchartsInstance({
//     option,                       // ECharts option, null = skip render
//     onInit: (instance) => {       // called ONCE per chart-instance lifetime
//       instance.on('click', ...);  // widget-specific click logic goes here
//     },
//     recreateDeps: [showLegend, legendPosition],  // dispose+re-init when any of these changes
//   });
//   return <div ref={chartRef} style={{ width: '100%', height: '100%' }} />;
//
// `onInit` is stashed in a ref so passing a fresh closure on every render
// doesn't churn the effect; only `option` + the explicit `recreateDeps`
// drive re-runs.
//
// Internal guards preserved verbatim from the per-widget copies:
//   - skip render when the container is <10px in either dim (ECharts
//     fails on zero-sized canvases — happens during animated layout
//     transitions before the parent settles).
//   - dispose+recreate when the container element identity has changed
//     under us (React can swap the underlying div on parent re-arrangements).
//   - resize before setOption when the container dims changed (so the
//     new option lays out against the new size, no flash).
export function useEchartsInstance({ option, onInit, recreateDeps = [] }) {
  const chartRef = useRef(null);
  const instanceRef = useRef(null);
  const prevSizeRef = useRef({ w: 0, h: 0 });
  const onInitRef = useRef(onInit);
  onInitRef.current = onInit;

  // Dispose-and-recreate when the recreate deps change. For most widgets
  // this is `[showLegend, legendPosition]` — swapping the HTML legend's
  // position changes the ECharts canvas's parent layout, and re-init
  // gives us a fresh measurement.
  useEffect(() => {
    instanceRef.current?.dispose();
    instanceRef.current = null;
    prevSizeRef.current = { w: 0, h: 0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, recreateDeps);

  // Main render. Init on first attach (calls onInit once, which is where
  // the widget hooks its click handler), resize if the container grew/
  // shrunk between renders, setOption on every render of `option`.
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
        if (onInitRef.current) onInitRef.current(instanceRef.current);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [option, ...recreateDeps]);

  // Unmount cleanup so the file lock / canvas memory is released.
  useEffect(() => () => { instanceRef.current?.dispose(); instanceRef.current = null; }, []);

  return chartRef;
}
