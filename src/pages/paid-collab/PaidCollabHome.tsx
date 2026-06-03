import { useAuth } from '../../auth/AuthContext';
import PaidCollabDashboard from './PaidCollabDashboard';
import PaidCollabHandlerWorkspace from './PaidCollabHandlerWorkspace';

/**
 * Routes the `/paid-collab` landing to the right view based on the user role.
 * - Paid Collab Client: polished consumption dashboard.
 * - Paid Collab Handler: operations workspace with quick-add tools.
 */
export default function PaidCollabHome() {
  const { profile } = useAuth();
  if (profile?.role === 'paid_collab_handler') return <PaidCollabHandlerWorkspace />;
  return <PaidCollabDashboard />;
}
