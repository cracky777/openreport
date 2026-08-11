import { useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useGraph } from './graphContext';

// A filter picks a branch of the journey, not a row in one column.
//
// Each stage used to narrow itself from its own query parameter, which left the
// others showing everything: standing on a single datasource, the Models column
// still listed all of them, so its join dove down to a model buried in the full
// list — then snapped to the top the moment the click landed and that column
// finally filtered. The relation hadn't changed; only the row under it had.
//
// One focus, resolved here, gives every column the same slice: the datasource,
// the models it feeds, and the reports built on those. The joins then link
// neighbours that are already in their final place, and crossing a stage moves
// nothing but the ribbon.
export function useJourneyFocus() {
  const { datasources, models, reports } = useGraph();
  const [searchParams, setSearchParams] = useSearchParams();
  const focus = searchParams.get('focus');

  const resolved = useMemo(() => {
    // "<stage>:<id>" — the stage says which end of the branch was picked, which
    // is what the crumb needs to say "showing" rather than "following".
    const sep = focus ? focus.indexOf(':') : -1;
    if (sep < 1) return NONE;
    const stage = focus.slice(0, sep);
    const id = focus.slice(sep + 1);

    if (stage === 'sources') {
      const ds = datasources.find((d) => d.id === id);
      if (!ds) return NONE;
      const modelIds = idSet(models.filter((m) => m.datasource_id === id));
      return {
        active: true, stage, id, label: ds.name,
        datasourceIds: new Set([id]),
        modelIds,
        reportIds: idSet(reports.filter((r) => modelIds.has(r.model_id))),
      };
    }

    if (stage === 'models') {
      const model = models.find((m) => m.id === id);
      if (!model) return NONE;
      return {
        active: true, stage, id, label: model.name,
        datasourceIds: new Set(model.datasource_id ? [model.datasource_id] : []),
        modelIds: new Set([id]),
        reportIds: idSet(reports.filter((r) => r.model_id === id)),
      };
    }

    return NONE;
  }, [focus, datasources, models, reports]);

  // A focus on something that no longer exists — a deleted model, a stale link
  // — resolves to NONE, so the journey opens up instead of showing three empty
  // columns. Dropping the parameter keeps the URL honest about that.
  const clear = useCallback(() => setSearchParams({}), [setSearchParams]);

  return { ...resolved, clear };
}

// Null sets, not empty ones: "no filter" and "a filter that matches nothing"
// are different answers, and only the second should empty a column.
const NONE = {
  active: false, stage: null, id: null, label: null,
  datasourceIds: null, modelIds: null, reportIds: null,
};

const idSet = (rows) => new Set(rows.map((r) => r.id));
