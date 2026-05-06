import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useNotifications } from '../notifications/NotificationsContext';
import { Badge } from 'react-bootstrap';

export default function Sidebar({ collapsed = false }: { collapsed?: boolean }) {
  const [reportingOpen, setReportingOpen] = useState(true);
  const { profile } = useAuth();
  const { unreadCount, notifications } = useNotifications();
  const isBob = profile?.role === 'bob';
  const reportingUnread = notifications.filter(n => !n.read_at && n.link?.startsWith('/reporting/')).length;
  const isApc = profile?.role === 'apc';

  return (
    <aside className="ac-sidebar">
      <div className="brand">
        <span className="ac-nav-label">Afflix Core</span>
        <span className="ac-brand-mark" aria-hidden>AC</span>
        <small className="ac-nav-label">by Afflix Media</small>
      </div>
      <nav className="ac-nav">
        {isApc ? (
          <>
            <NavLink to="/brands" title="Brands">
              <i className="bi bi-shop" /> <span className="ac-nav-label">Brands</span>
            </NavLink>
            <NavLink to="/resources" title="Resources">
              <i className="bi bi-folder2" /> <span className="ac-nav-label">Resources</span>
            </NavLink>
          </>
        ) : (
          <>
            <NavLink to="/dashboard" title="Dashboard">
              <i className="bi bi-speedometer2" /> <span className="ac-nav-label">Dashboard</span>
            </NavLink>
            {isBob && (
              <>
                <NavLink to="/brands" title="Brands">
                  <i className="bi bi-shop" /> <span className="ac-nav-label">Brands</span>
                </NavLink>
                <NavLink to="/clients" title="Clients">
                  <i className="bi bi-building" /> <span className="ac-nav-label">Clients</span>
                </NavLink>
                <NavLink to="/apcs" title="APCs">
                  <i className="bi bi-people" /> <span className="ac-nav-label">APCs</span>
                </NavLink>
                <NavLink to="/client-access" title="Client Access">
                  <i className="bi bi-link-45deg" /> <span className="ac-nav-label">Client Access</span>
                </NavLink>
                <NavLink to="/resources" title="Resources">
                  <i className="bi bi-folder2" /> <span className="ac-nav-label">Resources</span>
                </NavLink>
              </>
            )}
          </>
        )}
        {/* When collapsed, the chevron toggle becomes a direct link to Weekly. */}
        {collapsed ? (
          <NavLink to="/reporting/weekly" title="Reporting">
            <i className="bi bi-bar-chart" />
            {reportingUnread > 0 && <Badge bg="danger" pill className="ms-2 ac-nav-label">{reportingUnread}</Badge>}
          </NavLink>
        ) : (
          <>
            <button className="ac-nav-toggle" onClick={() => setReportingOpen(o => !o)}>
              <i className="bi bi-bar-chart" /> <span className="ac-nav-label">Reporting</span>
              {reportingUnread > 0 && <Badge bg="danger" pill className="ms-2 ac-nav-label">{reportingUnread}</Badge>}
              <i className={`bi ms-auto ac-nav-label ${reportingOpen ? 'bi-chevron-up' : 'bi-chevron-down'}`} />
            </button>
            {reportingOpen && (
              <div className="ac-sub">
                <NavLink to="/reporting/weekly">
                  <span className="ac-nav-label">Weekly {reportingUnread > 0 && <Badge bg="danger" pill className="ms-1">{reportingUnread}</Badge>}</span>
                </NavLink>
                <NavLink to="/reporting/bi-weekly"><span className="ac-nav-label">Bi-Weekly</span></NavLink>
                <NavLink to="/reporting/monthly"><span className="ac-nav-label">Monthly</span></NavLink>
              </div>
            )}
          </>
        )}
        <NavLink to="/notifications" title="Notifications">
          <i className="bi bi-bell" /> <span className="ac-nav-label">Notifications</span>
          {unreadCount > 0 && <Badge bg="danger" pill className="ms-2">{unreadCount}</Badge>}
        </NavLink>
      </nav>
      <div className="footer">
        <div className="ac-nav-label">{profile?.full_name ?? profile?.email}</div>
        <small className="text-muted ac-nav-label">Role: {profile?.role ?? '—'}</small>
      </div>
    </aside>
  );
}
