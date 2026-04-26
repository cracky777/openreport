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
