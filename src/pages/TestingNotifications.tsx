import { useEffect, useState, useCallback } from 'react';
import { Card, Table, Badge, Spinner, Button } from 'react-bootstrap';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';

interface TestingNotification {
  id: string;
  notification_id: string | null;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  source_created_at: string | null;
  created_at: string;
}

export default function TestingNotifications() {
  const { user } = useAuth();
  const [rows, setRows] = useState<TestingNotification[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!user) { setRows([]); return; }
    setLoading(true);
    const { data } = await supabase
      .from('testing_notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('source_created_at', { ascending: false });
    setRows((data as TestingNotification[]) ?? []);
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  // Realtime: append newly mirrored notifications as they arrive.
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`testing-notif:${user.id}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'testing_notifications', filter: `user_id=eq.${user.id}` },
        (p) => setRows(prev => [p.new as TestingNotification, ...prev]))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user]);

  return (
    <>
      <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
        <h2 className="mb-0">
          Testing Notification
          <Badge bg="secondary" pill className="ms-2">{rows.length}</Badge>
        </h2>
        <Button variant="outline-secondary" size="sm" onClick={load}>
          <i className="bi bi-arrow-clockwise me-1" /> Refresh
        </Button>
      </div>

      <p className="text-muted">
        Every notification you (Bob) have received so far, mirrored from the notifications table.
      </p>

      <Card className="shadow-sm">
        <Card.Body className="p-0">
          {loading ? (
            <div className="text-center py-5"><Spinner animation="border" /></div>
          ) : rows.length === 0 ? (
            <div className="text-center text-muted py-5">No notifications received yet.</div>
          ) : (
            <Table responsive hover className="mb-0 align-middle">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Body</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Link</th>
                  <th>Received</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(n => (
                  <tr key={n.id}>
                    <td className="fw-semibold">{n.title}</td>
                    <td className="text-muted">{n.body ?? '—'}</td>
                    <td><Badge bg="light" text="dark">{n.type}</Badge></td>
                    <td>
                      {n.read_at
                        ? <Badge bg="success-subtle" text="success">Read</Badge>
                        : <Badge bg="warning" text="dark">Unread</Badge>}
                    </td>
                    <td>
                      {n.link
                        ? <a href={n.link} className="text-decoration-none">{n.link}</a>
                        : <span className="text-muted">—</span>}
                    </td>
                    <td className="text-nowrap small text-muted">
                      {new Date(n.source_created_at ?? n.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card.Body>
      </Card>
    </>
  );
}
