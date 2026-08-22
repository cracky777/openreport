import { createBrowserRouter, RouterProvider, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { ThemeProvider } from './hooks/useTheme';
import { GraphProvider } from './hooks/useGraph';
import Login from './pages/Login';
import Editor from './pages/Editor';
import Viewer from './pages/Viewer';
import ModelEditor from './pages/ModelEditor';
import Admin from './pages/Admin';
import Alerts from './pages/Alerts';
import Verify from './pages/Verify';
// Cloud-edition routes — empty in the OSS build, populated in the cloud build.
// The same import path resolves to either the stub or the real implementation.
import cloudRoutes from './cloud';
import AppShell from './components/AppShell/AppShell';
import ToastHost from './components/Toast/ToastHost';

const _hs0 = { padding: 40, color: 'var(--text-disabled)' };
const _hs1 = { padding: 40, color: 'var(--text-disabled)' };

function PrivateRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={_hs0}>Loading...</div>;
  return user ? children : <Navigate to="/login" />;
}

function PublicRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={_hs1}>Loading...</div>;
  return user ? <Navigate to="/" /> : children;
}

// Root layout hosts the cross-route providers. The data router (required
// by `useBlocker` for the editor's unsaved-changes guard) builds its
// route tree outside React, so providers can't wrap RouterProvider the
// way they did <BrowserRouter>. Putting them in a layout route nests
// every route under them via <Outlet />.
function RootLayout() {
  return (
    <ThemeProvider>
      <AuthProvider>
        {/* Above the router so the Sources→Models→Reports graph survives moving
            between stages instead of being refetched on every step. */}
        <GraphProvider>
          <Outlet />
          <ToastHost />
        </GraphProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { path: '/login', element: <PublicRoute><Login /></PublicRoute> },
      // The three journey stages share one shell; `step` picks which one is on
      // screen. They stay separate routes so deep links and the editors' back
      // buttons keep working.
      { path: '/', element: <PrivateRoute><AppShell step="reports" /></PrivateRoute> },
      { path: '/edit/:id', element: <PrivateRoute><Editor /></PrivateRoute> },
      { path: '/datasources', element: <PrivateRoute><AppShell step="sources" /></PrivateRoute> },
      { path: '/models', element: <PrivateRoute><AppShell step="models" /></PrivateRoute> },
      { path: '/models/:id', element: <PrivateRoute><ModelEditor /></PrivateRoute> },
      { path: '/admin', element: <PrivateRoute><Admin /></PrivateRoute> },
      { path: '/alerts', element: <PrivateRoute><Alerts /></PrivateRoute> },
      { path: '/view/:id', element: <Viewer /> },
      // Token-authenticated embed page (iframe-able) — same Viewer, chrome-less;
      // the signed ?token= grants access, no session required.
      { path: '/embed/:id', element: <Viewer /> },
      { path: '/verify', element: <Verify /> },
      // Cloud-edition routes — empty array in the OSS build.
      ...(cloudRoutes || []).map((r) => ({
        path: r.path,
        element: r.requiresAuth ? <PrivateRoute>{r.element}</PrivateRoute> : r.element,
      })),
    ],
  },
]);

function App() {
  return <RouterProvider router={router} />;
}

export default App;
