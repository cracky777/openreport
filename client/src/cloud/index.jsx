/**
 * Client-side entry point for the cloud edition.
 *
 * In the OSS repository this file is a no-op stub: the default export is
 * an empty array, which `App.jsx` interprets as "no cloud routes to mount".
 * The cloud repository replaces this file with the real implementation
 * (account, billing, plans, SSO, etc.) by exporting non-empty values.
 *
 * Expected shape (cloud edition):
 *   export default [
 *     { path: '/account',  element: <Account />,  requiresAuth: true },
 *     { path: '/billing',  element: <Billing />,  requiresAuth: true },
 *     { path: '/plans',    element: <Plans />,    requiresAuth: false },
 *   ];
 *
 *   // Optional: extra entries the OSS Admin Console renders for cloud admins.
 *   //   { label, to, icon, description }
 *   export const adminLinks = [
 *     { label: 'Billing', to: '/billing', icon: TbCreditCard, description: '...' },
 *   ];
 *
 * The OSS build keeps this stub so `import('./cloud')` always resolves and
 * Vite never has to special-case its build graph.
 */

export default [];
export const adminLinks = [];
// Cloud-only slot rendered above the Datasources list (e.g. storage usage bar).
// Null in OSS — set to a React component in the cloud edition.
export const DatasourcesHeader = null;
// Cloud-only slot rendered in the Dashboard topbar (e.g. org switcher).
// Null in OSS — set to a React component in the cloud edition.
export const TopbarSwitcher = null;
// Cloud-only slot injected into the Dashboard user-menu dropdown (e.g. a
// "Platform supervisor" link). Null in OSS.
export const UserMenuExtras = null;
// Cloud-only slot rendered inside the Alerts create/edit form, after the
// webhook field — extra notification channels (e-mail recipients). Props:
// { value, onChange, styles } where `value` is the form's free-shape `extras`
// object, spread as-is into the POST/PUT body. A static `fromAlert(alert)`
// returns the initial `extras` for an existing alert. Null in OSS.
export const AlertFormExtras = null;
// Cloud-only: alertMetaExtra(alert) → string|null appended to the alert
// card's meta line (e.g. " · 2 recipients"). Null in OSS.
export const alertMetaExtra = null;

// Cloud-only slot rendered inside the root layout, above every route, for a
// gate the whole app must pass — the cloud edition uses it to collect the
// regulatory clauses from someone who signed in through SSO. It renders
// alongside the routes and decides for itself whether to show anything.
// Null in OSS.
export const AppGate = null;

// Cloud-only: submitBugReport({ summary, details, context }) -> Promise.
// Null in OSS, where there is no server to receive a report — the dialog then
// opens a pre-filled mail to the address an administrator configured. The cloud
// edition sets this to POST onto its own endpoint, so a tenant's error messages
// (which name tables, columns, and sometimes the filter values that produced
// them) never leave its own instance.
export const submitBugReport = null;
