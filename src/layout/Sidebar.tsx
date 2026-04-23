import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useNotifications } from '../notifications/NotificationsContext';
import { Badge } from 'react-bootstrap';

export default function Sidebar() {
  const [reportingOpen, setReportingOpen] = useState(true);
  const { profile } = useAuth();
  const { unreadCount, notifications } = useNotifications();
  const isBob = profile?.role === 'bob';
  const reportingUnread = notifications.filter(n => !n.read_at && n.link?.startsWith('/reporting/')).length;
  const isApc = profile?.role === 'apc';

  return (
    <aside className="ac-sidebar">
      <div className="brand">
        Afflix Core
        <small>by Afflix Media</small>
      </div>
      <nav className="ac-nav">
        {isApc ? (
          <>
            <NavLink to="/brands">
              <i className="bi bi-shop" /> Brands
            </NavLink>
            <NavLink to="/resources">
              <i className="bi bi-folder2" /> Resources
            </NavLink>
          </>
        ) : (
          <>
            <NavLink to="/dashboard">
              <i className="bi bi-speedometer2" /> Dashboard
            </NavLink>
            {isBob && (
              <>
                <NavLink to="/brands">
                  <i className="bi bi-shop" /> Brands
                </NavLink>
                <NavLink to="/clients">
                  <i className="bi bi-building" /> Clients
                </NavLink>
                <NavLink to="/apcs">
                  <i className="bi bi-people" /> APCs
                </NavLink>
                <NavLink to="/client-access">
                  <i className="bi bi-link-45deg" /> Client Access
                </NavLink>
                <NavLink to="/resources">
                  <i className="bi bi-folder2" /> Resources
                </NavLink>
              </>
            )}
          </>
        )}
        <button className="ac-nav-toggle" onClick={() => setReportingOpen(o => !o)}>
          <i className="bi bi-bar-chart" /> Reporting
          {reportingUnread > 0 && <Badge bg="danger" pill className="ms-2">{reportingUnread}</Badge>}
          <i className={`bi ms-auto ${reportingOpen ? 'bi-chevron-up' : 'bi-chevron-down'}`} />
        </button>
        {reportingOpen && (
          <div className="ac-sub">
            <NavLink to="/reporting/weekly">
              Weekly {reportingUnread > 0 && <Badge bg="danger" pill className="ms-1">{reportingUnread}</Badge>}
            </NavLink>
            <NavLink to="/reporting/bi-weekly">Bi-Weekly</NavLink>
            <NavLink to="/reporting/monthly">Monthly</NavLink>
          </div>
        )}
        <NavLink to="/notifications">
          <i className="bi bi-bell" /> Notifications
          {unreadCount > 0 && <Badge bg="danger" pill className="ms-2">{unreadCount}</Badge>}
        </NavLink>
      </nav>
      <div className="footer">
        <div>{profile?.full_name ?? profile?.email}</div>
        <small className="text-muted">Role: {profile?.role ?? '—'}</small>
      </div>
    </aside>
  );
}
