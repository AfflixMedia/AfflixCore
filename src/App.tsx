import { Routes, Route, Navigate } from 'react-router-dom';
import { Spinner } from 'react-bootstrap';
import Login from './pages/Login';
import SignUp from './pages/SignUp';
import Layout from './layout/Layout';
import Dashboard from './pages/Dashboard';
import Brands from './pages/Brands';
import BrandDetail from './pages/BrandDetail';
import APCs from './pages/APCs';
import PaidCollabClients from './pages/PaidCollabClients';
import PaidCollabHandlers from './pages/PaidCollabHandlers';
import Clients from './pages/Clients';
import ClientAccess from './pages/ClientAccess';
import Resources from './pages/Resources';
import NotificationsPage from './pages/Notifications';
import SharedReports from './pages/SharedReports';
import Reporting from './pages/Reporting';
import BudgetManager from './pages/BudgetManager';
import CompanyBudget from './pages/CompanyBudget';
import WeeklyReports from './pages/WeeklyReports';
import WeeklyReportEdit from './pages/WeeklyReportEdit';
import WeeklyReportView from './pages/WeeklyReportView';
import MonthlyReports from './pages/MonthlyReports';
import MonthlyReportEdit from './pages/MonthlyReportEdit';
import MonthlyReportView from './pages/MonthlyReportView';
import PaidCollabHome from './pages/paid-collab/PaidCollabHome';
import PaidCollabPortal from './pages/paid-collab/PaidCollabPortal';
import PaidCollabBrandView from './pages/paid-collab/PaidCollabBrandView';
import PaidCollabPrograms from './pages/paid-collab/PaidCollabPrograms';
import PaidCollabProgramView from './pages/paid-collab/PaidCollabProgramView';
import PaidCollabCreators from './pages/paid-collab/PaidCollabCreators';
import PaidCollabVideos from './pages/paid-collab/PaidCollabVideos';
import ReportingCanvasList from './pages/templates/ReportingCanvasList';
import ReportingCanvasEditor from './pages/templates/ReportingCanvasEditor';
import GlobalChat from './pages/global-chat/GlobalChat';
import TeamLeads from './pages/TeamLeads';
import Tasks from './pages/Tasks';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { useAuth } from './auth/AuthContext';

