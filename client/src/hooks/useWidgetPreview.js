import { useEffect, useState } from 'react';
import api from '../utils/api';
import { buildWidgetQueryPayload } from '../utils/widgetQueryPayload';
import { buildWidgetData } from '../utils/widgetDataBuilder';

const PREVIEW_ROW_LIMIT = 200;

/**
 * Data for a widget that is not on the page yet, fetched the way the canvas
 * would fetch it once added: same payload builder, same /query, the author's
 * own session. The rows go to the chart and nowhere else — the assistant never
 * sees them, its own reads stay cache-only on the server.
 *
 * Page slicers and cross-filters are left out on purpose: the preview answers
 * "what does this visual show", not "what does it show under the selection I
 * happen to have".
 *
 * @returns {{ data: object|null, loading: boolean, error: string|null }}
 */
export function useWidgetPreview(widget, { model, reportId, settings, enabled = true }) {
  const [state, setState] = useState({ data: null, loading: enabled, error: null });
  // Only the fields that shape the query: a theme change must not refetch.
  const { extraDimensions, extraMeasures, dimensionOverrides, measureOverrides } = settings || {};

  useEffect(() => {
    if (!enabled || !model?.id) return undefined;
    const controller = new AbortController();
    const capped = { ...widget, config: { ...widget.config, dataLimit: Math.min(widget.config?.dataLimit || PREVIEW_ROW_LIMIT, PREVIEW_ROW_LIMIT) } };
    const { meta, bodies } = buildWidgetQueryPayload(capped, 'ai-preview', {
      effectiveModel: model,
      reportFilters: {},
      reportId,
      reportLevelFilters: [],
      reportExtras: {
        extraDimensions: extraDimensions || [],
        extraMeasures: extraMeasures || [],
        dimensionOverrides: dimensionOverrides || {},
        measureOverrides: measureOverrides || {},
      },
      bypassCache: false,
      filterWidgetMode: 'distinct',
      dedupMeasures: true,
    });
    const post = (body) => api.post(`/models/${model.id}/query`, body, { signal: controller.signal });
    const optional = (body) => (body ? post(body).catch(() => null) : Promise.resolve(null));
    const main = bodies.main ? post(bodies.main) : Promise.reject(new Error('Nothing to query'));

    Promise.all([main, optional(bodies.color), optional(bodies.total), optional(bodies.n1), optional(bodies.comboLine)])
      .then(([res, colorRes, totalRes, n1Res, comboLineRes]) => {
        const data = buildWidgetData({
          widget: capped, rows: res.data?.rows, meta, effectiveModel: model,
          colorRes, totalRes, n1Res, comboLineRes,
          totalComponents: res.data?.totalComponents || null,
          sql: null,
        });
        setState({ data, loading: false, error: null });
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setState({ data: null, loading: false, error: err?.response?.data?.error || err?.message || 'Query failed' });
      });

    return () => controller.abort();
    // The proposal is immutable once received: its identity is the dependency.
  }, [widget, model, reportId, extraDimensions, extraMeasures, dimensionOverrides, measureOverrides, enabled]);

  return state;
}
