import { createContext, useContext } from 'react';

// The context object lives in its own module, apart from the provider
// component. A file that exports both gets re-evaluated by Fast Refresh on
// every edit, which mints a *new* context while the mounted provider still
// holds the old one — and every consumer then throws "must be used inside a
// GraphProvider" until a full reload. Keeping the identity here makes provider
// edits hot-reloadable.
export const GraphContext = createContext(null);

export function useGraph() {
  const ctx = useContext(GraphContext);
  if (!ctx) throw new Error('useGraph must be used inside a GraphProvider');
  return ctx;
}
