import { useAuth } from '../../auth/AuthContext';
import PaidCollabDashboard from './PaidCollabDashboard';
import HandlerCollabApp from '../handler-collab/HandlerCollabApp';

/**
 * Routes the `/paid-collab` landing to the right view based on the user role.
 * - Paid Collab Client: polished consumption dashboard.
 * - Paid Collab Handler: operations workspace with quick-add tools.
 */
export default function PaidCollabHome() {
  const { profile } = useAuth();
  if (profile?.role === 'paid_collab_handler') return <HandlerCollabApp />;
  return <PaidCollabDashboard />;
}
