import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Watch from './pages/Watch.jsx';

// Shared invite links can be /join/ABC123 or /watch/ABC123; both land in the room.
function JoinRedirect() {
  const { roomId } = useParams();
  return <Navigate to={`/watch/${roomId}`} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/watch/:roomId" element={<ProtectedRoute><Watch /></ProtectedRoute>} />
      <Route path="/join/:roomId" element={<ProtectedRoute><JoinRedirect /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
