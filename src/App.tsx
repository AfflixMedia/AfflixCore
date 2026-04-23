import { Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import SignUp from './pages/SignUp';
import Layout from './layout/Layout';
import Dashboard from './pages/Dashboard';
import Brands from './pages/Brands';
import APCs from './pages/APCs';
import Clients from './pages/Clients';
import ClientAccess from './pages/ClientAccess';
import Resources from './pages/Resources';
import NotificationsPage from './pages/Notifications';
import SharedReports from './pages/SharedReports';
import Reporting from './pages/Reporting';
import WeeklyReports from './pages/WeeklyReports';
import WeeklyReportEdit from './pages/WeeklyReportEdit';
import WeeklyReportView from './pages/WeeklyReportView';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { useAuth } from './auth/AuthContext';

function RoleHome() {
  const { profile } = useAuth();
  return <Navigate to={profile?.role === 'apc' ? '/brands' : '/dashboard'} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<SignUp />} />
      <Route path="/share/:token" element={<SharedReports />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<RoleHome />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="brands" element={<Brands />} />
        <Route path="apcs" element={<ProtectedRoute roles={['bob']}><APCs /></ProtectedRoute>} />
        <Route path="clients" element={<ProtectedRoute roles={['bob']}><Clients /></ProtectedRoute>} />
        <Route path="client-access" element={<ProtectedRoute roles={['bob']}><ClientAccess /></ProtectedRoute>} />
        <Route path="resources" element={<Resources />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="reporting/weekly" element={<WeeklyReports />} />
        <Route path="reporting/weekly/:id" element={<WeeklyReportView />} />
        <Route path="reporting/weekly/:id/edit" element={<WeeklyReportEdit />} />
        <Route path="reporting/bi-weekly" element={<Reporting kind="Bi-Weekly" />} />
        <Route path="reporting/monthly" element={<Reporting kind="Monthly" />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
