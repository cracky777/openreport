import { createBrowserRouter, RouterProvider, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { ThemeProvider } from './hooks/useTheme';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Editor from './pages/Editor';
import Viewer from './pages/Viewer';
import Datasources from './pages/Datasources';
import Models from './pages/Models';
import ModelEditor from './pages/ModelEditor';
import Admin from './pages/Admin';
import Verify from './pages/Verify';
// Cloud-edition routes — empty in the OSS build, populated in the cloud build.
// The same import path resolves to either the stub or the real implementation.
import cloudRoutes from './cloud';

function PrivateRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: 40, color: 'var(--text-disabled)' }}>Loading...</div>;
  return user ? children : <Navigate to="/login" />;
}

function PublicRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: 40, color: 'var(--text-disabled)' }}>Loading...</div>;
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
        <Outlet />
      </AuthProvider>
    </ThemeProvider>
  );
}

const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { path: '/login', element: <PublicRoute><Login /></PublicRoute> },
      { path: '/', element: <PrivateRoute><Dashboard /></PrivateRoute> },
      { path: '/edit/:id', element: <PrivateRoute><Editor /></PrivateRoute> },
      { path: '/datasources', element: <PrivateRoute><Datasources /></PrivateRoute> },
      { path: '/models', element: <PrivateRoute><Models /></PrivateRoute> },
      { path: '/models/:id', element: <PrivateRoute><ModelEditor /></PrivateRoute> },
      { path: '/admin', element: <PrivateRoute><Admin /></PrivateRoute> },
      { path: '/view/:id', element: <Viewer /> },
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
