import { useNavigate } from 'react-router-dom';
import { Card, Button, Badge, Spinner } from 'react-bootstrap';
import { useNotifications } from '../notifications/NotificationsContext';

export default function NotificationsPage() {
  const { notifications, unreadCount, loading, markRead, markAllRead, remove } = useNotifications();
  const nav = useNavigate();

  const open = (id: string, link: string | null) => {
    markRead(id);
    if (link) nav(link);
  };

  return (
    <>
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2 className="mb-0">Notifications {unreadCount > 0 && <Badge bg="primary" pill className="ms-2">{unreadCount}</Badge>}</h2>
        {unreadCount > 0 && (
          <Button variant="outline-secondary" size="sm" onClick={markAllRead}>
            <i className="bi bi-check2-all me-1" /> Mark all read
          </Button>
        )}
      </div>

      {loading
        ? <div className="text-center py-5"><Spinner animation="border" /></div>
        : notifications.length === 0
          ? <Card body className="text-center text-muted">No notifications yet.</Card>
          : (
            <div className="d-flex flex-column gap-2">
              {notifications.map(n => (
                <Card key={n.id} className="shadow-sm"
                  style={{ borderLeft: n.read_at ? '4px solid #e5e7eb' : '4px solid #2563eb', cursor: n.link ? 'pointer' : 'default' }}
                  onClick={() => open(n.id, n.link)}>
                  <Card.Body className="py-3">
                    <div className="d-flex justify-content-between align-items-start gap-2">
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="d-flex align-items-center gap-2">
                          <span className="fw-semibold">{n.title}</span>
                          {!n.read_at && <Badge bg="primary" pill style={{ width: 8, height: 8, padding: 0 }} />}
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
              ))}
            </div>
          )}
    </>
  );
}
