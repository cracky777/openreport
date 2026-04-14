import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Editor from './pages/Editor';
import Viewer from './pages/Viewer';

function PrivateRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: 40, color: '#94a3b8' }}>Loading...</div>;
  return user ? children : <Navigate to="/login" />;
}

function PublicRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: 40, color: '#94a3b8' }}>Loading...</div>;
  return user ? <Navigate to="/" /> : children;
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
          <Route path="/" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
          <Route path="/edit/:id" element={<PrivateRoute><Editor /></PrivateRoute>} />
          <Route path="/view/:id" element={<Viewer />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
