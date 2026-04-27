import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Button, Badge, Spinner, Nav } from 'react-bootstrap';
import { useNotifications } from '../notifications/NotificationsContext';

type TabKey = 'all' | 'unread';

export default function NotificationsPage() {
  const { notifications, unreadCount, loading, markRead, markAllRead, remove } = useNotifications();
  const nav = useNavigate();
  const [tab, setTab] = useState<TabKey>('unread');

  const visible = useMemo(() => {
    return tab === 'unread'
      ? notifications.filter(n => !n.read_at)
      : notifications;
  }, [tab, notifications]);

  const open = (id: string, link: string | null) => {
    markRead(id);
    if (link) nav(link);
  };

  // Theme per tab
  const isUnread = tab === 'unread';
  const accent = isUnread ? '#f97316' : '#2563eb';   // orange for unread, blue for all
  const accentSoft = isUnread ? 'rgba(249,115,22,.06)' : 'rgba(37,99,235,.04)';

  return (
    <>
      <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
        <h2 className="mb-0">
          Notifications
          {unreadCount > 0 && <Badge bg="warning" text="dark" pill className="ms-2">{unreadCount} unread</Badge>}
        </h2>
        {unreadCount > 0 && (
          <Button variant="outline-secondary" size="sm" onClick={markAllRead}>
            <i className="bi bi-check2-all me-1" /> Mark all read
          </Button>
        )}
      </div>

      <Card className="mb-3">
        <Card.Body className="py-2">
          <Nav variant="tabs" activeKey={tab} onSelect={k => k && setTab(k as TabKey)}>
            <Nav.Item>
              <Nav.Link eventKey="unread" style={isUnread ? { color: '#f97316', borderBottomColor: '#f97316' } : undefined}>
                <i className="bi bi-envelope me-1" />
                Unread
                {unreadCount > 0 && (
                  <Badge bg="warning" text="dark" pill className="ms-2">{unreadCount}</Badge>
                )}
              </Nav.Link>
            </Nav.Item>
            <Nav.Item>
              <Nav.Link eventKey="all">
                <i className="bi bi-list-ul me-1" />
                All
                <Badge bg="secondary" pill className="ms-2">{notifications.length}</Badge>
              </Nav.Link>
            </Nav.Item>
          </Nav>
        </Card.Body>
      </Card>

      {loading
        ? <div className="text-center py-5"><Spinner animation="border" /></div>
        : visible.length === 0
          ? <Card body className="text-center text-muted">
              {isUnread ? 'No unread notifications. You\'re all caught up.' : 'No notifications yet.'}
            </Card>
          : (
            <div className="d-flex flex-column gap-2">
              {visible.map(n => {
                const unread = !n.read_at;
                return (
                  <Card key={n.id} className="shadow-sm"
                    style={{
                      borderLeft: unread ? `4px solid ${accent}` : '4px solid #e5e7eb',
                      background: unread ? accentSoft : undefined,
                      cursor: n.link ? 'pointer' : 'default',
                    }}
                    onClick={() => open(n.id, n.link)}>
                    <Card.Body className="py-3">
                      <div className="d-flex justify-content-between align-items-start gap-2">
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div className="d-flex align-items-center gap-2">
                            <span className="fw-semibold" style={unread ? { color: accent } : undefined}>{n.title}</span>
                            {unread && <Badge pill style={{ background: accent, width: 8, height: 8, padding: 0 }} />}
                          </div>
                          {n.body && <div className="text-muted small mt-1">{n.body}</div>}
                          <small className="text-muted">{new Date(n.created_at).toLocaleString()}</small>
                        </div>
                        <Button size="sm" variant="link" className="text-danger p-0" onClick={(e) => { e.stopPropagation(); remove(n.id); }} title="Delete">
                          <i className="bi bi-trash" />
                        </Button>
                      </div>
                    </Card.Body>
                  </Card>
                );
              })}
            </div>
          )}
    </>
  );
}
