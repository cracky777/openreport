import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
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

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
        <Routes>
          <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
          <Route path="/" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
          <Route path="/edit/:id" element={<PrivateRoute><Editor /></PrivateRoute>} />
          <Route path="/datasources" element={<PrivateRoute><Datasources /></PrivateRoute>} />
          <Route path="/models" element={<PrivateRoute><Models /></PrivateRoute>} />
          <Route path="/models/:id" element={<PrivateRoute><ModelEditor /></PrivateRoute>} />
          <Route path="/admin" element={<PrivateRoute><Admin /></PrivateRoute>} />
          <Route path="/view/:id" element={<Viewer />} />
          <Route path="/verify" element={<Verify />} />
          {/* Cloud-edition routes — empty array in the OSS build. */}
          {(cloudRoutes || []).map((r) => (
            <Route
              key={r.path}
              path={r.path}
              element={r.requiresAuth ? <PrivateRoute>{r.element}</PrivateRoute> : r.element}
            />
          ))}
        </Routes>
      </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
