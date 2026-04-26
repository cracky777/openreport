/**
 * Client-side entry point for the cloud edition.
 *
 * In the OSS repository this file is a no-op stub: the default export is
 * an empty array, which `App.jsx` interprets as "no cloud routes to mount".
 * The cloud repository replaces this file with the real implementation
 * (account, billing, plans, SSO, etc.) by exporting a non-empty array.
 *
 * Expected shape (cloud edition):
 *   export default [
 *     { path: '/account',  element: <Account />,  requiresAuth: true },
 *     { path: '/billing',  element: <Billing />,  requiresAuth: true },
 *     { path: '/plans',    element: <Plans />,    requiresAuth: false },
 *   ];
 *
 * The OSS build keeps this stub so `import('./cloud')` always resolves and
 * Vite never has to special-case its build graph.
 */

export default [];