function RoleHome() {
  const { profile, loading } = useAuth();
  // Wait for the profile to load before routing — otherwise a paid_collab_client
  // would briefly fall through to /dashboard and hit the role guard's denied page.
  if (loading || !profile) {
    return (
      <div className="d-flex justify-content-center align-items-center" style={{ minHeight: '40vh' }}>
        <Spinner animation="border" />
      </div>
    );
  }
  if (profile.role === 'paid_collab_client' || profile.role === 'paid_collab_handler') {
    return <Navigate to="/paid-collab" replace />;
  }
  if (profile.role === 'apc' || profile.role === 'team_lead') return <Navigate to="/brands" replace />;
  return <Navigate to="/dashboard" replace />;
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
        <Route path="dashboard" element={<ProtectedRoute roles={['bob', 'apc']}><Dashboard /></ProtectedRoute>} />
        <Route path="brands" element={<ProtectedRoute roles={['bob', 'apc', 'team_lead']}><Brands /></ProtectedRoute>} />
        <Route path="brands/:id" element={<ProtectedRoute roles={['bob', 'apc', 'team_lead']}><BrandDetail /></ProtectedRoute>} />
        <Route path="apcs" element={<ProtectedRoute roles={['bob', 'team_lead']}><APCs /></ProtectedRoute>} />
        <Route path="team-leads" element={<ProtectedRoute roles={['bob']}><TeamLeads /></ProtectedRoute>} />
        <Route path="tasks" element={<ProtectedRoute roles={['bob', 'team_lead', 'apc']}><Tasks /></ProtectedRoute>} />
        <Route path="paid-collab-clients" element={<ProtectedRoute roles={['bob']}><PaidCollabClients /></ProtectedRoute>} />
        <Route path="paid-collab-handlers" element={<ProtectedRoute roles={['bob']}><PaidCollabHandlers /></ProtectedRoute>} />
        <Route path="clients" element={<ProtectedRoute roles={['bob']}><Clients /></ProtectedRoute>} />
        <Route path="client-access" element={<ProtectedRoute roles={['bob']}><ClientAccess /></ProtectedRoute>} />
        <Route path="resources" element={<ProtectedRoute roles={['bob', 'apc', 'team_lead']}><Resources /></ProtectedRoute>} />
        <Route path="budget" element={<Navigate to="/budget/brands" replace />} />
        <Route path="budget/brands" element={<ProtectedRoute roles={['bob']}><BudgetManager /></ProtectedRoute>} />
        <Route path="budget/company" element={<ProtectedRoute roles={['bob']}><CompanyBudget /></ProtectedRoute>} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="chats" element={<ProtectedRoute roles={['bob', 'apc', 'team_lead', 'paid_collab_handler']}><GlobalChat /></ProtectedRoute>} />
        <Route path="reporting/weekly" element={<ProtectedRoute roles={['bob', 'apc', 'team_lead']}><WeeklyReports /></ProtectedRoute>} />
        <Route path="reporting/weekly/:id" element={<ProtectedRoute roles={['bob', 'apc', 'team_lead']}><WeeklyReportView /></ProtectedRoute>} />
        <Route path="reporting/weekly/:id/edit" element={<ProtectedRoute roles={['bob', 'apc', 'team_lead']}><WeeklyReportEdit /></ProtectedRoute>} />
        <Route path="reporting/monthly" element={<ProtectedRoute roles={['bob', 'apc', 'team_lead']}><MonthlyReports /></ProtectedRoute>} />
        <Route path="reporting/monthly/:id" element={<ProtectedRoute roles={['bob', 'apc', 'team_lead']}><MonthlyReportView /></ProtectedRoute>} />
        <Route path="reporting/monthly/:id/edit" element={<ProtectedRoute roles={['bob', 'apc', 'team_lead']}><MonthlyReportEdit /></ProtectedRoute>} />
        <Route path="reporting/bi-weekly" element={<ProtectedRoute roles={['bob', 'apc', 'team_lead']}><Reporting kind="Bi-Weekly" /></ProtectedRoute>} />
        <Route path="paid-collab" element={<ProtectedRoute roles={['paid_collab_client', 'paid_collab_handler']}><PaidCollabHome /></ProtectedRoute>} />
        <Route path="paid-collab/brands" element={<ProtectedRoute roles={['paid_collab_client', 'paid_collab_handler']}><PaidCollabPortal /></ProtectedRoute>} />
        <Route path="paid-collab/brands/:id" element={<ProtectedRoute roles={['paid_collab_client', 'paid_collab_handler']}><PaidCollabBrandView /></ProtectedRoute>} />
        <Route path="paid-collab/programs" element={<ProtectedRoute roles={['paid_collab_client', 'paid_collab_handler']}><PaidCollabPrograms /></ProtectedRoute>} />
        <Route path="paid-collab/programs/:programId" element={<ProtectedRoute roles={['paid_collab_client', 'paid_collab_handler']}><PaidCollabProgramView /></ProtectedRoute>} />
        <Route path="paid-collab/creators" element={<ProtectedRoute roles={['paid_collab_client', 'paid_collab_handler']}><PaidCollabCreators /></ProtectedRoute>} />
        <Route path="paid-collab/videos" element={<ProtectedRoute roles={['paid_collab_client', 'paid_collab_handler']}><PaidCollabVideos /></ProtectedRoute>} />
        <Route path="templates" element={<ProtectedRoute roles={['bob', 'apc']}><ReportingCanvasList /></ProtectedRoute>} />
        <Route path="templates/:id" element={<ProtectedRoute roles={['bob']}><ReportingCanvasEditor /></ProtectedRoute>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
