import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import BugReportDialog from './BugReportDialog';

/**
 * One dialog for the whole application, opened from anywhere.
 *
 * The first version mounted the dialog inside AppShell, which covers only the
 * Sources → Models → Reports journey: the report editor and the model editor
 * carry their own chrome, so a user could not report a bug from either — that
 * is, from the two screens where the work actually happens.
 *
 * Mounting it once in the root layout separates the two questions. WHERE the
 * entry point sits is each chrome's own decision — a menu item here, an icon
 * button there — while WHAT it opens, and what leaves the instance, is decided
 * in one place.
 *
 * Callers pass the context they are the only ones to know: the error the widget
 * hit, the model being edited, the page. Whatever is passed is shown to the
 * user before anything is sent.
 */
const BugReportContext = createContext(null);

export function BugReportProvider({ children }) {
  const [context, setContext] = useState(null);

  // `openBugReport()` sans argument reste valable : le formulaire s'ouvre alors
  // avec le seul contexte que l'on puisse toujours déduire, la page courante.
  const openBugReport = useCallback((extra = {}) => {
    setContext({
      Page: typeof window !== 'undefined' ? window.location.pathname : '',
      ...extra,
    });
  }, []);

  const value = useMemo(() => ({ openBugReport }), [openBugReport]);

  return (
    <BugReportContext.Provider value={value}>
      {children}
      {context && <BugReportDialog context={context} onClose={() => setContext(null)} />}
    </BugReportContext.Provider>
  );
}

// Rend une fonction inerte hors du fournisseur plutôt que de lever : un écran
// monté seul dans un test ne doit pas tomber pour un bouton secondaire.
export function useBugReport() {
  const ctx = useContext(BugReportContext);
  return ctx ? ctx.openBugReport : NOOP;
}

const NOOP = () => {};
